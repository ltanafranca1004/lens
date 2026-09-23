# Spec: Security Pass (Phase 1, item 1)

Time-box: 1 week. Goal: safe to invite strangers, not perfect security.

## 1. Rate limiting (top priority)
- Apply to every endpoint that calls Groq: question generation, answer
  evaluation, "what to study," and anything else that hits the LLM.
- Also rate limit login and signup (brute force and fake accounts).
- Key by user ID when logged in, by IP for guests.
- Render sits behind a proxy. Read the client IP from the proxy header
  correctly, or every user shares one IP (or an attacker can spoof it).
  Document how this was verified.
- Add a global daily cap on Groq calls as a circuit breaker.
- Over the limit: return 429 with a clear message; frontend shows it
  plainly instead of breaking.
- Groq's own 429s and errors also show a clear message.
- In-memory limiter is fine for v1 (single instance). Note that limits
  reset when Render spins down.

### How client IP was verified (2026-09-22/23)
Checked against production with curl and the Render logs (read-only MCP), using temporary
`client-ip-debug` logging that has since been removed. Real addresses are masked as MYIP (laptop)
and PHONEIP (phone).
- Requests: plain; `X-Forwarded-For: 203.0.113.9` only; `True-Client-IP` only; `X-Real-IP` only;
  all four spoof headers together; a real browser login from a phone on cellular.
- Header chain: `x-forwarded-for` = `client, <Cloudflare edge>, <Render internal proxy>`. The
  Cloudflare edge address varies; the Render proxy is a private 10.x address that changes between
  instances.
- The real client is 3rd from the right in XFF, every time. A spoofed XFF value is only prepended
  on the left (`203.0.113.9,MYIP, ...`).
- `cf-connecting-ip` and `true-client-ip` always carried the real client (MYIP / PHONEIP), even
  when spoofed. A spoofed `True-Client-IP` is overwritten, a spoofed `X-Real-IP` is stripped, and a
  client-supplied `CF-Connecting-IP` is rejected by Cloudflare (403, "error code: 1000") before
  reaching the app.
- The original default (rightmost XFF entry) was wrong: it is Render's internal proxy, so every
  user shared one per-IP bucket.
- `request.client.host` is forgeable: it became `203.0.113.9` when XFF was spoofed, because
  uvicorn trusts XFF. The code never uses it.
- Chosen: `CLIENT_IP_HEADER=cf-connecting-ip` (single-valued, set by Cloudflare, not
  client-suppliable). `TRUSTED_PROXY_COUNT=3` also resolves correctly today but would silently
  break if Render changes its hop count.
- Confirmed after setting it (deploy `dep-dapikjek1f9s7396jnu0`, 2026-09-23 01:25 UTC): a plain
  request and an XFF-spoofed request both resolved to MYIP, matching ipify.
- If the header is ever missing, the request falls into a shared `"unknown"` bucket and a warning
  (no IP values) is logged.

## 2. Input size limits (cost and abuse)
- Cap job posting and answer text length before it reaches the LLM.
- Cap resume upload size and page count; add a parse timeout.
- Reject unsupported file types by content, not just extension.

## 3. IDOR
- Every endpoint that takes a session or question ID must check it
  belongs to the current user.
- Return 404, not 403, for other users' resources (don't reveal they exist).
- Pytest: create two users, attempt every cross-user access, all must fail.

## 4. JWT and auth
- Secret: at least 32 random bytes, only in env vars.
- Pin the algorithm on decode; reject "none" and unexpected algorithms.
- Confirm expiry is set and enforced; access tokens last hours, not weeks.
- Confirm passwords are hashed with bcrypt or argon2.

## 5. XSS
- Tokens live in localStorage, so any XSS means account takeover.
- Confirm LLM output, resume text, and job postings are never rendered
  as raw HTML (no dangerouslySetInnerHTML or HTML-enabled markdown).
  This matters because LLM output can be steered by user input.

## 6. CORS
- Allow only the production Vercel domain (plus localhost via env in dev).
- No wildcard origins with credentials.
- Decide explicitly whether Vercel preview URLs are allowed.
  **Decision (2026-09-22): denied.** Only the production Vercel URL is allowed, and the API refuses
  to start if `CORS_ORIGINS` contains `*`.

## 7. Secrets in a public repo
- Scan full git history for keys (e.g. gitleaks). Rotate anything found.

## 8. Security headers (Vercel)
- HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors.
- CSP: test that Kokoro still works (WebAssembly may need an allowance).

## Out of scope for this pass
Password reset, privacy page, WAF, and anything else. Those are later
Phase 1 items or not needed yet.

## Done when
- All items above pass, with pytest coverage for rate limits and IDOR.
- Manual check: hit an LLM endpoint past the limit and see the friendly
  message; try another user's session ID and get 404.
- Merged through CodeRabbit.
