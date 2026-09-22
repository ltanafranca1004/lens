# Launch Checklist

## Before posting anywhere (gates)
- [ ] Security pass PRs merged (rate limiting, auth, IDOR tests, CORS/headers)
- [ ] Client IP verification done on Render (see PR #15 deploy notes)
- [ ] Temporary IP debug logging removed
- [ ] Fix orphan sessions on failed resume upload (create the session only
      after upload succeeds) and show upload errors next to the resume field
- [ ] Lower reasoning effort for question generation and the "what to
      study" note. Small PR. Do NOT change reasoning effort for answer
      evaluation without re-running the 50-example eval.
- [ ] Landing page with guest trial and backend warm-up ping
- [ ] Privacy page and data deletion
- [ ] Password reset
- [ ] PostHog events and error tracking
- [ ] Tested on a phone

## Launch day
- [ ] Confirm Supabase project is active, not paused
- [ ] Open the site a few minutes early to wake the backend
- [ ] Run one full session on the live site
- [ ] Post in CS subreddits and Discords
- [ ] No workshops or group demos on the free Groq tier

## Upgrade when triggered (not before)
- [ ] Groq paid tier: repeated busy-AI errors from real users, or before
      any workshop or group demo (free tier allows about 4-5 answer
      grades per minute for the whole app)
- [ ] Render Starter: users report slow first loads, or analytics show
      drop-off during warm-up
