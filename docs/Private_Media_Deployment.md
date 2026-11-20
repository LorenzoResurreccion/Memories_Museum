# Keeping the Photos Private (Deployment Design Note)

> **Status:** design note for later. Nothing here is implemented yet. Build this when you're
> ready to deploy — after the app is polished and most memories are authored. The app was
> designed so you can keep adding memories (drop `NN.md` / `NN.jpg` / `NN.png` in `Memories/` and
> upload), and nothing in this note changes that flexibility — it only governs *how the
> content is served*, not how memories are authored. The letters (`Memories/dialogue/*.md`) are
> served the same way as the photos and paintings, so this gating covers them too.

## The problem in one sentence

The browser must be able to fetch the photos for the game to work, but you don't want those
photos readable by anyone who finds the link — and a purely static site can't keep that promise
on its own.

## Why a static site alone can't do it

Deciding "this viewer is allowed to see the photos" requires checking a secret (a password) and
holding a signing key. A static S3 site ships only HTML/JS/CSS to the browser — it has nowhere
to keep a secret the client can't read. So:

- **Client-side login + public bucket** (the simplest plan) gates the **UI**, not the **files**.
  The gallery screen is hidden behind a password, but the photo URLs sit in the page's
  JavaScript and the bucket serves them to anyone who requests them. Good enough for "a casual
  person who opens the link"; not good against "someone who opens browser devtools."
- **Truly private files** require *something server-side* to validate the password and grant
  access. That's unavoidable — it is not an AWS quirk.

"Accessible" and "public" are not the same thing. The goal below is **accessible only after
authenticating**: the browser still gets the photos, but only once it proves it's allowed.

## The design: private bucket + CloudFront + signed cookies

The standard way to serve private media to a browser:

1. **S3 bucket stays fully private.** Turn on *Block all public access*. Nothing is fetchable
   directly from S3.
2. **CloudFront is the only way in**, using **Origin Access Control (OAC)**. The bucket policy
   trusts only the CloudFront distribution (via the `cloudfront.amazonaws.com` service principal
   scoped to your distribution ARN); direct S3 URLs return `403`.
3. **CloudFront only serves `/Memories/*` if the request carries a valid signed credential.**
   No valid signature → `403`. A valid one → CloudFront fetches from the private bucket and
   returns the file.

For the credential, there are two shapes. **Signed cookies** are the right fit here; signed URLs
are not. Here's why.

### Why signed cookies, not signed URLs

| | Signed **cookies** | Signed **URLs** |
| --- | --- | --- |
| How it gates access | One credential the browser stores, auto-attached to **every** request under `/Memories/*` | A separate signature baked into **each** file URL |
| Fits `<img>` photos? | Yes, automatically | Yes, but each URL must be signed |
| Fits Phaser texture loads? | Yes, automatically (same cookie) | You'd have to sign every painting URL too |
| Code changes in `mediaBase.js` / `loadMemories.js`? | **One:** run `loadMemories()` after login (see below) — URLs stay plain | You'd inject signed URLs at runtime and handle expiry |

Because the painting textures are loaded by Phaser (`this.load.image(key, url)`), the photos are
loaded as `<img>`, **and** the letters are loaded with same-origin `fetch()` (which sends cookies
by default), a cookie covers all three with zero per-asset handling.

**Ordering constraint:** `main.jsx` currently calls `loadMemories()` before rendering anything.
Behind signed cookies that request would happen before the recipient logs in, get `403` for
`00.md`, and boot with N = 0 (every frame a "future memory"). When adding the login screen, call
`loadMemories()` after the cookie is set, then start the game. Signed URLs
would force runtime URL-signing into the static data modules, which fights the whole design.
So: **signed cookies.**

## How signed cookies work (the accurate flow)

Based on the CloudFront developer guide ([overview](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-overview.html),
[signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)).
*Content below is summarized/rephrased from AWS documentation for licensing compliance.*

**Setup (one time):**

- Create a **public/private key pair**. Upload the **public key** to CloudFront and put it in a
  **key group**. Keep the **private key** secret — it lives only in the auth function (below),
  never in the static site.
- In the CloudFront distribution, mark the `/Memories/*` cache behavior as **restricted**, with
  that key group as a **trusted signer**. (A behavior with trusted key groups requires a valid
  signature on every request.)
- Give the distribution **two cache behaviors**:
  - the default behavior (the app's HTML/JS/CSS) — **not** restricted, so the site loads and the
    login screen can render;
  - the `/Memories/*` behavior — **restricted**, requiring the signed cookie.

**Runtime (per visit):**

1. The recipient opens the site (default behavior, unrestricted) and sees the login screen.
2. They enter the shared password. The page sends it to a small **auth endpoint**.
3. The auth endpoint validates the password. If correct, it uses the **private key** to create a
   signed policy and returns **three `Set-Cookie` headers** — a CloudFront signed cookie is three
   name-value pairs (`CloudFront-Policy` / `CloudFront-Signature` / `CloudFront-Key-Pair-Id`, or
   a canned-policy equivalent). The browser stores them.
4. From then on, every request under `/Memories/*` — each `<img>` photo and each Phaser
   `load.image` texture — automatically carries the cookie. CloudFront validates the signature
   against the public key, checks the policy (e.g. not expired), and serves the file from the
   private bucket.
5. A bad/absent cookie → `403`. You can point the restricted behavior's 403 error page back at
   the login screen.

### The one new piece: a tiny auth function

Step 3 needs server-side compute to hold the private key and mint the cookie. Options, smallest
first:

- **Lambda@Edge / CloudFront Functions** attached to the distribution — validates the password
  and sets the signed cookie at the edge. No separate API to manage.
- **A small Lambda behind API Gateway (or a Lambda function URL)** — the login page POSTs the
  password; the function responds with the `Set-Cookie` headers.

Either way it is **one function, not a server**. This is the single justified exception to the
project's "no backend" rule (see `.kiro/steering/tech.md`): making the photos genuinely private
*is* the explicit decision that rule asks for. The game itself stays fully static — only media
access is gated.

## Security details worth getting right (from the AWS guidance)

- **Make the cookie a session cookie** — omit `Expires` / `Max-Age` so it's deleted when the
  browser closes, reducing the window for misuse.
- **Set the `Secure` attribute** so the cookie is only sent over HTTPS.
- **Scope the `Domain` as precisely as possible** (your exact app host, not a broad parent
  domain) to avoid sharing the cookie with sibling subdomains.
- **Use the shortest reasonable expiration** in the policy; for stronger control, a custom policy
  can also pin the viewer's IP.
- **Keep the private key out of the repo and the bundle** — it lives only in the auth function's
  config/secret store.
- CloudFront does **not** require a signature for `OPTIONS` (CORS preflight). Since the media and
  app share one origin here, CORS isn't in play — but don't let the origin return protected
  content in response to `OPTIONS`.

## What this does and doesn't protect

- **Does:** stops direct S3 access (private bucket + OAC) and stops unauthenticated CloudFront
  access to `/Memories/*` (signed cookies). The photos are genuinely gated behind the password.
- **Doesn't:** stop the *authenticated recipient* from saving/sharing a photo once it's on her
  screen — which is fine, she's the intended audience. Protecting against the legitimate viewer
  isn't the goal.

## Decision summary

| Approach | Photos truly private? | Needs compute? | Fits the static design? |
| --- | --- | --- | --- |
| Client login + public bucket | No (UI only) | No | Yes |
| **Private bucket + CloudFront OAC + signed cookies + tiny auth function** | **Yes** | One small function | Yes (game code unchanged; media gated at the CDN) |
| Signed URLs | Yes | Compute + runtime URL signing | No (fights the static modules) |

**Recommendation:** the middle row. It's the difference between "feels locked" and "is locked,"
and the cookie approach means `mediaBase.js` / `paintings.js` / `preload()` need **no changes** —
the plain `/Memories/...` URLs just start requiring a valid cookie, transparently. The only code
change is moving the `loadMemories()` call to after login.

## Implementation checklist (for deploy day)

1. Create the S3 bucket; enable **Block all public access**. Upload the built app + the
   `Memories/` folder into it.
2. Create a CloudFront distribution with the bucket as origin via **OAC**; update the bucket
   policy to allow only that distribution.
3. Generate a key pair; upload the public key to CloudFront; add it to a **key group**.
4. Two cache behaviors: default (unrestricted) and `/Memories/*` (restricted, trusted key group).
   Point the restricted 403 page at the login screen.
5. Build the **auth function** (Lambda@Edge or small Lambda): validate the shared password, and
   on success return the three signed `Set-Cookie` headers (session cookie, `Secure`, tight
   `Domain`, short expiry).
6. Wire the login screen to call the auth function, then route into the gallery.
7. Verify: direct S3 URL → `403`; `/Memories/...` without the cookie → `403`; after login →
   photos and paintings load normally.

## References

- CloudFront — [Restrict access to files (overview)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-overview.html)
- CloudFront — [How signed cookies work](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-signed-cookies.html)
- CloudFront — [Decide between signed URLs and signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-choosing-signed-urls-cookies.html)
- CloudFront — [Specify signers (trusted key groups)](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-trusted-signers.html)
- CloudFront — [Restrict access to an S3 origin with OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)
