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

## HTTPS on the server (home.switchyard.uk)

Plain HTTP on a LAN IP triggers browser HTTPS-upgrade errors on some devices
(white screen, `ERR_SSL_PROTOCOL_ERROR`). Fix it properly by serving HTTPS with
a **real Let's Encrypt certificate** via Caddy — no warnings, works on every
device in the house.

**How it works:** a DNS-only (grey cloud) `A` record points the subdomain at the
laptop's LAN IP, and Caddy proves domain ownership with the **Cloudflare DNS-01
challenge** — so no inbound ports are opened and it stays LAN-only.

### One-time Cloudflare setup
1. DNS → add an `A` record: `home` (or your subdomain) → the **laptop's LAN IP**
   (e.g. `192.168.1.235`), **proxy status: DNS only (grey cloud)**.
2. My Profile → API Tokens → Create Token → **Edit zone DNS** template →
   scope to the `switchyard.uk` zone → copy the token.

### One-time laptop setup
Add to `.env`:
```bash
SITE_DOMAIN=home.switchyard.uk
ACME_EMAIL=you@switchyard.uk
CF_API_TOKEN=<the token from step 2>
```

### Start the server stack
Use the server override (adds Caddy + HTTPS; the dev machine never uses it):
```bash
docker compose -f docker-compose.yml -f docker-compose.server.yml up --build -d
```

First boot takes ~30s while Caddy obtains the cert. Then browse to
**https://home.switchyard.uk** — valid cert, no warnings, on every device.

> If the cert fails, check `docker compose logs caddy`. Most common cause: the
> API token lacks `Zone:DNS:Edit`, or the DNS record is orange-cloud (proxied).

## Notes

- **Never commit** `.env`, `data/images/`, or the Docker volumes — they're gitignored.
- The catalog is committed so a fresh clone gets the full library without re-querying TMDB for metadata; only the images are regenerated.
- If you *change* the catalog on one machine (e.g. raise the title count in the seed), commit the new `data/catalog.json` and re-seed images on the other.
