# CineVault — Running on Another Machine

CineVault is designed to move between machines cleanly. Here's what travels and what doesn't.

## What lives where

| Data | Location | In git? | How to get it on a new machine |
|---|---|---|---|
| Source code | repo | ✅ yes | `git clone` |
| Catalog (title metadata) | `data/catalog.json` | ✅ yes (~7 MB) | comes with the clone |
| Posters / backdrops | `data/images/` | ❌ no (~3 GB) | regenerate with `SEED_IMAGES_ONLY=1` |
| User uploads | Docker volume `media_data` | ❌ no | copy the volume manually if you have uploads |
| Users / sessions / progress | Docker volume `mongo_data` | ❌ no | copy the volume manually if you want history |
| Secrets | `.env` | ❌ no | recreate from `.env.example` |

**Rule of thumb:** the *code and catalog* come from git. The *heavy media, uploads, and database* do not — regenerate or copy them.

## Steps on the new laptop

### 1. Prerequisites
- Docker + Docker Compose
- Add your user to the docker group (once): `sudo usermod -aG docker $USER` then log out/in
- Node 22+ (only needed for the image re-seed step)

### 2. Clone and configure
```bash
git clone https://github.com/Ga14ctic/cinevault.git
cd cinevault
cp .env.example .env
```

Edit `.env`:
- `SESSION_SECRET` — generate one: `openssl rand -hex 32`
- `ROOT_PASS` — set your root password (if empty, one is generated and printed to the logs on first boot)
- `TMDB_API_KEY` — needed for the image re-seed (and for admin "add from TMDB")

### 3. Regenerate the images (one-time, ~15-30 min)
The catalog JSON is already here; this just downloads the ~3 GB of posters/backdrops locally.
```bash
npm install
SEED_IMAGES_ONLY=1 npm run seed
```

### 4. Start it
```bash
docker compose up --build -d
```
Open **http://localhost:6767**.

The app imports `data/catalog.json` into MongoDB on first boot (takes a few seconds) and serves the local images from `data/images/`.

### 5. Optional — copy your old data across
If you had **user uploads** or want to keep **watch progress / accounts**:

On the OLD machine, export the volumes:
```bash
docker compose stop
docker run --rm -v cinevault_media_data:/v -v $(pwd):/out alpine tar czf /out/media_data.tgz -C /v .
docker run --rm -v cinevault_mongo_data:/v -v $(pwd):/out alpine tar czf /out/mongo_data.tgz -C /v .
```
Copy `media_data.tgz` and `mongo_data.tgz` to the new laptop, then:
```bash
docker compose up -d   # create the volumes once
docker compose stop
docker run --rm -v cinevault_media_data:/v -v $(pwd):/in alpine sh -c "cd /v && tar xzf /in/media_data.tgz"
docker run --rm -v cinevault_mongo_data:/v -v $(pwd):/in alpine sh -c "cd /v && tar xzf /in/mongo_data.tgz"
docker compose up -d
```

If you skip this, the new machine starts with a fresh database (just the root account + the full catalog) — completely fine for a clean install.

## HTTPS on the server

Plain HTTP on a LAN IP triggers browser HTTPS-upgrade errors on some devices
(white screen, `ERR_SSL_PROTOCOL_ERROR`). The fix is to just serve HTTPS — even
with a self-signed cert, the browser stops trying to "upgrade" and everything
loads normally.

### How it works
Set `HTTPS=1` and the app serves TLS with a **self-signed certificate**
generated automatically on first boot and stored in the `tls_data` volume. A
plain-HTTP port redirects to HTTPS so typing the bare host still works. Each
device shows a **one-time "not private / proceed anyway"** warning you accept —
after that it's HTTPS everywhere with no blank pages, no flags, no HSTS fights.

### Start the server stack
```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml up --build -d
```

Then browse to **https://<laptop-LAN-IP>:6767** and accept the one-time
certificate warning. (The redirect also listens on port **8080**, so
`http://<laptop-LAN-IP>:8080` forwards to HTTPS.)

> First boot generates the cert into the `tls_data` volume. To regenerate it,
> `docker compose down -v` then up again — but you'll re-accept the warning once.

> Optional: you can install the generated cert as a trusted root on each device
> to remove even the one-time warning. The cert lives at
> `/data/tls/cert.pem` inside the app container
> (`docker compose cp app:/data/tls/cert.pem ./cinevault.crt`).

## Playback aggregator (embed-api)

Remote playback is powered by a self-hosted stream aggregator
(`inside4ndroid/tmdb-embed-api`), defined as the `embed-api` service in
`docker-compose.yml`. It queries ~13 providers and returns **direct** HLS/MP4
URLs, which the app plays in its own `<video>` element (no iframes, no
third-party frame blocks). CineVault proxies those streams back through
`/embed-proxy/*`.

Requirements:
- The `embed-api` service must be present and the app must have
  `EMBED_API_URL=http://embed-api:8787` (already set in `docker-compose.yml`).
- `TMDB_API_KEY` must be set in `.env` — the aggregator uses it to resolve
  titles. Same key the app already uses.
- On first boot the aggregator creates `utils/auth-users.json` with
  `admin` / `change-me`. It is **internal only** (no published port); you only
  need those credentials if you want to open its admin panel.

If the aggregator is missing or returns nothing for a title, the player
automatically falls back to the iframe embed providers (CineSrc / VidLink).

## Notes

- **Never commit** `.env`, `data/images/`, or the Docker volumes — they're gitignored.
- The catalog is committed so a fresh clone gets the full library without re-querying TMDB for metadata; only the images are regenerated.
- If you *change* the catalog on one machine (e.g. raise the title count in the seed), commit the new `data/catalog.json` and re-seed images on the other.
