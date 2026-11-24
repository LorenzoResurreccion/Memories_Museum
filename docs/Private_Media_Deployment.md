# Keeping the Memories Private (Deployment Design Note)

> **Status:** built and tested locally; AWS deployment is still to do. The login (`Auth-function/`,
> `LoginScreen`, `StartupGate`) is implemented and runs end to end on your machine with
> `npm run dev:auth` (see "Try it locally" below). What remains is the AWS setup and an optional
> deploy pipeline, task 13 of the spec. The full requirements, design and task list live in
> `.kiro/specs/museum-login/`; this note is the short "why and how".
>
> Adding memories is unchanged: drop `NN.md` / `NN.jpg` / `NN.png` in `Memories/` and upload. The
> letters, photos and paintings are all served from `/Memories/*`, so the login protects all three.

## The problem in one sentence

The browser must be able to fetch the letters and photos for the game to work, but they must not
be readable by anyone who finds a link, and a purely static site can't keep that promise alone.

## Why a static site alone can't do it

Deciding "this viewer may see the memories" means checking a secret (the password) and holding a
signing key. A static S3 site ships only HTML/JS/CSS to the browser; it has nowhere to keep a
secret the client can't read. So:

- **A login checked in the browser + a public bucket** gates the **screen**, not the **files**.
  The URLs sit in the page's JavaScript and the bucket serves them to anyone who asks.
- **Truly private files** need *something server-side* to check the password and grant access.
  That's unavoidable, not an AWS quirk.

The goal is **accessible only after signing in**: the browser still gets the files, but only once
it proves it's allowed.

## The design: private bucket + CloudFront + signed cookies + one small function

1. **The S3 bucket is fully private** (*Block all public access*). Nothing is fetchable from S3
   directly.
2. **CloudFront is the only way in**, through **Origin Access Control (OAC)**. The bucket policy
   trusts only this distribution; direct S3 URLs return `403`.
3. **CloudFront serves `/Memories/*` only to requests carrying a valid signed cookie.** No valid
   signature → `403`.
4. **One small Lambda function** (`Auth-function/`) checks the sign-in and issues those cookies.
   It sits behind the same CloudFront domain at `/api/*`, as a Lambda function URL with OAC, so
   there is no CORS and the cookies are first-party.

This is the single justified exception to the project's "no backend" rule (see
`.kiro/steering/tech.md`): the game itself stays a static site; only access to `/Memories/*` is
gated.

### Why signed cookies, not signed URLs

| | Signed **cookies** | Signed **URLs** |
| --- | --- | --- |
| How it gates access | One credential the browser stores, sent with **every** request under `/Memories/*` | A separate signature baked into **each** file URL |
| Letters (`fetch`), photos (`<img>`), paintings (Phaser `load.image`) | All covered automatically, same origin | Every URL must be signed, and re-signed on expiry |
| Code changes | None to `mediaBase.js`, `loadMemories.js`, `paintings.js` or `preload()`: the plain `/Memories/...` URLs just start requiring the cookie | URL signing spread through the data modules |

So: **signed cookies.**

## How the sign-in works

1. She opens the site. CloudFront serves the app freely (the default behavior is unrestricted).
2. `StartupGate` sends `HEAD /Memories/dialogue/00.md`. **403** means not signed in, so the login
   shows; **200 or 404** means already signed in (a refresh), so the museum loads.
3. She enters the username and password. The page calls `POST /api/login/start`, which checks
   them and returns the three question prompts. No cookie yet.
4. She answers the three questions, one at a time. Nothing is sent until the last one; then
   `POST /api/login/finish` re-checks the username and password **and** all three answers
   together, so a failure never reveals which answer was wrong.
5. On success the function signs a 12-hour CloudFront policy for `https://<app domain>/Memories/*`
   and returns **three `Set-Cookie` headers** (`CloudFront-Policy`, `CloudFront-Signature`,
   `CloudFront-Key-Pair-Id`). Only then does `StartupGate` load the letters and start the game.
6. Every later request under `/Memories/*` carries the cookies automatically. CloudFront checks
   the signature against the public key and the policy's expiry, then serves the file.

**Important:** do **not** configure a CloudFront custom error page for 403 (or 404). Custom error
responses apply to the whole distribution, so they would turn the sign-in check's and the letter
loader's 403/404 into HTML pages. The app handles 403 itself. And give the distribution
`s3:ListBucket` on the bucket, so a signed-in request for a missing letter returns 404 (which ends
the hallway) rather than 403 (which would look like "signed out").

## Security details, as built

- **Session cookie:** no `Expires` / `Max-Age`, so the browser drops it when it closes. She signs
  in on each new browser session; a refresh keeps her signed in.
- **12-hour signed policy:** CloudFront also requires an end time, which caps access even if a
  browser restores old cookies. If a tab stays open past it, a photo that fails to load says to
  refresh, which sends her through sign-in again.
- **Cookie attributes:** `Path=/Memories; Secure; HttpOnly; SameSite=Strict`, with no `Domain`
  (host-only).
- **Matching:** usernames ignore case and surrounding spaces; answers ignore case, spacing and
  punctuation; passwords match exactly. The username, password and answers are stored only as
  salted scrypt hashes and compared in constant time.
- **Guessing limit:** 5 wrong tries from one connection pause that connection for 15 minutes.
  Counted in the function's memory (it runs as a single instance), so counts can reset after it
  sits idle; an accepted trade-off. No site-wide limit, so nobody else can lock her out.
- **Secrets:** the hashed login settings and the CloudFront private key are Lambda environment
  variables, set once by hand in the Lambda console. They are never in git, the JS bundle, any
  `VITE_*` variable, CI secrets, or logs. Logs record only the route, outcome and timing.
- **Methods:** the `/Memories/*` behavior allows only `GET` and `HEAD`. CloudFront doesn't check
  signatures on `OPTIONS`, so it is simply not allowed there.

## What this does and doesn't protect

- **Does:** stops direct S3 access (private bucket + OAC) and unauthenticated CloudFront access to
  `/Memories/*` (signed cookies). The letters, photos and paintings are genuinely behind the
  sign-in.
- **Doesn't:** stop the signed-in recipient from saving a photo once it's on her screen, which is
  fine; she's the audience.

## Try it locally (Demo_Mode)

You can run the whole sign-in on your machine before any AWS setup:

```bash
cd Auth-function && node tools/make-config.mjs --demo   # set username, password, 3 questions
cd ../Front-end && npm run dev:auth                     # open in Chrome or Firefox
```

A dev-only Vite plugin (`Front-end/dev/authDemoPlugin.js`) runs the real login handler for
`/api/*` and stands in for CloudFront on `/Memories/*`, verifying the signed cookies against a
demo key generated at startup. It is never part of `npm run build`. Use Chrome or Firefox; Safari
rejects `Secure` cookies on `http://localhost`.

## Deploy checklist (task 13)

The authoritative step-by-step is "CloudFront and AWS setup" in
`.kiro/specs/museum-login/design.md`. In short:

1. **S3:** private bucket. Upload `Front-end/dist/` (without its `dist/Memories/` copy) to the
   root and `Memories/` to `/Memories/`.
2. **Key pair:** RSA 2048. Public key → CloudFront key group. Keep the private key only long
   enough to run the setup tool.
3. **Lambda:** Node.js, 512 MB, **reserved concurrency 1**, function URL with `AuthType: AWS_IAM`,
   basic execution role (logs only). Upload `Auth-function/dist/handler.mjs` (`npm run build`).
4. **Environment variables**, by hand: run
   `node Auth-function/tools/make-config.mjs --key <private key .pem>` and paste `AUTH_CONFIG` and
   `CLOUDFRONT_PRIVATE_KEY_B64`; add `CLOUDFRONT_KEY_PAIR_ID` and `APP_DOMAIN`.
5. **CloudFront:** S3 origin with OAC (`s3:GetObject` + `s3:ListBucket`); Lambda function URL
   origin with OAC; behaviors `/Memories/*` (GET/HEAD, trusted key group), `/api/*` (all methods,
   caching disabled), default (unrestricted). **No custom error responses.**
   The `/api/*` origin request policy must **forward all cookies**, or CloudFront strips the
   sign-in's `Set-Cookie` headers: login appears to succeed but every memory shows as a
   placeholder. It also whitelists the headers `CloudFront-Viewer-Address`, `Content-Type`,
   `Accept` and `Origin` (never `Host`) and forwards all query strings. See step 5 of the
   design's setup section for why each setting matters.
6. **Pipeline (optional):** a GitHub Actions workflow can upload the built app to S3 and push the
   function code with `update-function-code` (OIDC sign-in to AWS). It never touches the
   environment variables, and can't upload `Memories/`, which isn't in git.
7. **Verify:** direct S3 URL → 403; `/Memories/...` without cookies → 403; wrong password → 401;
   6th wrong try → 429; full sign-in → cookies set and everything loads; missing letter while
   signed in → 404; closing the browser → login again.

## References

- CloudFront — [Restrict access to files (overview)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-overview.html)
- CloudFront — [How signed cookies work](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
- CloudFront — [Decide between signed URLs and signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-choosing-signed-urls-cookies.html)
- CloudFront — [Specify signers (trusted key groups)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-trusted-signers.html)
- CloudFront — [Restrict access to an S3 origin with OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
- CloudFront — [Restrict access to a Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)
