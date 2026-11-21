# Design Document: Museum Login

## Overview

The Recipient signs in with a username and password, then answers three questions. A small Lambda function checks everything and, on success, sets three CloudFront signed cookies scoped to `/Memories/*`. CloudFront then serves the letters, photos and paintings only to requests carrying those cookies. The game code does not change: `mediaBase.js`, `loadMemories.js`, `paintings.js` and `GameScene.preload()` keep using the same plain `/Memories/...` URLs, which simply start returning 403 to anyone who is not signed in.

This builds on the design note `docs/Private_Media_Deployment.md` (private bucket + OAC + signed cookies + one auth function) and settles its open choices.

### Key design decision: two endpoints, one combined final check

The question prompts are personal, so they cannot ship in the bundle or the repo. They live in the Auth_Config and must come from the server. That means the server has to answer something before the questions are shown:

1. `POST /api/login/start` checks only the username and password. On success it returns the three prompts. It sets no cookie.
2. `POST /api/login/finish` re-checks the username and password **and** all three answers in one request, and only then sets the cookies.

The start step does reveal whether the password was right. That is acceptable and is also kinder UX: she should not answer three questions and then learn the password was mistyped. The answers are only ever checked all together, so a failure never says which answer was wrong (Req 3.5, 3.7).

### Key design decision: the Lambda function URL sits behind CloudFront on the same domain

The cookies must be set on the app's own domain, and the app must reach the function without CORS. So the function URL is a second CloudFront origin under `/api/*`, not a separate API Gateway domain. This gives:

- **Same origin:** no CORS, and the `Set-Cookie` headers are first-party, host-only cookies.
- **OAC for Lambda:** the function URL uses `AuthType: AWS_IAM`, and only the distribution can invoke it (Req 6.6, 6.7).
- **One constraint from AWS:** with OAC on a Lambda function URL, a `POST` must carry the SHA-256 of its body in an `x-amz-content-sha256` header, because Lambda doesn't accept unsigned payloads ([CloudFront: restrict access to a Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)). The browser computes it with `crypto.subtle.digest('SHA-256', body)`.

Lambda@Edge was considered and rejected: it can't use environment variables, it runs in many regions (which rules out a single shared in-memory counter), and it is harder to test.

### Key design decision: 403 must mean exactly "not signed in"

The Session_Probe and the user's sense of "am I signed in" both depend on telling "no access" apart from "file missing":

- **`s3:ListBucket` for the distribution.** Without it, S3 answers 403 for a missing key, which would look like "not signed in". With it, a signed-in request for a missing file gets 404 (Req 6.3).
- **No custom error responses for 403 or 404.** CloudFront's custom error responses are configured per distribution, not per behavior. A 403 page pointed at the login screen would also turn the loader's and the probe's 403s into HTML. The app handles 403 itself (Req 6.5). This replaces step 4 of the checklist in `docs/Private_Media_Deployment.md`.
- **`loadMemories()` does not change.** Once signed in, the first 404 ends the hallway, as the first missing file does today.

### Key design decision: session cookie plus a 12-hour signed policy

Two clocks apply:

- **The cookie's own lifetime.** No `Expires`/`Max-Age`, so the browser drops it when it closes (Req 5.3). This is the "until the browser closes" behavior.
- **The signed policy's `DateLessThan`.** CloudFront requires an end time. 12 hours covers any real visit while capping the damage if the cookie is copied.

If she keeps a tab open past 12 hours, letters and paintings are already loaded, so only a photo opened after that point fails. The ImageViewer shows a short "refresh to sign in again" message (Req 7.6).

One caveat: some browsers restore session cookies when "continue where you left off" or similar is turned on. The 12-hour policy still ends access in that case.

### Research notes

- **OAC for Lambda function URLs:** requires `AuthType: AWS_IAM`, `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` permissions for `cloudfront.amazonaws.com` scoped to the distribution ARN, and the `x-amz-content-sha256` header on `POST` ([AWS docs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)).
- **Signed cookies:** three name-value pairs, one per `Set-Cookie` header, sent before the protected request. CloudFront does not check signatures on `OPTIONS`, so the protected behavior allows only `GET` and `HEAD` ([How signed cookies work](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)).
- **Custom error responses** are a `DistributionConfig` setting, shared by all behaviors ([CustomErrorResponses API](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_CustomErrorResponses.html)).
- **Cookie signing library:** `@aws-sdk/cloudfront-signer` (`getSignedCookies` with a custom policy). It is not part of the Lambda runtime's built-in SDK, so it is bundled.

## Architecture

```text
 Browser (React App)                    CloudFront (one domain)                 AWS
 ───────────────────                    ───────────────────────                 ───
 App start
   └─ HEAD /Memories/dialogue/00.md ──> /Memories/* (signed cookies) ──OAC──> S3 (private)
        200/404 → signed in                 403 if no/invalid cookie
        403     → Login_Screen

 Login_Screen
   Credential_Step
   └─ POST /api/login/start ──────────> /api/* (no cache) ──OAC──> Lambda function URL
        { username, password }                                       ├─ env vars: Auth_Config, private key
        ← 200 { questions: [3] }                                     └─ in-memory attempt counters (1 instance)
   Question_Step (one at a time, local)
   └─ POST /api/login/finish ─────────> /api/* ─────────────────────> Lambda
        { username, password, answers[3] }
        ← 204 + Set-Cookie ×3 (Path=/Memories; Secure; HttpOnly; SameSite=Strict)

 App
   └─ loadMemories() ─────────────────> /Memories/dialogue/NN.md (cookie attached) ──> S3
   └─ mount GameCanvas → GameScene.preload() paintings ──> /Memories/paintings/NN.png
   └─ ImageViewer <img> ──────────────> /Memories/photos/NN.jpg
```

### App phase state machine

A new `StartupGate` component holds a `phase` that gates everything else and renders `<App />` only in `ready`. `App.jsx` itself is unchanged: it stays the overlay coordinator, and its EventBus wiring only runs once it mounts. (Putting the phases inside App would have mixed two jobs and broken every existing App test, which render `<App />` and expect the game immediately.)

```text
            Auth_Enabled false
 checking ─────────────────────────────────────────────┐
    │ probe 200/404                                    │
    ├────────────────────────────> loading ──resolve──> ready (game mounted)
    │ probe 403                       ▲
    ├────────> login ──finish 204─────┘
    │ probe network error / other
    └────────> login (with "couldn't reach" message + retry)
```

- `checking`: loading state, sends the Session_Probe.
- `login`: renders `LoginScreen`. Nothing under `/Memories/*` is requested.
- `loading`: loading state, awaits `loadMemories()`.
- `ready`: renders `GameCanvas`, `DialogueBox`, `ImageViewer` as today.

## Components and Interfaces

### Front-end

#### `src/main.jsx` (change)

Renders `<StartupGate><App /></StartupGate>` immediately. The `loadMemories().then(...)` wrapper moves into the gate (Req 1.5).

#### `src/components/StartupGate.jsx` + `StartupGate.css` (new)

- Props: `children` (the App), plus `authEnabled`, `probe`, `load` (default to `AUTH_ENABLED`, `probeSession`, `loadMemories`; injectable for tests).
- Holds `phase` (`checking | login | loading | ready`) and the transitions above. Starts in `checking` with auth on, `loading` with auth off.
- In `login` and the loading states it renders its own `.app-container` (so the page background shows) with the `LoginScreen` or an "Opening the museum…" status line. In `ready` it renders `children`, so `GameCanvas` mounts only then and the Phaser game never starts before the letters load.
- Effects are cancelled on unmount, so React StrictMode's double-run in dev never sets state twice.
- Shows the existing "no letters loaded" console warning when N is 0.

#### `src/App.jsx` (unchanged)

#### `src/components/LoginScreen.jsx` + `LoginScreen.css` (new)

Props: `onSignedIn()`, `initialMessage?` (for the "couldn't reach the museum" case).

Internal state: `step` (`credentials | questions`), `username`, `password`, `questions` (3 prompts), `index` (0–2), `answers` (3 strings), `message`, `busy`, `retryAt`.

- Credential_Step form → `startLogin()`.
- Question_Step: one prompt at a time with "1 of 3", Back, Continue. The third Continue calls `finishLogin()`.
- On 401 from finish: clear `answers`, `index = 0`, generic message.
- On 429: disable submit until `retryAt`, show minutes from `Retry-After`.
- Clears `password` and `answers` from state on success and on unmount.
- An `aria-live="polite"` region holds `message`. Focus moves to the first field on each step and question change.

Visual: centered panel framed with the ImageViewer's frame palette, "Press Start 2P", over the existing page background. No game canvas behind it.

#### `src/data/authClient.js` (new)

```js
export const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';

/** @returns {Promise<'signed-in' | 'signed-out' | 'unreachable'>} */
export async function probeSession(fetchImpl = fetch) { /* HEAD dialogueUrl(0) */ }

/** @returns {Promise<{ok:true, questions:string[]} | {ok:false, reason:'mismatch'|'rate-limited'|'bad-request'|'unavailable'|'network', retryAfterSeconds?:number}>} */
export async function startLogin(username, password, fetchImpl = fetch) {}

/** @returns {Promise<{ok:true} | {ok:false, reason:..., retryAfterSeconds?:number}>} */
export async function finishLogin(username, password, answers, fetchImpl = fetch) {}

/** POST helper: JSON body, `x-amz-content-sha256` = hex SHA-256 of the exact body bytes,
    `credentials: 'same-origin'`, `cache: 'no-store'`. */
async function postJson(path, payload, fetchImpl) {}
```

`probeSession` maps 200/404 → `signed-in`, 403 → `signed-out`, everything else and network errors → `unreachable` (Req 7.1–7.4). The client does no answer normalization; the server is the single source of truth for matching.

#### `src/components/ImageViewer.jsx` (small change)

Adds an `onError` handler on the photo `<img>` that swaps in a short message ("This photo couldn't load. Refreshing the page should fix it.") (Req 7.6).

#### `Front-end/.env.production` (new, committed, no secrets)

```text
VITE_AUTH_ENABLED=true
```

`npm run dev` leaves it unset, so local development is unchanged. `npm run preview` uses production mode; run `VITE_AUTH_ENABLED=false npm run preview` to preview without the backend. If a build ever ships with the flag off, CloudFront still returns 403 for every `/Memories/*` file, so the content stays protected and the hallway just shows future memories.

### Back-end: `Auth-function/` (new top-level folder)

```text
Auth-function/
├── package.json           # own deps: @aws-sdk/cloudfront-signer, vitest, fast-check, esbuild
├── src/
│   ├── handler.js         # Lambda entry: routing, validation, responses
│   ├── normalize.js       # normalizeAnswer, normalizeUsername (pure)
│   ├── hashing.js         # scrypt hash/verify, constant-time compare (pure + node:crypto)
│   ├── checks.js          # checkCredentials, checkAnswers (pure over config)
│   ├── limiter.js         # in-memory Attempt_Limiter (single Lambda instance)
│   ├── cookies.js         # build the 3 Set-Cookie headers from getSignedCookies
│   └── config.js          # read + validate Lambda environment variables once per instance
├── tools/
│   └── make-config.mjs    # interactive setup tool (Req 9.2–9.4, 9.7)
├── demo/                  # git-ignored: Demo_Config for npm run dev:auth
└── __tests__/
```

#### Routes (`handler.js`)

| Method & path | Body | Success | Failure |
| --- | --- | --- | --- |
| `POST /api/login/start` | `{ username, password }` | `200 { questions: [p1, p2, p3] }` | `400`, `401 {error:"mismatch"}`, `429` + `Retry-After`, `503` |
| `POST /api/login/finish` | `{ username, password, answers: [a1, a2, a3] }` | `204` + 3 × `Set-Cookie` | same |
| anything else | – | – | `404` |

Every response carries `Cache-Control: no-store`. Request order inside a handler:

1. Parse and validate the body (≤ 4 KB, JSON, string fields, exactly 3 answers for finish). On failure, 400 with no attempt counted (Req 4.8).
2. Read the viewer IP from `CloudFront-Viewer-Address` (`ip:port`). Ask the limiter whether this IP is locked. If so, 429.
3. Load the Auth_Config (cached).
4. Run all checks: username, password, and for finish all three answers. Every comparison runs even after a failure (Req 4.6).
5. On failure, record a failed attempt and return 401. On success of finish, clear the IP's counter, sign cookies, return 204.

#### Matching (`normalize.js`, `checks.js`)

```js
export function normalizeAnswer(s) {
  return s.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export const normalizeUsername = (s) => s.trim().toLowerCase();
```

`checkAnswers(config, answers)` returns `true` only if, for every question `i`, `normalizeAnswer(answers[i])` matches `config.questions[i].answerHash`. It always verifies all three, even after a mismatch.

Each question has exactly one accepted answer. Normalization still forgives case, spacing and punctuation. If she gets stuck, you tell her the answer.

#### Hashing (`hashing.js`)

- `scrypt` from `node:crypto` with `N = 2^15, r = 8, p = 1`, 32-byte key, 16-byte random salt per hash, `maxmem = 64 MiB`.
- Stored format: `scrypt$N$r$p$<salt b64>$<key b64>`.
- `verify(input, stored)` recomputes the hash and compares with `crypto.timingSafeEqual`.
- The username is matched on its hash too, so the config holds no plaintext.

Cost per finish request is 5 scrypt runs (username, password, 3 answers). Measured on the Gift_Giver's laptop: about 400 ms per verify, so about 2 s per sign-in; a 512 MB Lambda may be slower. Kept at N = 2^15 for now. Revisit after Demo_Mode or at deploy: either raise the Lambda to 1024 MB (more CPU) or re-run the setup tool with N = 2^14. Each stored hash records its own cost, so changing it needs no code change.

#### Attempt_Limiter (`limiter.js`)

A module-scope `Map` in the Lambda instance, keyed by `sha256(ip)`, value `{ failures, windowStart }`.

- 5 failures inside 15 minutes locks the IP until `windowStart + 15 min` (Req 8.2).
- A successful finish deletes the IP's entry (Req 8.4).
- Expired entries are swept on each request, so the map stays tiny.
- The IP is stored hashed, not raw.
- **One instance only:** the function has reserved concurrency 1 (Req 8.6), so every request reaches the same counter. If two requests arrive at once, Lambda throttles the second with a 429 that has no `Retry-After` header; the client treats a 429 without `Retry-After` as "try again in a moment" rather than a lockout. For one person this effectively never happens.
- **Accepted trade-off:** the counter lives only as long as the instance. After the function sits idle (typically several minutes or more), AWS may replace it and the counts reset. Someone guessing continuously keeps the same instance warm, so the limit still holds against them. The deliberately slow hashing (about half a second per sign-in) adds a second brake.
- The limiter takes `now` as a parameter, so its windowing is pure and testable.

There is deliberately no limit shared across all IPs (Req 8.3), so someone else's failed guesses can never lock her out.

#### Cookies (`cookies.js`)

```js
const policy = JSON.stringify({ Statement: [{
  Resource: `https://${APP_DOMAIN}/Memories/*`,
  Condition: { DateLessThan: { 'AWS:EpochTime': nowSeconds + 12 * 3600 } },
}] });
const signed = getSignedCookies({ policy, keyPairId, privateKey });
// → three headers:
// `${name}=${value}; Path=/Memories; Secure; HttpOnly; SameSite=Strict`
```

Lambda function URLs return multiple cookies through the response's `cookies` array. Each entry becomes its own `Set-Cookie` header.

#### Config (`config.js`)

All settings are Lambda environment variables, set once by hand in the Lambda console (Req 9.1). Lambda encrypts them at rest; they are visible in plain text only to someone signed in to your AWS account. A deploy pipeline that updates only the function code (`update-function-code`) leaves them untouched.

| Variable | Secret? | Value |
| --- | --- | --- |
| `AUTH_CONFIG` | yes | The hashed Auth_Config JSON (below), on one line |
| `CLOUDFRONT_PRIVATE_KEY_B64` | yes | The CloudFront private key PEM, base64-encoded so it fits on one line |
| `CLOUDFRONT_KEY_PAIR_ID` | no | The public key's ID from the CloudFront key group |
| `APP_DOMAIN` | no | The CloudFront domain, e.g. `d123abc.cloudfront.net` |

`loadConfig(env = process.env)` parses and validates these once per instance and caches the result in module scope. If anything is missing or malformed it records which variable is wrong (never its value), and every request gets 503 (Req 9.5). Changing a variable in the console starts fresh instances, so the change takes effect on the next request.

Size check: the key is about 2.3 KB once base64-encoded, and the Auth_Config is about 1–1.5 KB, which together fit under Lambda's 4 KB limit. The setup tool warns if they wouldn't (Req 9.7).

`handler.js` exports `createHandler({ env, now, signCookies })` for tests and Demo_Mode, plus the default `handler = createHandler({ env: process.env })` for Lambda.

#### Setup tool (`tools/make-config.mjs`)

Interactive, run locally by the Gift_Giver:

1. Prompts for the username, then the password twice (hidden input).
2. For each of 3 questions: the prompt text, then its one answer (hidden input), and prints the Normalized_Answer back so you can check it (Req 9.4).
3. Hashes everything, then either:
   - `--print` (default): prints the one-line `AUTH_CONFIG` value to paste into the Lambda console, or
   - `--demo`: writes it to the git-ignored Demo_Config file `Auth-function/demo/auth-config.local.json`.
4. With `--key <pem file>`, also prints the `CLOUDFRONT_PRIVATE_KEY_B64` value and runs the 4 KB size check.
5. Never writes plaintext answers or the password anywhere.

### Demo_Mode (`npm run dev:auth`)

A dev-only Vite plugin lets the whole sign-in run locally, with the real handler and the real login screen, and stand-ins only for CloudFront and Lambda.

```text
Front-end/
├── .env.demo                       # VITE_AUTH_ENABLED=true (committed, no secrets)
├── vite.config.js                  # adds authDemoPlugin() only when mode === 'demo'
└── dev/authDemoPlugin.js           # the CloudFront + Lambda stand-in (never bundled)
Auth-function/demo/                 # git-ignored
└── auth-config.local.json          # Demo_Config made by `make-config.mjs --demo`
```

`package.json` gains `"dev:auth": "vite --mode demo"`. The plugin uses `apply: 'serve'`, so `vite build` never includes it (Req 11.5).

When the dev server starts, the plugin:

1. Generates a throwaway RSA key pair in memory with `crypto.generateKeyPairSync` (demo key, never written to disk).
2. Reads the Demo_Config. If it's missing, it prints `Run: node ../Auth-function/tools/make-config.mjs --demo` and starts anyway, with sign-in returning 503 (Req 11.6).
3. Builds the real handler with `createHandler({ env: { AUTH_CONFIG, CLOUDFRONT_PRIVATE_KEY_B64: <demo key>, CLOUDFRONT_KEY_PAIR_ID: 'DEMO', APP_DOMAIN: 'localhost' } })`.

Then it adds middleware that runs before Vite's static file serving:

- **`/api/*` (Lambda stand-in):** checks that `x-amz-content-sha256` matches the body and returns 403 if not, as Lambda behind CloudFront would (Req 11.4). It converts the request into a function-URL event (method, path, headers, body, `CloudFront-Viewer-Address: 127.0.0.1:0`), calls the handler, and writes back the status, headers and each `cookies[]` entry as its own `Set-Cookie` (Req 11.2).
- **`/Memories/*` (CloudFront stand-in):** reads the three `CloudFront-*` cookies, decodes the policy, verifies `CloudFront-Signature` (RSA-SHA1 over the policy, CloudFront's URL-safe base64) with the demo public key, and checks `DateLessThan` and the resource pattern. If any check fails, it returns 403; otherwise it passes the request on to Vite, which serves the file from the `public/Memories` symlink (Req 11.3).

The handler signs exactly as in production, so the demo policy's resource is `https://localhost/Memories/*`. The stand-in checks the resource against that configured value rather than the dev server's real `http://localhost:<port>` address, so the handler needs no demo-specific code and the port doesn't matter.

**What Demo_Mode does and doesn't prove:** it runs the real handler, cookies, limiter, login screen and App phases end to end, and the real signature format. It does not exercise real CloudFront, OAC, IAM, or Lambda's environment variable limits.

**Browser note:** the cookies are `Secure`. Chrome and Firefox accept `Secure` cookies on `http://localhost`, but Safari does not, so use Chrome or Firefox for Demo_Mode.

## Data Models

### Auth_Config (`AUTH_CONFIG` JSON)

```json
{
  "version": 1,
  "usernameHash": "scrypt$32768$8$1$...$...",
  "passwordHash": "scrypt$32768$8$1$...$...",
  "questions": [
    { "prompt": "…", "answerHash": "scrypt$…" },
    { "prompt": "…", "answerHash": "scrypt$…" },
    { "prompt": "…", "answerHash": "scrypt$…" }
  ]
}
```

Exactly 3 questions, each with exactly one `answerHash`. The handler refuses to start (503) if the config doesn't match this shape.

### Limiter entries (in memory)

| Key | Value |
| --- | --- |
| `sha256 hex of IP` | `{ failures: number, windowStart: epoch s }` |

### Front-end request and response shapes

```ts
type StartResult  = { ok: true; questions: [string, string, string] } | Failure;
type FinishResult = { ok: true } | Failure;
type Failure = { ok: false; reason: 'mismatch' | 'rate-limited' | 'bad-request' | 'unavailable' | 'network'; retryAfterSeconds?: number };
```

## CloudFront and AWS setup (manual, deploy day)

This replaces the checklist in `docs/Private_Media_Deployment.md`. It is a starting outline: the exact steps, and whether a GitHub Actions pipeline handles any of them, are worked out at deploy time (task 13). Everything before then is built and checked in Demo_Mode.

AWS services used: **S3**, **CloudFront**, **Lambda**, and **CloudWatch Logs** (automatic, via Lambda's basic execution role). No Parameter Store, KMS setup, DynamoDB or API Gateway.

1. **S3:** bucket with Block Public Access on. Upload `Front-end/dist/` (without `dist/Memories/`) to the root and `Memories/` to `/Memories/`.
2. **Key pair:** generate an RSA 2048 key pair. Upload the public key to CloudFront and add it to a key group. Keep the private key PEM only long enough to run the setup tool with `--key`, then delete the local copy.
3. **Lambda:** Node.js LTS runtime, 512 MB, 10 s timeout, **reserved concurrency 1**, function URL with `AuthType: AWS_IAM`. Execution role: AWS's basic execution role only (CloudWatch Logs). Set the four environment variables from the Config table. Set the log group's retention to 7 days.
4. *(No database. The attempt limiter runs in the function's memory.)*
5. **CloudFront distribution:**
   - Origin A: S3 with OAC. Bucket policy allows the distribution `s3:GetObject` and `s3:ListBucket`.
   - Origin B: the Lambda function URL with an OAC of origin type Lambda, HTTPS only. Add the two `lambda add-permission` grants for `cloudfront.amazonaws.com` scoped to the distribution ARN.
   - Behavior `/Memories/*` → origin A, GET/HEAD only, restrict viewer access with the trusted key group, managed `CachingOptimized` policy.
   - Behavior `/api/*` → origin B, all methods, `CachingDisabled`, an origin request policy that forwards `CloudFront-Viewer-Address`, the query string, and all headers except `Host`.
   - Default behavior → origin A, unrestricted.
   - **No custom error responses** for 403 or 404.
6. **Secrets:** run `node Auth-function/tools/make-config.mjs --key <private key .pem>` and paste the printed `AUTH_CONFIG` and `CLOUDFRONT_PRIVATE_KEY_B64` values into the Lambda's environment variables.
6b. **Pipeline (optional, decided at deploy time):** a GitHub Actions workflow could build and upload `Front-end/dist/` to S3 and push the bundled function code with `update-function-code`, signing in to AWS through GitHub's OIDC connection to an IAM role. It never sets the environment variables, and it can't upload `Memories/`, which isn't in git; that folder is synced by hand.
7. **Verify:**
   - direct S3 URL → 403
   - `/Memories/dialogue/00.md` without cookie → 403
   - wrong password → 401, 6th wrong try → 429
   - full sign-in → 204 with 3 cookies; letters, paintings and photos load
   - missing letter while signed in → 404
   - closing the browser → login shown again

Expected cost is within free tiers: S3, Lambda, CloudWatch Logs and CloudFront have free allowances far above one person's use.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system: a formal statement about what the system should do. Properties are the bridge between human-readable requirements and machine-checked tests.*

Normalization, matching, cookie formatting, limiter arithmetic and the client's response mapping are pure or easily isolated, with wide input spaces, so they suit property tests. The UI flow, environment variable loading and the Demo_Mode plugin are covered by example tests.

### Property 1: Normalization is idempotent and ignores case, punctuation and spacing

*For any* string `s`, `normalizeAnswer(normalizeAnswer(s)) === normalizeAnswer(s)`. *For any* string `s` and any transformation that changes letter case, inserts or removes ASCII punctuation, or changes the amount of whitespace between words, the normalized result is unchanged. The result never has leading, trailing or doubled spaces.
**Validates: Requirements 4.1, 4.2**

### Property 2: Hash round-trip

*For any* string `x`, `verify(x, hash(x))` is true, and *for any* `y !== x`, `verify(y, hash(x))` is false. Two hashes of the same input differ (fresh salts) but both verify.
**Validates: Requirement 4.4**

### Property 3: All-or-nothing answer check

*For any* config of 3 questions with one accepted answer each and *any* 3 submitted answers, `checkAnswers` is true if and only if every submitted answer normalizes to that question's accepted answer. Changing any single answer to a different normalized value makes it false. Permuting answers across questions makes it false unless the accepted answers are equal.
**Validates: Requirements 4.1, 4.5**

### Property 4: Every comparison runs

*For any* request and config, the number of hash verifications performed by a finish check is exactly 5, regardless of which comparisons fail.
**Validates: Requirement 4.6**

### Property 5: Cookie headers have exactly the required shape

*For any* issue time and signer output, the handler produces exactly three cookies named `CloudFront-Policy`, `CloudFront-Signature`, `CloudFront-Key-Pair-Id`. Each has `Path=/Memories`, `Secure`, `HttpOnly`, `SameSite=Strict`, and no `Domain`, `Expires` or `Max-Age`. The policy's `DateLessThan` equals issue time + 43200 s.
**Validates: Requirements 5.1, 5.2, 5.3**

### Property 6: Limiter thresholds

*For any* sequence of timestamped failures and successes from any set of IPs, an IP is locked exactly when it has ≥ 5 counted failures in its current 15-minute window, failures from one IP never lock another, and a success clears only that IP's count.
**Validates: Requirements 8.1, 8.2, 8.3, 8.4**

### Property 7: Invalid bodies never reach the checks

*For any* body that is not valid JSON, exceeds 4 KB, or has a missing, non-string or wrong-count field, the handler returns 400, performs zero hash verifications, and records zero attempts.
**Validates: Requirement 4.8**

### Property 8: Probe and response mapping

*For any* HTTP status, `probeSession` returns `signed-in` iff the status is 200 or 404, `signed-out` iff it is 403, and `unreachable` otherwise or on a network error. `startLogin`/`finishLogin` map 401 → `mismatch`, 429 → `rate-limited` with `Retry-After`, 400 → `bad-request`, 503 → `unavailable`.
**Validates: Requirements 7.1–7.4, 8.7**

### Property 9: The body hash header matches the body

*For any* payload, the `x-amz-content-sha256` header sent by `postJson` equals the lowercase hex SHA-256 of the exact bytes sent as the body.
**Validates: Design constraint (OAC for Lambda function URLs)**

### Property 10: No secret appears in any response

*For any* config and request, no response body or header contains the plaintext username, password, any submitted answer, any hash from the config, or the private key.
**Validates: Requirements 4.7, 5.6**

## Error Handling

| Situation | Server | Client shows |
| --- | --- | --- |
| Wrong username or password | 401, attempt counted | "That username and password don't match." |
| Some answer wrong | 401, attempt counted | Back to question 1: "One of those didn't quite match. Let's try again." |
| Too many tries | 429 + `Retry-After` | "Too many tries for now. Take a breather and try again in N minutes." |
| Malformed request | 400, not counted | "Something went wrong. Please try again." |
| Missing or malformed environment variable | 503, log names the variable, never its value | "The museum is having trouble opening its doors. Please try again soon." |
| Network error or unexpected status | – | "Couldn't reach the museum. Check your connection and try again." + Retry |
| Cookie expired mid-visit | CloudFront 403 on a photo | ImageViewer: "This photo couldn't load. Refreshing the page should fix it." |

Logs record route, outcome (`ok | mismatch | limited | invalid | error`) and duration only, never bodies, IPs in plaintext, or config values.

## Testing Strategy

**Front-end** (Vitest + Testing Library + fast-check, existing setup):

- `authClient.property.test.js`: Properties 8, 9.
- `authClient.test.js`: HEAD request target, `credentials: 'same-origin'`, `cache: 'no-store'`, JSON body shape.
- `LoginScreen.test.jsx`: field labels and autocomplete attributes; empty-field validation; 401 on start keeps username and clears password; one question at a time with Back; finish sends all answers in one request; 401 on finish resets to question 1 with one generic message; 429 disables submit and shows minutes; focus moves on each step; no secrets in `localStorage`/`sessionStorage`.
- `StartupGate.test.jsx`: phase transitions for signed-in / signed-out / unreachable (+ Try again); children never render before `load()` resolves; auth off skips the probe and login; `load()` is never called while the Login_Screen shows. Existing App tests stay as they are, since App is unchanged.
- `ImageViewer.test.jsx`: photo `onError` shows the refresh message.
- Existing tests keep passing. Tests that render `App` mock `authClient` with `AUTH_ENABLED = false`.

**Auth function** (`Auth-function/`, its own Vitest + fast-check):

- `normalize.property.test.js`: Property 1.
- `hashing.property.test.js`: Property 2 (low `N` injected for speed; one example test at the real parameters).
- `checks.property.test.js`: Properties 3, 4.
- `cookies.property.test.js`: Property 5.
- `limiter.property.test.js`: Property 6 with injected timestamps.
- `handler.property.test.js`: Properties 7, 10.
- `handler.test.js`: route table, 404 for unknown routes, `Cache-Control: no-store`, 503 for each missing or malformed environment variable (log names it, never shows its value), success clears the IP counter.
- `make-config.test.js`: produces a valid Auth_Config shape from scripted input; `--print` writes nothing to disk; `--demo` writes only the Demo_Config; `--key` prints base64 that decodes to the PEM; the 4 KB warning fires above the limit.

**Demo_Mode** (`Front-end/dev/__tests__/authDemoPlugin.test.js`):

- `/Memories/*` without cookies → 403; with cookies from a real sign-in → passes through; with a tampered signature, an expired policy, or a policy for another path → 403.
- `/api/*` with a wrong `x-amz-content-sha256` → 403; with a correct one → reaches the handler; three cookies come back as three `Set-Cookie` headers.
- Missing Demo_Config → startup message, sign-in returns 503.
- `vite build` output contains no plugin code (search the built bundle for a marker string).

**Manual (deploy day):** the verification list in step 7 of the setup.

## Decisions

- **Attempt limit:** per viewer IP only (5 failures per 15 minutes), no site-wide limit, counted in memory on a single Lambda instance (reserved concurrency 1). No DynamoDB; counts may reset after the function sits idle.
- **Answers:** exactly one accepted answer per question. Normalization still forgives case, spacing and punctuation; the Gift_Giver can tell her the answer if needed.
- **Sign-out:** no control. Closing the browser signs her out.
- **Secrets:** Lambda environment variables set by hand, not Parameter Store or CI/CD secrets.
- **Order of work:** build everything and confirm it in Demo_Mode first; AWS setup and any GitHub pipeline are decided at deploy time.
- **Look:** a plain framed panel for now, with no themed scene. The Gift_Giver will restyle it once the sign-in is confirmed working; all styling stays in `LoginScreen.css`.
