# Watch Party

A real-time watch-party web app: create a room, share the invite link, and
watch a film together in sync, with live chat, emoji reactions, a shared
queue, polls, and host controls.

Built with **React 19 + TypeScript + Vite** and **Supabase** (Postgres,
anonymous Auth, Row Level Security, Realtime).

## Features

| Feature | How it works |
|---|---|
| Rooms & invites | Create a room, share `https://<site>/?room=FILM-7K3QX9`. Codes are random and hard to guess. |
| Guest accounts | Everyone is signed in automatically with Supabase **anonymous auth**: a real, private identity with no sign-up. |
| Synchronized playback | The host's play/pause/seek/movie is stored with a server timestamp; every viewer computes the shared position and corrects drift (speed nudge for small drift, jump for large). |
| Late join & reconnect | New and reconnecting viewers jump straight to the shared position. |
| Chat | Stored in Supabase, last 100 messages load on join. |
| Reactions | Live emoji over the video (not stored). |
| Shared queue | Host adds, removes, reorders and plays titles. |
| Polls | Host creates/closes; one vote per person (enforced by the database). |
| Presence & host hand-over | Online/offline dots. If the host disconnects (closed tab, crash, lost connection), hosting passes automatically to the next connected guest after about 12–15 s; a page refresh or switching tabs does not. |
| Demo mode | Without Supabase settings the app runs locally with sample data. |

## Getting started

Requirements: **Node.js 20+** (24 recommended) and a Supabase project.

```bash
npm install
cp .env.example .env.local     # then fill in the two values
npm run dev                    # http://localhost:5173
```

`.env.local` needs only **public** values (Supabase → Project Settings → API):

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon or publishable key>
```

Never put the `service_role` / secret key in this file. Everything starting
with `VITE_` is bundled into the website.

### Database setup (once per Supabase project)

Run these files **in order** in Supabase → SQL Editor (each is safe to
re-run and stops with a clear message if something is wrong):

1. `supabase/migrations/20261016120000_secure_rooms_and_membership.sql`
2. `supabase/migrations/20261017120000_stage2_shared_room_features.sql`
3. `supabase/migrations/20261018120000_stage3_host_takeover.sql`
4. `supabase/migrations/20261019120000_stage3b_automatic_host_transfer.sql`

Then in the dashboard: **Authentication → Sign In / Providers → Allow
anonymous sign-ins: ON**. More settings for production are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Type-check and build the production site into `dist/` |
| `npm run preview` | Serve the built site locally |
| `npm run lint` | ESLint |
| `npm test` | Unit tests + database tests (local PostgreSQL 17 via PGlite) |
| `npm run test:browser` | Real-Chrome tests: playback control, host transfer, reconnection, 10-person sync measurement, production security headers (needs Chrome + internet) |
| `npm run check:videos` | Checks that every catalog video URL is reachable |

## Project structure

```
src/
  App.tsx                     app state and room wiring
  components/                 UI (WatchRoom/ = the room screen)
  hooks/useRoomRealtime.ts    one private Realtime channel per room
  lib/playbackService.ts      sync math (tested in tests/playbackSync.test.ts)
  lib/supabase.ts             lazily loaded Supabase client
  services/                   all database calls
supabase/
  migrations/                 SQL (+ .rollback.sql undo files)
  tests/                      database tests (RLS, permissions, edge cases)
tests/                        unit tests and browser tests
docs/                         deployment, testing and security notes
```

## Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): hosting, environment variables, Supabase production settings
- [docs/TESTING.md](docs/TESTING.md): what is tested, sync measurements, test conditions, failure handling
- [docs/SECURITY.md](docs/SECURITY.md): security model and review findings

## Video credits

The catalog streams freely licensed open movies: *Tears of Steel*, *Big
Buck Bunny* and *Sintel* © Blender Foundation (CC BY 3.0), and *Elephants
Dream* © Orange Open Movie Project / Blender Foundation (CC BY 2.5), served
from the Internet Archive with Wikimedia Commons as backup. The catalog's
titles and descriptions are sample data.
