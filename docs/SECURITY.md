# Security

## Model

- **Identity:** Supabase anonymous auth. Every browser has a real user
  id; the database takes it only from the signed token (`auth.uid()`),
  never from request parameters.
- **Data access:** Row Level Security on every table. Members can read
  only their own rooms' data. **No table accepts direct writes from
  browsers.** Every change goes through a database function that checks
  membership, and host rights where needed.
- **Realtime:** private channels `room:<uuid>`. Only members can join or
  send; a *restrictive* policy keeps room channels members-only even if a
  broader Realtime policy exists in the project.
- **Secrets:** the website contains only the public anon/publishable key.

## Review (Stage 3, 17 Oct 2026)

| Area | Finding | Status |
|---|---|---|
| Secrets in Git history | `.env.local` never committed; no service/secret keys anywhere in history | ✅ OK |
| Production bundle | Only the publishable key; no service key; no source maps | ✅ OK |
| Dependencies | `npm audit`: 0 issues (a dev-only test tool was upgraded to fix 7 findings) | ✅ Fixed |
| Host-only actions | playback, queue, polls, host transfer: refused for non-hosts (database tests) | ✅ OK |
| Faking "still online" | Stage 1 allowed members to write their own `last_seen_at`, which could block a host takeover | ✅ Fixed in Stage 3 migration (server-stamped heartbeat only) |
| Abandoned rooms | If the host disappeared nobody could control the room | ✅ Fixed (`claim_host` after 3 min of silence) |
| Browser hardening | No CSP / security headers | ✅ Added in `vercel.json`, verified against a production build |
| Error messages | Database messages are user-readable and leak no internals | ✅ OK |
| Chat / names | Rendered as text by React (no HTML injection); sender name comes from membership, not the client | ✅ OK |
| Presence | The "online" list is reported by each client: a room member could make another member look online | ⚠️ Accepted: display only; takeover uses the server heartbeat, not presence |
| Reaction sender | The sender id in a reaction is not verified | ⚠️ Accepted: not displayed or used |
| Room-code guessing | `join_room` has no attempt limit (codes have ~887 million combinations per prefix) | ⚠️ Recommendation: add a per-user join rate limit if the site becomes public |
| Mass guest accounts | Anonymous sign-ins are rate-limited per IP by Supabase | ⚠️ Recommendation: enable CAPTCHA before wide public use (needs a small app change) |
| Old anonymous users | Never cleaned up | ⚠️ Recommendation: periodically delete anonymous users older than e.g. 30 days |

## Reporting

Report problems privately to the project owner rather than in a public issue.
