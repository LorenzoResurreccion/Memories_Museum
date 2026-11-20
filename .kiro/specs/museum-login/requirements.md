# Requirements Document

## Introduction

The Living Museum's personal content (dialogue letters, photos, paintings) lives in the git-ignored `Memories/` folder and is served by URL from the same S3 bucket as the app. Today any URL under `/Memories/` can be fetched by anyone who knows it. This feature puts that content behind a login that feels like part of the gift rather than an account system.

The recipient signs in with a username and password that the gift-giver hands to her, then answers three security questions about the relationship. Only after all of that is checked does she enter the museum. The check happens on the server, and CloudFront refuses every `/Memories/*` request that does not carry a valid signed cookie, so the content is protected rather than hidden behind a screen.

She signs in on every new browser session: the access cookie is a session cookie and is gone when the browser closes. Refreshing the page within the same browser session keeps her signed in.

This is the one backend component the project allows (see `docs/Private_Media_Deployment.md` and the "Backend" section of `.kiro/steering/tech.md`). The game itself stays a static site; only access to `/Memories/*` is gated. No account system, email, password reset, or multi-user support is in scope.

## Glossary

- **Recipient**: The one person the gift is for. The only intended user.
- **Gift_Giver**: The author of the museum, who sets the credentials and questions and runs the setup.
- **Login_Screen**: The React screen shown before the museum, owning the credential and question steps.
- **Credential_Step**: The first step of the Login_Screen: username and password.
- **Question_Step**: The second step: three security questions shown one at a time.
- **Security_Question**: A question about the relationship with exactly one Accepted_Answer.
- **Accepted_Answer**: The one correct answer to a Security_Question, stored only as a hash of its Normalized_Answer.
- **Normalized_Answer**: An answer after normalization: Unicode NFKC, lowercase, every character that is not a letter, digit or space removed, runs of whitespace collapsed to one space, leading and trailing spaces trimmed.
- **Auth_Function**: The AWS Lambda function behind `/api/*` that checks credentials and answers and issues the Access_Cookies.
- **Auth_Config**: The secret configuration read by the Auth_Function: username, password hash, Security_Question prompts and Accepted_Answer hashes.
- **Access_Cookies**: The three CloudFront signed cookies (`CloudFront-Policy`, `CloudFront-Signature`, `CloudFront-Key-Pair-Id`) that grant access to `/Memories/*`.
- **Access_Window**: The validity period written into the Access_Cookies' signed policy (12 hours from issue).
- **Protected_Path**: Every URL under `/Memories/*` on the app's CloudFront domain.
- **Attempt_Limiter**: The Auth_Function component that counts failed attempts and pauses checking.
- **Session_Probe**: The app's startup check of whether the browser already holds valid Access_Cookies.
- **Auth_Enabled**: The build-time flag `VITE_AUTH_ENABLED`. `true` in production builds and in Demo_Mode, unset (false) in `npm run dev`.
- **Demo_Mode**: Running the app locally with `npm run dev:auth`, where a dev-only Vite plugin stands in for CloudFront and runs the real Auth_Function handler, so the whole sign-in can be tried without AWS.
- **Demo_Config**: The git-ignored local file `Auth-function/demo/auth-config.local.json` holding a hashed Auth_Config for Demo_Mode.

## Requirements

### Requirement 1: Gate the museum behind the Login_Screen

**User Story:** As the Recipient, I want a short sign-in before the museum opens, so that the museum feels private and made for me.

#### Acceptance Criteria

1. WHILE Auth_Enabled is true and the Session_Probe has not confirmed access, THE App SHALL render the Login_Screen and SHALL NOT mount the Phaser game or request any Protected_Path other than the Session_Probe request.
2. WHEN the Recipient completes the Question_Step successfully, THE App SHALL call `loadMemories()` and SHALL mount the Phaser game only after `loadMemories()` resolves.
3. WHILE Auth_Enabled is false, THE App SHALL skip the Login_Screen, call `loadMemories()`, and mount the game, matching the current behavior.
4. WHILE the Session_Probe or `loadMemories()` is in progress, THE App SHALL show a loading state and SHALL NOT show the Login_Screen form or the game.
5. THE `main.jsx` entry SHALL render the App immediately and SHALL NOT call `loadMemories()` itself; the App owns the order of probe, login, loading and game.

### Requirement 2: Credential_Step

**User Story:** As the Recipient, I want to enter the username and password I was given, so that only I can start the questions.

#### Acceptance Criteria

1. THE Credential_Step SHALL show a username field (`autocomplete="username"`), a password field (`type="password"`, `autocomplete="current-password"`), and a submit control, each with a visible label.
2. WHEN the Recipient submits the Credential_Step, THE Login_Screen SHALL send the username and password to `POST /api/login/start` and SHALL disable the submit control until a response or error arrives.
3. WHEN `POST /api/login/start` succeeds, THE Login_Screen SHALL move to the Question_Step using the three question prompts in the response.
4. IF `POST /api/login/start` returns 401, THEN THE Login_Screen SHALL stay on the Credential_Step, clear the password field, keep the username, and show a message saying the username and password don't match.
5. IF either field is empty, THEN THE Login_Screen SHALL NOT send a request and SHALL show which field is missing.
6. THE Login_Screen SHALL NOT store the password in `localStorage`, `sessionStorage`, cookies, the URL, or logs; it holds it in component state only until the Question_Step finishes or the screen unmounts.

### Requirement 3: Question_Step

**User Story:** As the Recipient, I want to answer three questions about us, one at a time, so that signing in feels like a small part of the gift.

#### Acceptance Criteria

1. THE Question_Step SHALL show exactly one Security_Question at a time, in the order returned by the Auth_Function, with its number ("1 of 3"), one answer field (`autocomplete="off"`), and a control to continue.
2. WHEN the Recipient continues from question 1 or 2, THE Login_Screen SHALL keep the answer locally and show the next question without sending a request.
3. THE Question_Step SHALL let the Recipient go back to the previous question with the previous answer filled in.
4. WHEN the Recipient continues from question 3, THE Login_Screen SHALL send the username, password and all three answers in one `POST /api/login/finish` request.
5. IF `POST /api/login/finish` returns 401, THEN THE Login_Screen SHALL return to question 1 with all answer fields cleared and SHALL show one message that some answer didn't match, without saying which.
6. IF an answer field is empty, THEN THE Login_Screen SHALL NOT continue and SHALL ask for an answer.
7. THE Login_Screen SHALL NOT send answers to the server one at a time, so the server's response never reveals which answer was wrong.

### Requirement 4: Answer and credential checking

**User Story:** As the Recipient, I want small differences in how I type an answer to still count, so that a typo in capitalization or spacing never locks me out of my gift.

#### Acceptance Criteria

1. THE Auth_Function SHALL compare each submitted answer by computing its Normalized_Answer and checking it against that Security_Question's Accepted_Answer hash.
2. THE Auth_Function SHALL treat answers that differ only in letter case, punctuation, or whitespace as the same answer.
3. THE Auth_Function SHALL compare the username after trimming and lowercasing, and SHALL compare the password exactly, with no normalization.
4. THE Auth_Function SHALL store and compare the password and every Accepted_Answer only as salted scrypt hashes, and SHALL compare hashes with a constant-time comparison.
5. WHEN `POST /api/login/finish` is called, THE Auth_Function SHALL check the username, the password, and all three answers on every call, and SHALL grant access only if all five match.
6. WHEN any check in `POST /api/login/finish` fails, THE Auth_Function SHALL still compute every hash comparison for that request, so that response time does not reveal how many checks passed.
7. THE Auth_Function SHALL return the Security_Question prompts only from a successful `POST /api/login/start`, and SHALL NOT include Accepted_Answers or hashes in any response.
8. IF a request body is not valid JSON, is larger than 4 KB, or has missing or non-string fields, THEN THE Auth_Function SHALL return 400 without checking credentials or counting an attempt.

### Requirement 5: Access_Cookies

**User Story:** As the Gift_Giver, I want access to end when she closes the browser, so that the museum is not left open on a shared or borrowed device.

#### Acceptance Criteria

1. WHEN all checks in `POST /api/login/finish` pass, THE Auth_Function SHALL respond 204 with exactly three `Set-Cookie` headers, one per Access_Cookie.
2. THE Auth_Function SHALL sign the Access_Cookies with a CloudFront custom policy whose resource is `https://<app domain>/Memories/*` and whose `DateLessThan` is the issue time plus the Access_Window.
3. EACH Access_Cookie SHALL have the attributes `Path=/Memories`, `Secure`, `HttpOnly` and `SameSite=Strict`, SHALL have no `Domain` attribute, and SHALL have no `Expires` or `Max-Age` attribute, so that it is a host-only session cookie.
4. THE App SHALL treat a closed browser as signed out: on the next visit after the session cookies are gone, the Session_Probe fails and the Login_Screen is shown.
5. WHILE the Access_Cookies are present and inside the Access_Window, THE App SHALL treat a page refresh as still signed in and SHALL NOT show the Login_Screen.
6. THE Auth_Function SHALL NOT return the CloudFront private key, the Auth_Config, or any hash in a response, header, or log line.

### Requirement 6: CloudFront enforcement

**User Story:** As the Gift_Giver, I want the letters, photos and paintings to be unreadable without signing in, so that the privacy is real and not just a screen.

#### Acceptance Criteria

1. THE CloudFront distribution SHALL require a valid Access_Cookie signature from the trusted key group for every request to a Protected_Path, and SHALL return 403 when it is missing, invalid, or outside the Access_Window.
2. THE S3 bucket SHALL block all public access and SHALL be readable only by the CloudFront distribution through Origin Access Control.
3. THE S3 bucket policy SHALL grant the distribution `s3:ListBucket` in addition to `s3:GetObject`, so that a signed-in request for a missing letter returns 404 and a 403 always means "not signed in".
4. THE Protected_Path cache behavior SHALL allow only `GET` and `HEAD`.
5. THE distribution SHALL NOT configure a custom error response for status 403 or 404, because custom error responses apply to the whole distribution and would turn the loader's and Session_Probe's 403/404 into HTML pages.
6. THE `/api/*` cache behavior SHALL route to the Auth_Function's function URL through Origin Access Control for Lambda, with caching disabled and `POST` allowed.
7. THE Auth_Function's function URL SHALL use `AuthType: AWS_IAM` and SHALL be invocable only by the CloudFront distribution.

### Requirement 7: Session_Probe and loader behavior

**User Story:** As the Recipient, I want refreshing the page to keep me in the museum, so that I don't have to answer the questions again in the same visit.

#### Acceptance Criteria

1. WHEN the App starts with Auth_Enabled true, THE App SHALL send `HEAD <MEDIA_BASE_URL>/dialogue/00.md` as the Session_Probe.
2. IF the Session_Probe returns 200 or 404, THEN THE App SHALL treat the session as signed in and proceed to `loadMemories()`.
3. IF the Session_Probe returns 403, THEN THE App SHALL show the Login_Screen.
4. IF the Session_Probe fails with a network error or any other status, THEN THE App SHALL show the Login_Screen with a message that the museum couldn't be reached, and a retry control.
5. THE `loadMemories()` behavior SHALL stay unchanged: it ends the letter count at the first letter that is missing for any reason, and never rejects.
6. IF a memory photo fails to load in the ImageViewer, THEN THE ImageViewer SHALL show a short message suggesting a page refresh, instead of a broken image.

### Requirement 8: Attempt limiting

**User Story:** As the Gift_Giver, I want guessing to be slow, so that someone who knows us can't try answers until one works.

#### Acceptance Criteria

1. THE Attempt_Limiter SHALL count a failed attempt for each 401 response from either endpoint, keyed by the viewer IP from the `CloudFront-Viewer-Address` header.
2. WHEN a viewer IP reaches 5 failed attempts within 15 minutes, THE Attempt_Limiter SHALL reject further requests from that IP with 429 and a `Retry-After` header until 15 minutes after its first counted failure, without checking credentials.
3. THE Attempt_Limiter SHALL limit attempts per viewer IP only, with no limit shared across all IPs, so that failures from others can never lock the Recipient out.
4. WHEN a request returns 204 from `POST /api/login/finish`, THE Attempt_Limiter SHALL clear that IP's failure count.
5. THE Attempt_Limiter SHALL keep its counters in the Auth_Function's memory, keyed by a hash of the viewer IP, SHALL drop entries whose window has ended, and SHALL keep no plaintext IPs, credentials or answers in them.
6. THE Auth_Function SHALL run with a reserved concurrency of 1, so that a single instance sees every attempt. Counters MAY reset when that instance is replaced after being idle; this is an accepted trade-off.
7. WHEN the Login_Screen receives 429 with a `Retry-After` header, THE Login_Screen SHALL disable submission and show how many minutes to wait. WHEN it receives 429 without `Retry-After`, it SHALL keep submission enabled and ask her to try again in a moment.

### Requirement 9: Secrets and setup tooling

**User Story:** As the Gift_Giver, I want to set the username, password, questions and answers without them ever touching git, so that nothing personal leaks through the repo.

#### Acceptance Criteria

1. THE Auth_Config and the CloudFront private key SHALL be stored only as Lambda environment variables on the Auth_Function (`AUTH_CONFIG`, `CLOUDFRONT_PRIVATE_KEY_B64`), set by hand in the Lambda settings, and SHALL NOT appear in the repo, the JS bundle, any `VITE_*` variable, CI/CD secrets, or logs.
2. THE repo SHALL include a local setup tool that prompts for the username, password, three question prompts and one Accepted_Answer for each, with hidden input for secrets, and outputs the hashed Auth_Config JSON.
3. THE setup tool SHALL write the Auth_Config only to standard output or to the git-ignored Demo_Config file, and SHALL NOT write plaintext answers or the password anywhere.
4. THE setup tool SHALL show each answer's Normalized_Answer back to the Gift_Giver before hashing, so that the Gift_Giver can see what will be matched.
5. THE Auth_Function SHALL read and validate both environment variables once per instance; IF either is missing or malformed, THEN every request SHALL get 503 and a log line naming which variable is wrong, without its value.
6. THE Security_Question prompt texts SHALL live only in the Auth_Config, not in the repo or the bundle.
7. THE setup tool SHALL warn when `AUTH_CONFIG` plus `CLOUDFRONT_PRIVATE_KEY_B64` plus the non-secret variables would exceed Lambda's 4 KB environment variable limit.

### Requirement 10: Look and feel

**User Story:** As the Recipient, I want the sign-in to look like the museum, so that it feels like the start of the gift rather than a form.

#### Acceptance Criteria

1. THE Login_Screen SHALL be a plain centered panel using the "Press Start 2P" font, the frame-tile palette used by the ImageViewer frame (dark brown, gold, tan, hard-edged), and the page background image, with no themed scene or artwork. Visual polish is deferred until the sign-in works end to end, and its styles SHALL stay in `LoginScreen.css` so they can be restyled without touching the component logic.
2. THE Login_Screen SHALL be fully usable with the keyboard alone: `Enter` submits the current step, focus moves to the first field of each new step, and every message is announced to screen readers through an `aria-live` region.
3. THE Login_Screen SHALL show warm, plain wording for every error, and SHALL NOT show status codes, stack traces, or internal error text.
4. THE Login_Screen SHALL NOT offer password reset, account creation, or "remember me".
5. THE App SHALL NOT offer a sign-out control; closing the browser is the only way to sign out.

### Requirement 11: Local Demo_Mode

**User Story:** As the Gift_Giver, I want to try the whole sign-in on my own machine before setting up AWS, so that I can confirm it works and see how it feels first.

#### Acceptance Criteria

1. THE Front-end SHALL provide `npm run dev:auth`, which starts the Vite dev server in Demo_Mode with Auth_Enabled true; `npm run dev` SHALL keep its current behavior with no sign-in.
2. WHILE in Demo_Mode, THE dev server SHALL route `POST /api/login/start` and `POST /api/login/finish` to the same Auth_Function handler that ships to Lambda, unmodified, with the Demo_Config as its Auth_Config.
3. WHILE in Demo_Mode, THE dev server SHALL return 403 for every `/Memories/*` request that lacks the three Access_Cookies, has an invalid signature, or is past its `DateLessThan`, checking the signature against a demo key generated when the dev server starts.
4. WHILE in Demo_Mode, THE dev server SHALL reject a `POST /api/*` whose `x-amz-content-sha256` header does not match the SHA-256 of its body, the same way Lambda behind CloudFront would.
5. THE Demo_Mode code SHALL run only in the dev server (`vite --mode demo`) and SHALL NOT be included in `npm run build` output.
6. IF the Demo_Config file is missing when `npm run dev:auth` starts, THEN THE dev server SHALL print how to create it with the setup tool and SHALL still start, with every sign-in returning 503.
7. THE Demo_Config file and the demo key SHALL be git-ignored and never committed.
