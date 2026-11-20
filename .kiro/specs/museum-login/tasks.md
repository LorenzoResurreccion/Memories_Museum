# Implementation Plan: Museum Login

## Overview

Build the sign-in in four layers: the pure Auth-function modules first (normalize, hash, checks, cookies, limiter), then the Lambda handler and setup tool, then the front-end (client, LoginScreen, App phases), then the local Demo_Mode that runs it all end to end. AWS setup is manual and listed last; it is not needed to build or test the code. Front-end paths are under `Front-end/`; the auth function is the new top-level `Auth-function/` folder with its own `package.json`. Property tests use `*.property.test.js`, `{ numRuns: 100 }` or more, and a tag comment `Feature: museum-login, Property N: ...`. Never start the dev server; run `npm run test` and `npm run lint` in each package at checkpoints.

**Status:** not started. Tasks 1–11 need no AWS account and are confirmed locally in Demo_Mode (`npm run dev:auth`). AWS setup and any GitHub pipeline are worked out at deploy time (task 13).

## Tasks

- [ ] 1. Scaffold `Auth-function/`
  - [ ] 1.1 Create `package.json` (ES modules; deps `@aws-sdk/cloudfront-signer`; dev deps `vitest`, `fast-check`, `esbuild`, `eslint`), scripts `test` (`vitest --run`), `lint`, `build` (esbuild bundle of `src/handler.js` to `dist/handler.mjs`)
  - [ ] 1.2 Add `Auth-function/` to the repo README structure and steering `structure.md`; git-ignore `Auth-function/dist/`, `Auth-function/node_modules/` and `Auth-function/demo/`
  - _Requirements: 9.1_

- [ ] 2. Pure matching and hashing
  - [ ] 2.1 `src/normalize.js`: `normalizeAnswer`, `normalizeUsername`
    - _Requirements: 4.1, 4.2, 4.3_
  - [ ] 2.2 `src/hashing.js`: `hash`, `verify` (scrypt, stored format `scrypt$N$r$p$salt$key`, `timingSafeEqual`), with injectable cost for tests
    - _Requirements: 4.4_
  - [ ] 2.3 `src/checks.js`: `checkCredentials`, `checkAnswers`, both running every comparison; a verify counter seam for tests
    - _Requirements: 4.1, 4.5, 4.6_
  - [ ]* 2.4 Property test: Property 1 (normalization) in `normalize.property.test.js`
    - **Validates: Requirements 4.1, 4.2**
  - [ ]* 2.5 Property test: Property 2 (hash round-trip) in `hashing.property.test.js`
    - **Validates: Requirement 4.4**
  - [ ]* 2.6 Property tests: Properties 3 and 4 in `checks.property.test.js`
    - **Validates: Requirements 4.1, 4.5, 4.6**

- [ ] 3. Cookies and limiter
  - [ ] 3.1 `src/cookies.js`: custom policy for `https://${APP_DOMAIN}/Memories/*`, 12-hour `DateLessThan`, three cookie strings with `Path=/Memories; Secure; HttpOnly; SameSite=Strict`
    - _Requirements: 5.1, 5.2, 5.3_
  - [ ] 3.2 `src/limiter.js`: `isLocked(ip, now)`, `recordFailure(ip, now)`, `clear(ip)` over a module-scope `Map` keyed by hashed IP; sweep expired entries; `now` injected
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_ (per-IP only, no global limit, in memory)
  - [ ]* 3.3 Property test: Property 5 in `cookies.property.test.js`
    - **Validates: Requirements 5.1, 5.2, 5.3**
  - [ ]* 3.4 Property test: Property 6 in `limiter.property.test.js`
    - **Validates: Requirements 8.1–8.4**

- [ ] 4. Checkpoint: `npm run test` and `npm run lint` in `Auth-function/` pass

- [ ] 5. Handler and config
  - [ ] 5.1 `src/config.js`: `loadConfig(env)` reads `AUTH_CONFIG`, `CLOUDFRONT_PRIVATE_KEY_B64`, `CLOUDFRONT_KEY_PAIR_ID`, `APP_DOMAIN` once per instance, validates the Auth_Config shape, and reports which variable is bad without its value
    - _Requirements: 9.1, 9.5, 9.6_
  - [ ] 5.2 `src/handler.js`: `createHandler({ env, now, signCookies })` plus the default Lambda `handler`; routes `POST /api/login/start` and `/api/login/finish`, 4 KB / JSON / field validation (400, not counted), viewer IP from `CloudFront-Viewer-Address`, limiter gate (429 + `Retry-After`), checks, 401 with attempt recorded, 204 + `cookies` array on success, `Cache-Control: no-store` everywhere, secret-free logging
    - _Requirements: 4.5–4.8, 5.1, 5.6, 8.1–8.4_
  - [ ]* 5.3 Property tests: Properties 7 and 10 in `handler.property.test.js`
    - **Validates: Requirements 4.7, 4.8, 5.6**
  - [ ]* 5.4 Example tests in `handler.test.js` (routes, 404, no-store, 503 per missing/malformed environment variable, counter cleared on success)
    - _Requirements: 4.8, 8.4_

- [ ] 6. Setup tool
  - [ ] 6.1 `tools/make-config.mjs`: hidden prompts, password confirmation, 3 questions with one answer each, show each Normalized_Answer; `--print` (one-line `AUTH_CONFIG`), `--demo` (write the git-ignored Demo_Config), `--key <pem>` (print `CLOUDFRONT_PRIVATE_KEY_B64`, run the 4 KB check); no plaintext written anywhere
    - _Requirements: 9.2, 9.3, 9.4, 9.7_
  - [ ]* 6.2 `make-config.test.js` with scripted input: valid shape, `--print` writes nothing, `--demo` writes only the Demo_Config, `--key` base64 round-trips, 4 KB warning
    - _Requirements: 9.2, 9.3, 9.7_

- [ ] 7. Checkpoint: `npm run test`, `npm run lint` and `npm run build` in `Auth-function/` pass

- [ ] 8. Front-end client
  - [ ] 8.1 `src/data/authClient.js`: `AUTH_ENABLED`, `probeSession`, `startLogin`, `finishLogin`, `postJson` (SHA-256 body header, `same-origin`, `no-store`)
    - _Requirements: 7.1–7.4, 8.7_
  - [ ] 8.2 `Front-end/.env.production` with `VITE_AUTH_ENABLED=true`
    - _Requirements: 1.3_
  - [ ]* 8.3 Property tests: Properties 8 and 9 in `authClient.property.test.js`
    - **Validates: Requirements 7.1–7.4, 8.7**
  - [ ]* 8.4 Example tests in `authClient.test.js`
    - _Requirements: 7.1_

- [ ] 9. Login screen and App phases
  - [ ] 9.1 `src/components/LoginScreen.jsx` + `.css`: Credential_Step, Question_Step (one at a time, Back, "1 of 3"), messages per the Error Handling table, `aria-live`, focus management, 429 countdown, museum styling
    - _Requirements: 2.1–2.6, 3.1–3.7, 8.7, 10.1–10.4_
  - [ ] 9.2 `src/App.jsx`: `phase` state machine (`checking → login | loading → ready`); mount `GameCanvas` only in `ready`; `main.jsx` renders `<App />` directly
    - _Requirements: 1.1–1.5, 5.4, 5.5, 7.2–7.4_
  - [ ] 9.3 `ImageViewer.jsx`: photo `onError` refresh message
    - _Requirements: 7.6_
  - [ ]* 9.4 `LoginScreen.test.jsx`
    - _Requirements: 2.1–2.6, 3.1–3.7, 8.7, 10.2_
  - [ ]* 9.5 `App.auth.test.jsx`; update existing App tests to mock `authClient` with auth off
    - _Requirements: 1.1–1.5, 7.1–7.4_
  - [ ]* 9.6 `ImageViewer.test.jsx`: `onError` case
    - _Requirements: 7.6_

- [ ] 10. Local Demo_Mode
  - [ ] 10.1 `Front-end/dev/authDemoPlugin.js`: dev-only Vite plugin (`apply: 'serve'`) that generates an in-memory demo key, loads the Demo_Config (startup hint + 503 if missing), runs the real handler for `/api/*` with an `x-amz-content-sha256` check, and gates `/Memories/*` by verifying the signed cookies' signature, expiry and resource
    - _Requirements: 11.2, 11.3, 11.4, 11.6_
  - [ ] 10.2 Wire it in: `vite.config.js` adds the plugin only when `mode === 'demo'`; `Front-end/.env.demo` with `VITE_AUTH_ENABLED=true`; `package.json` script `"dev:auth": "vite --mode demo"`
    - _Requirements: 11.1, 11.5, 11.7_
  - [ ]* 10.3 `Front-end/dev/__tests__/authDemoPlugin.test.js` (cookie gate cases, body hash check, Set-Cookie passthrough, missing Demo_Config, plugin absent from `vite build` output)
    - _Requirements: 11.2–11.6_
  - [ ] 10.4 Manual walkthrough by the Gift_Giver: `node Auth-function/tools/make-config.mjs --demo`, then `npm run dev:auth` in Chrome or Firefox. Check the sign-in, a wrong password, a wrong answer, the 5-tries pause, a refresh staying signed in, closing the browser signing out, and the game only starting after sign-in.
    - _Requirements: 1–5, 7, 8, 10, 11_

- [ ] 11. Checkpoint: `npm run test`, `npm run lint` and `npm run build` pass in `Front-end/` and `Auth-function/`

- [ ] 12. Docs and steering
  - [ ] 12.1 Update `docs/Private_Media_Deployment.md`: point to this spec, replace its checklist with the design's setup section, drop the "403 page → login" step and the Parameter Store references
  - [ ] 12.2 Update `.kiro/steering/tech.md` (Backend section: the auth function now exists, its boundary, secrets as Lambda environment variables, the "403 = not signed in" rule, and Demo_Mode), `structure.md` (`Auth-function/`, `LoginScreen`, `authClient`, `dev/authDemoPlugin.js`), `product.md` (sign-in in the core experience), and the root `README.md` (`npm run dev:auth`)

- [ ] 13. Deploy (deferred: planned at deploy time, by the Gift_Giver)
  - [ ] 13.1 Decide what a GitHub Actions pipeline handles (likely: build and upload `Front-end/dist/` to S3, push the bundled function with `update-function-code`, OIDC sign-in to AWS) and what stays manual (environment variables, `Memories/` sync)
  - [ ] 13.2 AWS setup following "CloudFront and AWS setup" in `design.md` (S3, CloudFront, Lambda with reserved concurrency 1, environment variables set by hand)
  - [ ] 13.3 Run the verification list (step 7)
  - _Requirements: 6.1–6.7, 8.6, 9.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Tasks 1–12 need no AWS account: settings come from environment variables (fakes in tests, the Demo_Config in Demo_Mode), and the limiter is in memory by design.
- Decided: per-IP attempt limit only, exactly one accepted answer per question, no sign-out control, in-memory attempt limiter on one Lambda instance (no DynamoDB), secrets as Lambda environment variables set by hand (no Parameter Store), Demo_Mode before any AWS work, plain login panel (visual polish comes after the sign-in is confirmed working).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "8.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "3.2", "8.1"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "3.3", "3.4", "8.3", "8.4"] },
    { "id": 3, "tasks": ["2.6", "5.1", "9.1", "9.3"] },
    { "id": 4, "tasks": ["5.2", "6.1", "9.2", "9.6"] },
    { "id": 5, "tasks": ["5.3", "5.4", "6.2", "9.4", "9.5"] },
    { "id": 6, "tasks": ["10.1", "10.2"] },
    { "id": 7, "tasks": ["10.3"] },
    { "id": 8, "tasks": ["10.4"] },
    { "id": 9, "tasks": ["12.1", "12.2"] },
    { "id": 10, "tasks": ["13.1"] },
    { "id": 11, "tasks": ["13.2"] },
    { "id": 12, "tasks": ["13.3"] }
  ]
}
```
