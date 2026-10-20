# CineVault — Technical Specification

Status: **REVISION 1 — open questions resolved, pending final sign-off**

## 1. Overview

CineVault is a self-hosted, LAN-only Netflix-style movie/TV library. It ships with a pre-seeded catalog of ~3,500 TMDB titles (movies + TV) rendered as browsable rows, plays TMDB-linked titles through the cinesrc.st embed player, and supports uploading local media files (mp4/mkv/webm/avi/mov/mp3/wav/m4a) for native HTML5 playback. A root account provisions users, sets per-user parental rating ceilings, tunes player/ad configuration, and manages the library. Runs as a Docker Compose stack on **port 6767**.

## 2. Goals & Non-Goals

### Goals
- Large preloaded catalog (3,000–5,000 TMDB titles) browsable like Netflix
- Working multi-user auth with a root admin (user CRUD, parental caps, player/ad prefs)
- Playback via cinesrc.st iframes (TMDB-linked) and native HTML5 (local files)
- Local file uploads persisted to disk + catalogued in MongoDB
- Desktop, mobile, and TV-browser-friendly responsive UI
- Per-user watch progress, Continue Watching, auto-watched at 90%

### Non-Goals (explicitly out of scope for v1)
- Transcoding (ffmpeg) of any kind
- Chromecast / DLNA / mobile apps
- Remote access, HTTPS/TLS, port forwarding (LAN only)
- Open self-registration
- Multiple profiles per account
- Season/episode file structure for local uploads (uploads = single-file titles)
- Watchlists / "My List"
- Per-title or per-genre parental blocks (rating ceiling only)
- Downloading/offline viewing
- Stripping cinesrc's ads server-side (impossible; mitigated via febbox token)

## 3. User Personas

| Persona | Access | Needs |
|---|---|---|
| **Root (household admin)** | Full UI + `/admin` | Seed/manage library, create/disable users, set caps, set febbox token + player prefs, upload files, revoke sessions |
| **Standard user** | Browse + play only | Search, rows, play (within cap), resume watching |
| **Child / capped user** | Browse + play only | Never sees titles above their rating ceiling — locked titles are fully hidden from rows, search, and detail (404) |

Access model: **LAN-only** (no port-forward, no VPN). Server binds `0.0.0.0:6767` so phones/TVs on the LAN can reach it. MongoDB publishes **no host port**.

## 4. System Architecture

```
┌─ docker compose (cinevault) ─────────────────────────────────┐
│                                                              │
│  app  (node:22-slim, build stage → prod stage)               │
│  ├─ Express 5 API          :6767                             │
│  ├─ serves built SPA (Vite dist) — same origin               │
│  ├─ /media/*  → local uploads (Range-aware static)           │
│  │                                                       │    │
│  │   browser ──iframe──► https://cinesrc.st/embed/...        │
│  │      │  (postMessage: timeupdate/error/commands)          │
│  ▼   ▼                                                       │
│  mongo (mongo:7, volume mongo_data, INTERNAL ONLY)           │
│  media volume: /data/media  (uploads)                        │
│                                                              │
│  outbound: api.themoviedb.org (seed/admin),                  │
│            image.tmdb.org (seed-time image fetch only),     │
│            cinesrc.st (iframes — never called server-side)   │
└──────────────────────────────────────────────────────────────┘
```

**Data flow principles**
- MongoDB is the source of truth after seeding — the UI never calls TMDB directly; all browse/search/detail reads hit Mongo.
- cinesrc is **only** ever consumed as a browser iframe. The app never calls cinesrc server actions (`getStream`, etc.) — their PoW challenge makes that fragile and against their intent.
- TMDB is called server-side only: at seed time (script) and by admin actions (add-from-TMDB).

## 5. Technical Stack (specific)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js **22 LTS** (image `node:22-slim`) | ESM throughout (`"type": "module"`) |
| Backend | **Express 5** (`^5`) | Single process, serves API + static SPA |
| Frontend | **React 19** + **Vite 7** + **react-router 7** | SPA built in Docker stage 1 |
| Styling | **Tailwind CSS v4** via `@tailwindcss/vite` | Dark Netflix-style theme, no runtime CSS framework |
| DB | **MongoDB 7** (`mongo:7` official image) | Driver: official `mongodb` package |
| DB access | Thin repository layer (`server/db.js`) — **no ORM/ODM** | Raw driver keeps it auditable |
| Auth sessions | Opaque random tokens in Mongo `sessions` collection; cookie holds raw token, DB stores **SHA-256 hash** | Revocable per-user; 30-day expiry via TTL index |
| Password hashing | **bcryptjs** cost **12** | No native build deps |
| Uploads | **multer 2** (disk storage) | Streams to `/data/media`, no memory buffering |
| Rate limiting | **express-rate-limit** on login: **5 attempts / 15 min** per `username+IP`, `X-Forwarded-For` trusted only behind LAN proxy | 429 → JSON error |
| Security headers | **helmet** with explicit CSP (below) | |
| Logging | **pino** + **pino-http** | Pretty in dev, JSON in prod |
| Validation | Hand-rolled validators in `server/validate.js` | No zod dependency needed at this scale |
| Process mgmt | Docker `restart: unless-stopped` + `/api/health` healthcheck | |

**CSP (helmet config):**
```
default-src 'self';
script-src  'self';
style-src   'self' 'unsafe-inline';
img-src     'self' data: https://image.tmdb.org https://flagcdn.com;
frame-src   https://cinesrc.st;
media-src   'self' blob:;
connect-src 'self';
frame-ancestors 'self';
```

**Cookie:** `cv_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure=false` (plain-HTTP LAN), `Max-Age=30d`.

**Env vars (`.env`):**
```
PORT=6767
MONGO_URL=mongodb://mongo:27017
MONGO_DB=cinevault
SESSION_SECRET=<32-byte hex — generated once, required>
ROOT_USER=root
ROOT_PASS=<required on first boot; random generated+logged if omitted>
TMDB_API_KEY=<optional override; otherwise stored in DB prefs>
```

## 6. Data Model (MongoDB `cinevault`)

### `users`
```js
{
  _id: ObjectId,
  username: "dad",            // unique, case-insensitive (stored lowercase), 3–32 chars [a-z0-9_.-]
  passwordHash: "$2a$12$...", // bcrypt
  role: "root" | "user",
  caps: { movie: "PG-13", tv: "TV-14" },  // ceiling; see rating tables §7
  active: true,               // false = cannot log in, existing sessions killed
  createdAt: ISODate, updatedAt: ISODate
}
// indexes: { username: 1 } unique
```
Root user's `caps` are ignored (root sees everything).

### `sessions`
```js
{
  _id: ObjectId,
  tokenHash: "sha256hex",     // SHA-256 of cookie value — raw token never stored
  userId: ObjectId,
  userAgent: "...", ip: "...",
  createdAt: ISODate,
  expiresAt: ISODate,          // now + 30 days
  revokedAt: null | ISODate
}
// indexes: { tokenHash: 1 } unique; { expiresAt: 1 } TTL (expireAfterSeconds: 0);
//          { userId: 1 }
```

### `titles` (catalog + uploads, single collection)
```js
{
  _id: ObjectId,
  key: "tmdb:movie:1084242" | "local:66f0...",   // stable composite key, unique
  media_type: "movie" | "tv",
  tmdb_id: 1084242 | null,     // null for manual uploads
  title: "Flow",
  original_title: "Flow",
  overview: "...",
  year: 2024,
  poster_path: "/p/ab12cd.jpg",  // LOCAL image served via /images/* (read-only data mount, see §14)
  backdrop_path: "/b/ef34gh.jpg", // local too; image.tmdb.org only as fallback for not-yet-fetched adds
  genres: [16, 10751],          // TMDB genre ids
  genre_names: ["Animation","Adventure"],
  rating: "PG",                  // certification string; null = Unrated (visible to all)
  vote_average: 8.2, popularity: 95.4,
  runtime: 85,                   // minutes, may be null
  source: "seed" | "admin" | "upload",
  local: {                       // present only for uploads
    filename: "a1b2....mp4",    // uuid + sanitized ext on disk
    original_name: "Flow.2024.mp4",
    mime: "video/mp4", size: 1234567890,
    kind: "video" | "audio"
  },
  createdAt: ISODate, updatedAt: ISODate
}
// indexes: { key: 1 } unique; { media_type: 1, popularity: -1 };
//          { vote_average: -1 }; { genres: 1 }; { year: -1 };
//          text index { title: "text", original_title: "text" }
```

### `progress`
```js
{
  _id: ObjectId,
  userId: ObjectId,
  titleKey: "tmdb:tv:1396",
  season: 1, episode: 2,        // null for movies/local
  seconds: 743, duration: 1412,
  percent: 0.526,
  watched: false,               // true when percent >= 0.9
  updatedAt: ISODate
}
// indexes: { userId: 1, titleKey: 1, season: 1, episode: 1 } unique;
//          { userId: 1, watched: 1, updatedAt: -1 }
```

### `prefs` (singleton doc `_id: "singleton"`)
```js
{
  _id: "singleton",
  tmdbKey: "...",               // set by root in admin; env TMDB_API_KEY overrides if present
  siteName: "CineVault",
  cinesrc: {
    color: "#e50914", autoplay: true, autonext: true,
    autoskip: false, seek: 10, quality: null,
    febboxToken: ""             // empty = no premium/ads-as-served
  },
  uploadMaxGb: 50,
  seededAt: ISODate | null,     // null → show "library not seeded" banner to root
  updatedAt: ISODate
}
```

### `seedlog` (optional, admin visibility)
```js
{ _id, stage: "discover"|"enrich"|"done", fetched: 3500, total: 3500,
  failed: 3, startedAt, finishedAt, error: null }
```

## 7. Business Rules

### Rating ceilings
Movie order: `G < PG < PG-13 < R < NC-17`
TV order: `TV-Y < TV-Y7 < TV-G < TV-PG < TV-14 < TV-MA`
- User may see title iff `title.rating === null` (Unrated ⇒ visible) **or** `rank(rating) <= rank(cap)`.
- TMDB sometimes returns `18+`/`TV-MA` variants and country-specific strings; unknown rating strings → treat as **Unrated**.
- Enforcement is **server-side on every query** (library, rows, search, detail, continue-watching) — not just CSS hiding. Detail endpoint returns **404** (not 403) for locked titles so existence isn't leaked.
- Root bypasses all caps.

### Progress
- Client PUTs every **10s** of playback (throttled), plus on `pause`, `ended`, `beforeunload`.
- `percent = seconds/duration`; `watched = percent >= 0.9`.
- Watched titles drop off Continue Watching but keep their progress doc (replaying from the top resets nothing until 90% again).
- Upsert keyed by `(userId, titleKey, season, episode)`.

### Auth
- Login: bcrypt compare (constant-time via bcryptjs), 5 fails/15min ⇒ 429 for that `username+IP`.
- Deactivating a user immediately deletes all their sessions.
- Root password reset: `docker compose exec app node scripts/reset-root.mjs <newpass>` (updates hash + kills sessions).

### Uploads
- Allowed extensions: `.mp4 .mkv .webm .avi .mov .mp3 .wav .m4a .mp4v?` — whitelist exact list above; mime sniffed but not trusted; filename on disk = `<uuid>.<ext>`; original name kept in metadata only.
- Size cap: `prefs.uploadMaxGb` (default 50) enforced by multer → 413 JSON.
- Upload flow: file(s) uploaded → returns temp record → admin fills form (**TMDB search-and-link** or **manual metadata** with rating selector, default `Unrated`) → title saved to `titles` with `local` block.
- Playback: `<video>`/`<audio>` src `/media/<filename>` (Express static serves `Accept-Ranges`). Browser-incompatible codec → `error` event → inline "unsupported codec in this browser" card.

### cinesrc player integration
- Iframe URL built from `prefs.cinesrc`: `https://cinesrc.st/embed/{movie|tv}/{tmdb_id}?color=%23e50914&autoplay=true&autonext=true&autoskip=false&seek=10[&febbox=token][&s=..&e=..]`.
- Message listener validates `event.origin === "https://cinesrc.st"` strictly.
- Bridge: `cinesrc:timeupdate` → throttled progress PUT; `cinesrc:error` → inline overlay **"Stream unavailable — Retry"** (Retry remounts iframe with a cache-busting query param; their player already rotates providers internally); `cinesrc:nextepisode` → update route to next episode, fetch progress for it.
- Commands used: `play`, `pause`, `seek`, `getCurrentTime` (for resume-on-load: store `t` param).

## 8. Catalog Seeding (exact procedure)

**Design: seed is a build-time script, not a first-boot runtime job.** `data/catalog.json` is generated once (during the build, using the user's TMDB key) and committed to the repo. First boot upserts JSON → Mongo in seconds, works forever after without TMDB.

`scripts/seed.mjs` (run manually / by me during build):
1. `GET /genre/movie/list` + `/genre/tv/list` → genre map.
2. Movies: `GET /discover/movie?sort_by=popularity.desc&include_adult=false&with_original_language=en&page=N` → collect **2,000** with `poster_path` present.
3. TV: `GET /discover/tv?sort_by=popularity.desc&with_original_language=en&page=N` → collect **1,500** with `poster_path`.
4. Enrich for certifications (parental caps depend on it):
   - movie: `GET /movie/{id}/release_dates` → US `certification`
   - tv: `GET /tv/{id}` → US `content_rating`
5. Download images: for each title, fetch `w500` poster + `w1280` backdrop from `image.tmdb.org` into `data/images/p/<id>.jpg` / `data/images/b/<id>.jpg` (skip-on-404, retry once, 6 parallel workers). On the host, pre-`docker compose up` — the directory is bind-mounted read-only (§11).
6. Throttle **4 req/s** (`p-limit`-style manual queue), retry 429/5xx with backoff (3 attempts), log failures to `seedlog`.
7. Write `data/catalog.json` (~3,500 docs, with local image paths) + `data/images/` + print summary.

`server/boot.js` on startup: if `titles` empty and JSON exists → bulk upsert from JSON (chunked `bulkWrite`, 500/op). If neither exists → empty library, root sees banner with instructions.

**Admin "Add from TMDB":** live server-side search (`/search/multi`) + detail fetch, same enrichment, appends to `titles`. Works even after seed.

**TMDB request budget:** seed ≈ 2,050 discover + 3,500 enrich ≈ 5,550 TMDB calls @ 4/s ≈ **23 min**, plus ~7,000 image fetches from the TMDB image CDN (separate 6-worker queue, ~5 min). One-time total ≈ **30 min**. Admin adds: ≤ 4 TMDB calls + 2 images each.

## 9. API Design

All responses JSON. Errors: `{ "error": { "code": "FORBIDDEN", "message": "..." } }`. Success shapes shown inline. All `/api/*` except login/health require valid session cookie; `role` checked per route.

### Auth
| Method & Path | Req → Res |
|---|---|
| `POST /api/auth/login` | `{username, password}` → `{user}` + sets cookie. 401 invalid, 429 rate-limited |
| `POST /api/auth/logout` | → `{ok:true}`, revokes session |
| `GET /api/auth/me` | → `{user: {username, role, caps}}` |

### Library (caps-filtered middleware `requireCaps`)
| Method & Path | Notes |
|---|---|
| `GET /api/rows` | Home rows: `[{id:"continue", title:"Continue Watching", items:[...]}, "trending", "popular-movies", "popular-tv", "top-rated", "new-movies", "genre:<6 top genres>", "classics", "local"]`. Continue Watching = progress `$lookup` titles where `!watched && percent>0`, `updatedAt desc`, limit 20. Other rows: 20 items each from indexed queries. |
| `GET /api/library?q=&type=&genre=&decade=&sort=&page=&limit=50` | Text-index search or filtered browse; returns `{items, total, page}` |
| `GET /api/titles/:key` | Detail by composite key → title doc. 404 if missing or cap-locked |
| `GET /api/genres` | Distinct genre id→name pairs with counts |

### Progress
| Method & Path | Notes |
|---|---|
| `PUT /api/progress` | `{titleKey, season?, episode?, seconds, duration}` → upsert; returns `{watched, percent}` |
| `DELETE /api/progress/:titleKey` | "Remove from Continue Watching" (user-accessible) |

### Media (authenticated users only)
| Method & Path | Notes |
|---|---|
| `GET /media/:filename` | `express.static` on `/data/media` mounted behind session check; `Accept-Ranges: bytes` (built-in), `immutable` cache for uuid filenames |
| `GET /images/:group/:file` | Posters/backdrops from `/app/data/images` (read-only mount), `p/`=w500 poster, `b/`=w1280 backdrop, long-cache. **Public** (no session) so `<img>` works pre-login |

### Admin (`role==="root"` enforced server-side)
| Method & Path | Notes |
|---|---|
| `GET /api/admin/users` | List w/ session counts |
| `POST /api/admin/users` | `{username, password, caps, role:"user"}` |
| `PATCH /api/admin/users/:id` | `{password?, caps?, active?}` — deactivating kills sessions |
| `POST /api/admin/users/:id/revoke-sessions` | Kill all sessions |
| `DELETE /api/admin/users/:id` | Refuse if last root; cannot delete self |
| `GET /api/admin/prefs` / `PUT /api/admin/prefs` | Full prefs doc (never returns `tmdbKey`… actually returns it — root only) |
| `POST /api/admin/upload` | multipart `files[]` → `[{filename, size, mime}]` temp list |
| `POST /api/admin/titles` | Finalize upload: `{files, tmdb?: {type,id} \| manual: {title, year, rating, ...}}` |
| `DELETE /api/admin/titles/:id` | Local uploads only; deletes disk file + doc |
| `GET /api/admin/tmdb-search?q=` | Proxy `/search/multi` (key from prefs/env) |
| `POST /api/admin/titles/from-tmdb` | `{type, id}` → enrich + insert |
| `GET /api/admin/status` | seed state, title counts, disk usage of media volume |

### Ops
`GET /api/health` → `{ok, mongo:"up", titles: 3497, uptime}` (no auth).

## 10. UI Specification

**Routes**
```
/login                      (public)
/                           rows (auth)
/search?q=                  (auth)
/title/:key                 detail modal/page: backdrop, overview, rating badge,
                            Play / Resume button, seasons+episodes for TV
/watch/:key(?s=&e=)         player page (cinesrc iframe OR native <video>)
/admin                      (root) tabs: Library | Uploads | Users | Player | Settings
```

**Home rows:** horizontal scroll rails, poster cards (2:3), hover elevation, Continue Watching cards show progress bar + percent. Locked titles are never queried, so nothing to mask client-side (defense-in-depth: client re-checks `caps` only for cosmetic badge).

**Player pages**
- TMDB title → full-bleed iframe (`100vh`), resume passes `t=<seconds>&continueprompt=false`, custom top bar with back button (in-app router, not iframe `back` param).
- Local title → native controls (`controls`), custom minimal overlay only for back/title.
- `cinesrc:error` → dark overlay card, "Stream unavailable", Retry button (remount).
- Unsupported codec → same card with codec message.

**Responsive:** Tailwind breakpoints — `sm` mobile (rails become swipeable), `md/lg` desktop grid, **TV mode**: `@media (pointer: coarse) and (min-width: 1200px)` → larger cards, visible `:focus-visible` rings with full keyboard/D-pad navigation (arrow keys move focus between cards, Enter activates). No separate TV app — same SPA.

**Admin panel:** table-based user CRUD, caps dropdowns (movie/tv rating selects), prefs form (febbox token field with password-style input, color picker, toggles), drag-and-drop upload zone with TMDB-search side panel, library table with search + local-file delete.

## 11. Docker Specification

**`docker-compose.yml`**
```yaml
services:
  app:
    build: .            # does NOT bake catalog/images — those come from bind mount
    ports: ["6767:6767"]
    env_file: .env
    environment: { MONGO_URL: mongodb://mongo:27017 }
    volumes:
      - media_data:/data/media      # uploads (named volume)
      - ./data:/app/data:ro         # catalog.json + images/ generated by seed on host
    depends_on: { mongo: { condition: service_healthy } }
    restart: unless-stopped
    healthcheck: test: ["CMD", "node", "-e", "fetch('http://localhost:6767/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
  mongo:
    image: mongo:7
    volumes: [mongo_data:/data/db]
    restart: unless-stopped
    healthcheck: { test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"], interval: 10s, retries: 5 }
    # NO ports: published
volumes: { media_data: {}, mongo_data: {} }
```
Rationale: `data/` (~2 GB images + catalog JSON) lives on the host, bind-mounted read-only — seed runs on the host before `docker compose up`, no giant image layer, images rebuildable independently.

**`Dockerfile`** multi-stage:
1. `node:22-slim` → `npm ci` workspaces → `vite build` (client) 
2. `node:22-slim` → copy `server/`, `scripts/`, prod `node_modules`, `client/dist/` → `USER node` → `EXPOSE 6767` → `CMD ["node", "server/index.js"]`
   (No `data/` in the image — catalog + images arrive via the read-only bind mount.)

Dev mode (outside Docker): `npm run dev` = concurrently `vite` (5173, proxy `/api`+`/media` → 6767) + `node --watch server/index.js`.

## 12. Non-Functional Requirements

| Area | Target |
|---|---|
| Library query p95 | < 100 ms (indexed Mongo, 3.5k docs — trivial) |
| Concurrent streams | LAN scale (≤ 10); single Node process is sufficient |
| Login abuse | 5 attempts/15 min lockout; bcrypt cost 12 |
| Secrets | `SESSION_SECRET` in `.env` (gitignored); DB-stored TMDB key admin-only readable |
| Media storage growth | Uploads unbounded, visible via `/api/admin/status`; 50 GB default per-file cap. Images: ~2 GB fixed in `data/images/` |
| Backups | Document: `mongodump` one-liner + media volume = plain files (rsync-able) in README |
| Failure: TMDB down during admin add | 502 JSON with message, no partial insert |
| Failure: Mongo down | `/api/health` fails, container healthcheck restarts app |
| Failure: cinesrc down | Inline retry card per §7 (UI fully browsable — catalog is local) |
| Monitoring | pino JSON logs to stdout (docker logs); `/api/health` for external probes |

## 13. Integration Points

| Service | Direction | Auth | Failure strategy |
|---|---|---|---|
| **TMDB API v3** | Server-outbound (seed + admin only) | `api_key` query param | 429 backoff, 3 retries, then 502 to admin UI; seed never blocks app boot (JSON path) |
| **image.tmdb.org** | Server-outbound at seed + admin-add time (image download to `data/images/`) | none (public CDN) | 404 → poster placeholder in UI; add flow continues without image |
| **cinesrc.st embed** | Browser iframe only | none (their PoW runs client-side) | `cinesrc:error` → retry card; whole app stays usable |

## 14. Resolved Decisions (formerly Open Questions)

1. **Site display name:** "CineVault" — used on login page, `<title>`, admin header.
2. **febbox token:** none available. Field ships in prefs, empty by default; standard streams play as served.
3. **TMDB key:** confirmed created (Application URL `http://localhost:6767`). Used at catalog-generation time and stored in prefs for later admin adds.
4. **Poster hosting: downloaded locally** — seed fetches `w500` posters + `w1280` backdrops into `data/images/` (host dir, bind-mounted read-only, served at `/images/*`, est. ~2 GB). UI reads local paths only; `image.tmdb.org` remains as CSP fallback for manually added titles before their images are fetched (background job downloads them within seconds of add).
5. **Language:** seed filters `with_original_language=en` — English-only catalog.

## 15. Build Phases (ordered, each with verification)

1. **Skeleton + Docker**: compose, Dockerfile, Express boots, Mongo connects, health check green. *Verify: `docker compose up`, curl `/api/health`.*
2. **Auth**: login/logout/me, sessions, root seed, rate limit, bcrypt. *Verify: login flow + lockout + revocation.*
3. **Catalog**: `scripts/seed.mjs` run with your key → `data/catalog.json`; boot upsert; library/rows/genres/detail APIs with caps filtering. *Verify: 3,500 titles queryable; locked title returns 404 for capped user.*
4. **Frontend shell**: login page, rows home, search, detail, routing, Tailwind theme. *Verify: browse on desktop + phone viewport.*
5. **Player**: cinesrc iframe bridge, resume, TV episodes, error/retry, local `<video>` player. *Verify: movie + TV episode play; progress appears in Continue Watching.*
6. **Progress + Continue Watching**: PUT throttle, 90% rule, row, delete. *Verify: kill browser mid-movie → row shows correct %.*
7. **Admin panel**: users CRUD, caps, prefs (tmdb key/febbox/color), session revoke, Add-from-TMDB, status. *Verify: create capped child account, lockout behavior, add a missing title.*
8. **Uploads**: multipart → disk, finalize form (TMDB link/manual), library integration, playback, delete, size cap. *Verify: upload mp4 + wav, both play, wav shows audio card.*
9. **Hardening + TV polish**: CSP audit, keyboard nav, responsive pass, pino logging, README (backup/reset-root instructions). *Verify: full smoke script `scripts/smoke.mjs`.*
10. **Docs**: README + final build prompt file.

---

*Review this section by section — I'll revise anything you disagree with before a single line of app code is written.*
