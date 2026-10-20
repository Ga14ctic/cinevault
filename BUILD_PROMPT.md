# CineVault — Build Prompt (portable)

You are building **CineVault** from scratch in the current directory. This prompt is self-contained: every decision has already been made. Do not redesign — implement. The full spec is `SPEC.md` in this directory; where this prompt is silent, defer to the spec.

## What you're building
Self-hosted Netflix-style movie/TV library for home LAN use. Docker Compose stack, **port 6767**. Pre-seeded catalog of ~3,500 English TMDB titles (2,000 movies + 1,500 TV), streamed via `cinesrc.st` iframes, plus local file uploads played natively. Multi-user auth with a root admin.

## Hard decisions (do not revisit)
- **Stack:** Node 22 LTS, ESM everywhere, Express 5, React 19 + Vite 7 + react-router 7 + Tailwind CSS v4 (`@tailwindcss/vite`). Official `mongodb` driver — **no ORM**. No TypeScript.
- **Docker:** multi-stage `node:22-slim` build; compose services `app` (publishes `6767:6767`) and `mongo` (`mongo:7`, **no host port**, healthcheck via `mongosh ping`). Volumes: `media_data:/data/media` (uploads), `mongo_data:/data/db`, bind mount `./data:/app/data:ro` (seed output: `catalog.json` + `images/`). App healthcheck: `GET /api/health`.
- **Env:** `PORT=6767`, `MONGO_URL=mongodb://mongo:27017`, `MONGO_DB=cinevault`, `SESSION_SECRET` (32-byte hex), `ROOT_USER`, `ROOT_PASS`, optional `TMDB_API_KEY` (DB `prefs.tmdbKey` wins unless env set).

## Data model (MongoDB `cinevault`) — exact
- `users`: `{username (unique, stored lowercase, 3–32 [a-z0-9_.-]), passwordHash (bcryptjs, cost 12), role: "root"|"user", caps:{movie, tv}, active, createdAt, updatedAt}`
- `sessions`: `{tokenHash (sha256 of cookie), userId, userAgent, ip, createdAt, expiresAt (+30d, TTL index), revokedAt}`. Cookie `cv_session`: HttpOnly, SameSite=Lax, Path=/, no Secure, 30d.
- `titles`: `{key: "tmdb:movie:<id>"|"tmdb:tv:<id>"|"local:<oid>" (unique), media_type, tmdb_id|null, title, original_title, overview, year, poster_path ("/p/<id>.jpg"), backdrop_path ("/b/<id>.jpg"), genres[], genre_names[], rating|null, vote_average, popularity, runtime, source: "seed"|"admin"|"upload", local?: {filename, original_name, mime, size, kind:"video"|"audio"}, createdAt, updatedAt}`. Indexes: `key` unique, `{media_type, popularity}`, `vote_average`, `genres`, `year`, text index on `title`+`original_title`.
- `progress`: `{userId, titleKey, season|null, episode|null, seconds, duration, percent, watched, updatedAt}`; unique `{userId, titleKey, season, episode}`; index `{userId, watched, updatedAt}`.
- `prefs`: singleton `_id:"singleton"` → `{tmdbKey, siteName:"CineVault", cinesrc:{color:"#e50914", autoplay:true, autonext:true, autoskip:false, seek:10, quality:null, febboxToken:""}, uploadMaxGb:50, seededAt}`.

## Core business rules
- **Parental caps:** movie order G<PG<PG-13<R<NC-17; TV order TV-Y<TV-Y7<TV-G<TV-PG<TV-14<TV-MA. Visible iff `rating === null` or `rank(title.rating) <= rank(user.caps[type])`. Unknown rating strings → treat as Unrated. Enforced **server-side in every query** (rows, library, search, detail, continue-watching); locked detail returns **404**, not 403. Root bypasses caps.
- **Auth:** login `POST /api/auth/login` rate-limited 5 attempts/15min per username+IP → 429. Logout revokes session. Deactivating a user deletes their sessions. Root seeded from env when `users` empty. Reset script: `scripts/reset-root.mjs`.
- **Progress:** client PUTs every 10s + on pause/ended/beforeunload. `watched = percent >= 0.9`. Watched titles leave Continue Watching. Upsert per (user, titleKey, season, episode).
- **Uploads:** extensions whitelist `.mp4 .mkv .webm .avi .mov .mp3 .wav .m4a`; disk name `<uuid>.<ext>` in `/data/media`; size cap from `prefs.uploadMaxGb` → 413. Flow: upload file(s) → admin form → link to TMDB (`/api/admin/tmdb-search` + `/api/admin/titles/from-tmdb`) OR manual metadata (rating selector, default Unrated) → insert title. No transcoding; browser-incompatible codec → "unsupported codec" card via video `error` event. Local-only titles deletable (removes disk file + doc).
- **cinesrc playback (iframe ONLY — never call cinesrc server actions from the backend):** URL `https://cinesrc.st/embed/{movie|tv}/{tmdb_id}?color=%23...&autoplay=...&autonext=...&autoskip=...&seek=...[&febbox=...][&s=&e=]`, params from `prefs.cinesrc`. Listen for `message` with `event.origin === "https://cinesrc.st"` strict check. `cinesrc:timeupdate` → throttled progress PUT; `cinesrc:error` → overlay "Stream unavailable — Retry" (remount iframe w/ cache-buster); `cinesrc:nextepisode` (only when `internalNavigation !== true` from our own route changes) → route to next episode. Resume: pass `t=<seconds>&continueprompt=false`.
- **Local playback:** native `<video>`/`<audio>` at `/media/<filename>` (Express static, Range supported).

## API surface (all JSON; errors `{error:{code,message}}`; everything except login/health requires session; admin routes require `role==="root"` server-side)
- Auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- Library: `GET /api/rows` (rows: continue, trending, popular-movies, popular-tv, top-rated, new-movies, top 6 genres by count, classics, local — 20 items/row; continue = progress `$lookup`, unwatched, updatedAt desc), `GET /api/library?q&type&genre&decade&sort&page` (text-index search), `GET /api/titles/:key`, `GET /api/genres`
- Progress: `PUT /api/progress`, `DELETE /api/progress/:titleKey`
- Public: `GET /images/:group/:file` (from `/app/data/images`, `p/` posters, `b/` backdrops), `GET /api/health`
- Admin: users CRUD (`GET/POST/PATCH/DELETE /api/admin/users[/:id]`, `POST /api/admin/users/:id/revoke-sessions`; can't delete self or last root), `GET/PUT /api/admin/prefs`, `POST /api/admin/upload` (multer, field `files[]`), `POST /api/admin/titles` (finalize upload), `DELETE /api/admin/titles/:id` (local only), `GET /api/admin/tmdb-search?q=`, `POST /api/admin/titles/from-tmdb`, `GET /api/admin/status`

## Catalog seed (build-time, not runtime)
`scripts/seed.mjs`, run on host before `docker compose up`, needs TMDB v3 key:
1. Genre lists. 2. `discover/movie` + `discover/tv`, `sort_by=popularity.desc`, **`with_original_language=en`**, until 2,000 movies + 1,500 TV with `poster_path`. 3. Enrich: movie `release_dates` → US certification; tv `/tv/{id}` → US `content_rating`. 4. Download `w500` poster → `data/images/p/<id>.jpg`, `w1280` backdrop → `data/images/b/<id>.jpg` (6 workers, skip 404). 5. Throttle 4 req/s, 3 retries w/ backoff on 429/5xx. 6. Write `data/catalog.json`.
Boot: if `titles` empty && JSON exists → chunked `bulkWrite` upsert (500/op). App must boot fine with empty/missing catalog (root sees banner).

## Security
helmet CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://image.tmdb.org https://flagcdn.com; frame-src https://cinesrc.st; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'self'`. pino + pino-http logging. No secrets in logs. `.env` gitignored (ship `.env.example`).

## UI
Routes: `/login` (public), `/` (rows), `/search`, `/title/:key` (detail: backdrop, overview, rating badge, Play/Resume, seasons+episodes list for TV), `/watch/:key(?s&e)` (iframe or native player), `/admin` (root-only tabs: Library | Uploads | Users | Player | Settings).
- Netflix aesthetic: dark theme, horizontal poster rails (2:3 cards), hover elevation, Continue Watching cards with progress bars.
- Responsive: mobile swipeable rails; TV mode `@media (pointer:coarse) and (min-width:1200px)` → bigger cards, arrow-key/D-pad focus nav with visible focus rings.
- Admin: user table w/ caps dropdowns + deactivate + revoke sessions; prefs form (febbox token as password input, accent color, toggles); drag-drop upload zone + TMDB-search linking panel; library table w/ search; status cards (title count, seed state, disk usage).
- Locked titles simply never arrive from the API — client does no hiding logic beyond cosmetic rating badges.

## Dev & verification
- Dev: `npm run dev` = vite (5173, proxy `/api`,`/media`,`/images` → 6767) + `node --watch server/index.js`.
- `scripts/smoke.mjs`: boots against a running stack — health, login, wrong-password lockout, rows, capped-user 404, progress upsert, admin route rejection for non-root.
- README: quickstart (`.env`, seed, `docker compose up`), backup (`mongodump` + rsync `data/`), reset-root, troubleshooting.

## Build order (verify each before the next)
1. Skeleton + Docker (compose up, `/api/health` green)
2. Auth (login flow, lockout, revoke, root seed)
3. Catalog seed run + library/rows/detail APIs with caps filtering (3,500 titles; capped 404 check)
4. Frontend shell: login, home rails, search, detail, routing, theme
5. Player: cinesrc bridge, resume, TV episodes, error/retry, native local player
6. Progress + Continue Watching (90% rule)
7. Admin panel (users, prefs, add-from-tmdb, status)
8. Uploads end-to-end (mp4 + wav both play)
9. Hardening: CSP audit, keyboard/TV nav, responsive pass, smoke script green
10. README + final docs

## Non-goals (do not build)
Transcoding, Chromecast/DLAN, remote access/HTTPS, open registration, per-account multi-profile, TV-series file structure for uploads, watchlists, per-title/genre blocks, downloads, server-side ad stripping.
