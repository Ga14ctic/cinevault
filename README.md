# CineVault

A self-hosted, LAN-only Netflix-style movie & TV library. It ships with a
pre-seeded catalog of **10,000 TMDB titles** (movies + TV) rendered as
browsable rails, streams them by finding **direct video URLs** through a
self-hosted aggregator (no third-party iframe pages, no ads), and also plays
your own local uploads natively. Multi-user, with a root admin who provisions
accounts and sets per-user parental rating ceilings.

> **Private / personal use.** This project does not host or distribute any
> media. It aggregates publicly available stream URLs and plays your own
> uploaded files. Run it on your own LAN for your household. Don't port-forward
> it to the public internet.

---

## What you get

- **10,000-title catalog** — movies + TV, with poster art, ratings, genres.
- **Direct playback** — an aggregator (`tmdb-embed-api`, bundled in the stack)
  finds MP4/HLS sources across ~13 providers; CineVault plays them in its own
  `<video>` element via a same-origin proxy. **No ads, no iframes.**
- **Auto-failover + source picker** — if a source dies, it advances to the next;
  you can also pick a source/quality manually.
- **Multi-user auth** — root admin + standard users, 30-day sessions.
- **Parental caps** — per-user movie/TV rating ceilings; blocked titles are
  fully hidden (they 404).
- **Local uploads** — drop in your own `mp4/mkv/webm/avi/mov/mp3/wav/m4a` and
  play them natively.
- **Watch progress** — Continue Watching, resume, auto-watched at 90%.
- **Admin panel** — users, caps, sessions, settings, library/disk status.
- **TV-friendly responsive UI** — desktop, phone, and TV browsers.

---

## Requirements

- **Docker + Docker Compose** on the host that will run it.
- Any Linux/macOS/Windows machine on your LAN. A small always-on box (mini PC,
  old laptop, NAS) is ideal.
- **A free TMDB API key** — needed for the catalog images and the stream
  aggregator. Get one at <https://www.themoviedb.org/settings/api>
  (request an API key; the standard developer key is fine).
- **~4–5 GB disk** for the image cache (posters/backdrops) plus room for uploads.

---

## Quick start

```bash
# 1. Clone
git clone <your-fork-or-private-repo-url> cinevault
cd cinevault

# 2. Configure environment
cp .env.example .env
```

Now edit `.env` and set **at minimum**:

| Variable | What to put |
|---|---|
| `SESSION_SECRET` | Run `openssl rand -hex 32` and paste the output. |
| `ROOT_PASS` | The password for your admin account. **Pick your own.** |
| `TMDB_API_KEY` | Your TMDB API key. |

Everything else has sane defaults. See [`.env.example`](.env.example) for all options.

```bash
# 3. Boot the stack (builds the app, pulls mongo + aggregator)
docker compose up -d --build
```

First boot takes a minute or two: it generates the TLS cert (if enabled),
seeds the root account, and imports the 10,000-title catalog.

```bash
# 4. Watch it come up
docker compose logs -f app
```

When you see `cinevault listening on :6767` and the health check go green,
open **http://localhost:6767** (or `http://<host-LAN-IP>:6767` from another
device on the LAN) and log in as `root` with your `ROOT_PASS`.

> **No images?** The 10,000-title catalog (`data/catalog.json`) is committed,
> but the ~3.5 GB of poster/backdrop images are **not** (they're gitignored).
> On a fresh clone, fetch just the images once:
> ```bash
> cp .env.example .env          # if you haven't yet, then set TMDB_API_KEY
> SEED_IMAGES_ONLY=1 node scripts/seed.mjs
> ```
> This reads the committed catalog and downloads only the images into
> `data/images/` (mounted read-only into the container). It needs only Node.js
> 18+ — the script uses no dependencies. Re-run it any time images are missing.

---

## Recommended: HTTPS on the LAN

Serving plain HTTP on a LAN IP makes some browsers **force-upgrade** the origin
to `https://` and then fail with a blank white page. The fix is to just serve
HTTPS — even with a self-signed cert, the browser stops trying to upgrade and
everything loads normally.

Enable it with the server override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml up -d --build
```

Then browse to `https://<host-LAN-IP>:6767` and accept the **one-time
"not private / proceed anyway"** warning. After that it's HTTPS everywhere, no
blank pages.

- The cert is **self-signed**, generated on first boot, stored in the
  `tls_data` volume. SANs auto-include the host's LAN IPs; add hostnames via
  `HTTPS_HOSTS` (comma-separated) if you use a `.local` name.
- Optional plain-HTTP→HTTPS redirect: uncomment the `8080` lines in
  `docker-compose.server.yml` (pick a free port).
- To install the cert as trusted on a device (removes the warning entirely):
  `docker compose cp app:/data/tls/cert.pem ./cinevault.crt`

---

## Using it

1. **Log in** as `root`.
2. Go to **Admin → Users** and **create an account for each person**. Set each
   one's **movie / TV rating ceiling** — that user will never see anything
   above it. (Passwords must be **at least 8 characters**.)
3. Hand out those accounts. Standard users just browse and play.
4. **Admin → Settings** — site name, accent color, max upload size.
5. **Admin → Status** — title/user counts, media disk usage, uptime.

### Playback

Open any title and hit Play. CineVault asks the aggregator for sources, picks a
good one (1080p direct MP4 preferred), and streams it through its own
`/embed-proxy` — so nothing touches a third-party page. Use the **Source**
dropdown to switch if a stream is slow. Titles the aggregator can't source show
a "No source available" notice rather than an ad-bearing embed.

---

## How it works

```
┌─ docker compose ─────────────────────────────────────────────┐
│                                                              │
│  app  (node:22, built SPA + Express API)        :6767        │
│   ├─ serves the React SPA                                     │
│   ├─ /api/*            JSON API                               │
│   ├─ /images/*         cached posters/backdrops               │
│   ├─ /media/*          uploaded files (Range-aware)           │
│   └─ /embed-proxy/*    same-origin proxy for video streams    │
│                                                              │
│  mongo  (mongo:7, internal only)                             │
│                                                              │
│  embed-api  (inside4ndroid/tmdb-embed-api, internal only)    │
│   └─ queries ~13 providers → returns direct stream URLs      │
└──────────────────────────────────────────────────────────────┘
```

The browser asks `app` for streams; `app` asks `embed-api`; `embed-api` returns
direct MP4/HLS URLs; `app` rewrites them to `/embed-proxy/*` so the browser
never talks to a third-party host. Everything is same-origin.

---

## Configuration reference

All via `.env` (see [`.env.example`](.env.example)):

| Variable | Default | Notes |
|---|---|---|
| `PORT` / `HTTP_PORT` | `6767` | Plain-HTTP (or sole) listen port. |
| `HTTPS` / `HTTPS_PORT` | off / `6767` | Set `HTTPS=1` to serve TLS with a self-signed cert. |
| `HTTPS_HOSTS` | — | Extra hostnames to put on the cert (comma-separated). |
| `MONGO_URL` / `MONGO_DB` | compose sets these | Leave as-is for the bundled Mongo. |
| `SESSION_SECRET` | required | `openssl rand -hex 32`. Rotating it logs everyone out. |
| `ROOT_USER` / `ROOT_PASS` | `root` / generated | Root is created **only when the users collection is empty**. |
| `TMDB_API_KEY` | — | Required for images + the aggregator. |
| `EMBED_API_URL` | `http://embed-api:8787` | Internal URL of the aggregator (compose sets it). |
| `MEDIA_DIR` | `/data/media` | Where uploads live inside the container. |

Seeding knobs (for `npm run seed`): `SEED_MOVIES` (default 6000),
`SEED_TV` (4000), `SEED_RPS`, `SEED_SKIP_IMAGES`, `SEED_IMAGES_ONLY`.

---

## Common tasks

**Rebuild after pulling changes** (always pass `--build`):
```bash
docker compose up -d --build
```

**Change the root password / caps**: log in as root → Admin → Users. You can
also edit `ROOT_PASS` in `.env` — but it only applies on a *fresh* database
(it doesn't overwrite an existing root).

**Back up** (data lives in Docker volumes + `data/`):
```bash
docker run --rm -v cinevault_media_data:/v -v "$PWD":/out alpine tar czf /out/media_data.tgz -C /v .
docker run --rm -v cinevault_mongo_data:/v -v "$PWD":/out alpine tar czf /out/mongo_data.tgz -C /v .
```
Restore by swapping the `czf` for `xzf` and mounting as `/in`.

**Reset everything** (fresh catalog, fresh users — destructive):
```bash
docker compose down -v
docker compose up -d --build
```

**Re-seed the catalog** (only runs when the `titles` collection is empty):
```bash
docker compose exec app node -e "import('./server/db.js').then(async m=>{await m.connectDb();await m.col('titles').deleteMany({})})"
docker compose restart app
```

---

## Troubleshooting

**`/admin` bounces me back to home.** You're not logged in as a root account,
or you have a stale bundle. Rebuild with `--build`. Confirm your username is the
one in `ROOT_USER` (default `root`).

**Posters are broken / grey.** You haven't fetched images on this machine. Run
`SEED_IMAGES_ONLY=1 npm run seed` (needs `TMDB_API_KEY`).

**A title says "No source available".** The aggregator couldn't find a working
stream for it right now. Try again later, or another title.

**"Playback service unavailable".** The `embed-api` container isn't running.
Check `docker compose logs embed-api` and that `EMBED_API_URL` is set on `app`.

**Blank white page on a phone/TV.** Serve HTTPS (see above). Browsers
force-upgrade insecure LAN origins.

**Can't add a user.** Passwords must be ≥ 8 characters.

---

## Notes & non-goals

- **No transcoding.** Files are streamed as-is; an unsupported codec shows an
  "unsupported" card.
- **LAN-only by design.** No port-forwarding, no VPN, no remote access.
- **One profile per account.** Caps are per-account.
- **No self-registration.** The root admin creates accounts.

See [`SPEC.md`](SPEC.md) for the full technical spec and
[`docs/MOVING.md`](docs/MOVING.md) for moving the library between machines.

---

## License / disclaimer

Personal project, shared privately. You are responsible for what you access
with it and for keeping it on your own network.
