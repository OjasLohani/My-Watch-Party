# Deployment

The app is a static website (HTML/JS/CSS in `dist/`) that talks directly
to Supabase. There is no server of our own to run.

## Recommended host: Vercel

Free tier, automatic HTTPS, deploys on every Git push, and it reads the
security headers in [`vercel.json`](../vercel.json) automatically.
(Netlify or Cloudflare Pages also work; copy the headers from
`vercel.json` into their `_headers` file.)

## 1. Before the first deploy (Supabase dashboard)

| Where | Setting | Why |
|---|---|---|
| SQL Editor | Run the migrations in `supabase/migrations/` in date order (skip any already run; never the `.rollback.sql` files) | Tables, security rules and functions |
| Authentication → Sign In / Providers | **Allow anonymous sign-ins: ON** | Guests get an identity without signing up |
| Authentication → Attack Protection | Turn on **CAPTCHA** (Cloudflare Turnstile or hCaptcha) once you share the site publicly | Stops scripts from creating thousands of guest accounts. Note: the app does not send a CAPTCHA token yet, so turning this on requires a small code change first |
| Authentication → Rate Limits | Check "anonymous sign-ins per hour" (default 30 per IP) | Abuse protection |
| Authentication → URL Configuration | **Site URL** = your production address, e.g. `https://watch-party.vercel.app` | Used by Supabase for links (no email links are sent today, but keep it correct) |
| Realtime → Settings | If shown, turn **off "Allow public access"** | The app only uses private, members-only channels |

No CORS setting is needed: the Supabase API accepts requests from any
website, and your data is protected by Row Level Security, not by origin.

## 2. Deploy on Vercel

1. Push the `watch-party-repairs` branch (or merge it into `main`) to GitHub.
2. On https://vercel.com: **Add New → Project → import the repository**.
3. Vercel detects Vite. Keep: Build command `npm run build`, Output `dist`.
4. **Environment Variables** (Production and Preview):
   - `VITE_SUPABASE_URL` = `https://<your-project-ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = the anon / publishable key
   These are public values; never add the service-role / secret key.
5. **Deploy**. Open the URL, create a room, and join it from a second
   browser (or an incognito window) to check everything works.

Changing an environment variable requires a **redeploy** (Vite bakes
`VITE_*` values into the build).

## 3. Production build settings (already configured)

- `vite.config.ts`: separate cached chunks for React, Supabase and icons;
  the room screen and dialogs load on demand; no source maps shipped.
- `vercel.json`:
  - **Content-Security-Policy**: the browser may only load scripts from
    the site itself, talk to `*.supabase.co`, play video from
    `archive.org` / `upload.wikimedia.org`, and show images from
    `images.unsplash.com`. Verified by `npm run test:browser`
    (`production-csp.browser.mjs`). If you add a new video or image host,
    add it to `media-src` / `img-src`, or the browser will block it.
  - `X-Frame-Options: DENY`, `nosniff`, strict referrer, HSTS, and
    long-term caching for the hashed files in `/assets/`.

## 4. Checklist after deploying

- [ ] Homepage loads, no red errors in the browser console (F12)
- [ ] Create room → invite link works in a second browser
- [ ] Play / pause / seek reach the guest; chat, reactions, queue, polls work
- [ ] In a guest tab's console, `window.watchPartySync` shows the real
      update delay and drift on your network (see docs/TESTING.md)

## Rolling back

- Frontend: in Vercel → Deployments, "Promote" a previous deployment.
- Database: each migration has a matching `.rollback.sql` (read its
  warning first; Stage 2's rollback deletes chat/queue/poll data).
