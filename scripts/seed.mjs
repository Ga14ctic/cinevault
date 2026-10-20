import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

const MOVIE_TARGET = Number(process.env.SEED_MOVIES || 2000);
const TV_TARGET = Number(process.env.SEED_TV || 1500);
const RPS = Number(process.env.SEED_RPS || 4);
const IMG_WORKERS = Number(process.env.SEED_IMG_WORKERS || 6);
const SKIP_IMAGES = process.env.SEED_SKIP_IMAGES === "1";

const key =
  process.env.TMDB_API_KEY ||
  process.env.TMDB_KEY ||
  readDotEnv("TMDB_API_KEY");

function readDotEnv(name) {
  try {
    const txt = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const line = txt.split("\n").find((l) => l.trim().startsWith(`${name}=`));
    return line ? line.slice(line.indexOf("=") + 1).trim() : null;
  } catch {
    return null;
  }
}

if (!key) {
  console.error("No TMDB key. Set TMDB_API_KEY in .env or the environment.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Limiter {
  constructor(rps) {
    this.minGap = 1000 / rps;
    this.last = 0;
    this.chain = Promise.resolve();
  }
  run(fn) {
    const exec = this.chain.then(async () => {
      const gap = this.minGap - (Date.now() - this.last);
      if (gap > 0) await sleep(gap);
      this.last = Date.now();
      return fn();
    });
    this.chain = exec.catch(() => {});
    return exec;
  }
}

const limiter = new Limiter(RPS);

async function tmdb(pathname, { retries = 3 } = {}) {
  const url = pathname.includes("?")
    ? `${API}${pathname}&api_key=${key}`
    : `${API}${pathname}?api_key=${key}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await limiter.run(() => fetch(url));
      if (res.status === 429 || res.status >= 500) {
        const wait = 1000 * attempt + Math.random() * 500;
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`${res.status} ${body.slice(0, 120)}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

async function fetchGenres() {
  const [movie, tv] = await Promise.all([
    tmdb("/genre/movie/list"),
    tmdb("/genre/tv/list"),
  ]);
  const map = {};
  for (const g of [...movie.genres, ...tv.genres]) map[g.id] = g.name;
  return map;
}

async function discover(type, target) {
  const out = [];
  const seen = new Set();
  let page = 1;
  const maxPages = 500;
  while (out.length < target && page <= maxPages) {
    const q =
      type === "movie"
        ? `/discover/movie?sort_by=popularity.desc&include_adult=false&with_original_language=en&page=${page}`
        : `/discover/tv?sort_by=popularity.desc&with_original_language=en&page=${page}`;
    let data;
    try {
      data = await tmdb(q);
    } catch (err) {
      console.warn(`  ! discover ${type} page ${page} failed: ${err.message}`);
      page++;
      continue;
    }
    const results = data.results || [];
    if (results.length === 0) break;
    for (const r of results) {
      if (out.length >= target) break;
      if (!r.poster_path || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    const pct = Math.round((out.length / target) * 100);
    process.stdout.write(`\r  ${type}: ${out.length}/${target} (${pct}%) page ${page}   `);
    page++;
  }
  process.stdout.write("\n");
  return out;
}

async function movieCertification(id) {
  try {
    const data = await tmdb(`/movie/${id}/release_dates`);
    const seen = new Set();
    for (const entry of data.results || []) {
      if (entry.iso_3166_1 !== "US") continue;
      for (const rd of entry.release_dates || []) {
        const c = (rd.certification || "").trim();
        if (c) seen.add(c);
      }
    }
    return pickMovieCert(seen);
  } catch {
    return null;
  }
}

function pickMovieCert(set) {
  const order = ["G", "PG", "PG-13", "R", "NC-17"];
  for (const c of order) if (set.has(c)) return c;
  for (const c of set) if (order.includes(c)) return c;
  return null;
}

async function tvCertification(id) {
  try {
    const data = await tmdb(`/tv/${id}`);
    const ratings = data?.content_ratings?.results || [];
    const us = ratings.find((r) => r.iso_3166_1 === "US");
    const c = (us?.rating || "").trim();
    return c || null;
  } catch {
    return null;
  }
}

async function downloadImage(remotePath, destAbs) {
  if (SKIP_IMAGES || !remotePath) return false;
  if (fs.existsSync(destAbs)) return true;
  const url = `${IMG}${remotePath}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(String(res.status));
      const buf = Buffer.from(await res.arrayBuffer());
      await fs.promises.writeFile(destAbs, buf);
      return true;
    } catch {
      if (attempt === 2) return false;
      await sleep(500);
    }
  }
  return false;
}

async function runPool(items, workers, fn) {
  let idx = 0;
  let done = 0;
  let failed = 0;
  const total = items.length;
  async function worker() {
    while (idx < total) {
      const i = idx++;
      try {
        await fn(items[i], i);
      } catch {
        failed++;
      }
      done++;
      if (done % 25 === 0 || done === total) {
        process.stdout.write(`\r  images/titles: ${done}/${total} (failed ${failed})   `);
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  process.stdout.write("\n");
  return failed;
}

async function enrichMovies(rows, genreMap, imagesDir) {
  const titles = [];
  console.log(`Enriching ${rows.length} movies (certifications + images)...`);
  const failed = await runPool(rows, Math.max(1, Math.min(8, Math.round(RPS))), async (r) => {
    const cert = await movieCertification(r.id);
    const year = (r.release_date || "").split("-")[0];
    const poster = r.poster_path ? `/p/${r.id}.jpg` : null;
    const backdrop = r.backdrop_path ? `/b/${r.id}.jpg` : null;
    await downloadImage(`${IMG}/w500${r.poster_path}`, path.join(imagesDir, "p", `${r.id}.jpg`)).catch(() => {});
    await downloadImage(`${IMG}/w1280${r.backdrop_path}`, path.join(imagesDir, "b", `${r.id}.jpg`)).catch(() => {});
    titles.push({
      key: `tmdb:movie:${r.id}`,
      media_type: "movie",
      tmdb_id: r.id,
      title: r.title,
      original_title: r.original_title || r.title,
      overview: r.overview || "",
      year: year ? Number(year) : null,
      poster_path: poster,
      backdrop_path: backdrop,
      genres: r.genre_ids || [],
      genre_names: (r.genre_ids || []).map((g) => genreMap[g]).filter(Boolean),
      rating: cert,
      vote_average: r.vote_average ?? null,
      popularity: r.popularity ?? null,
      runtime: null,
      source: "seed",
      local: null,
    });
  });
  return { titles, failed };
}

async function enrichTv(rows, genreMap, imagesDir) {
  const titles = [];
  console.log(`Enriching ${rows.length} TV shows (certifications + images)...`);
  const failed = await runPool(rows, Math.max(1, Math.min(8, Math.round(RPS))), async (r) => {
    const cert = await tvCertification(r.id);
    const year = (r.first_air_date || "").split("-")[0];
    const poster = r.poster_path ? `/p/${r.id}.jpg` : null;
    const backdrop = r.backdrop_path ? `/b/${r.id}.jpg` : null;
    await downloadImage(`${IMG}/w500${r.poster_path}`, path.join(imagesDir, "p", `${r.id}.jpg`)).catch(() => {});
    await downloadImage(`${IMG}/w1280${r.backdrop_path}`, path.join(imagesDir, "b", `${r.id}.jpg`)).catch(() => {});
    titles.push({
      key: `tmdb:tv:${r.id}`,
      media_type: "tv",
      tmdb_id: r.id,
      title: r.name,
      original_title: r.original_name || r.name,
      overview: r.overview || "",
      year: year ? Number(year) : null,
      poster_path: poster,
      backdrop_path: backdrop,
      genres: r.genre_ids || [],
      genre_names: (r.genre_ids || []).map((g) => genreMap[g]).filter(Boolean),
      rating: cert,
      vote_average: r.vote_average ?? null,
      popularity: r.popularity ?? null,
      runtime: null,
      source: "seed",
      local: null,
    });
  });
  return { titles, failed };
}

async function main() {
  const started = Date.now();
  const genreMap = await fetchGenres();
  console.log(`Loaded ${Object.keys(genreMap).length} genres.`);

  const imagesDir = path.join(ROOT, "data", "images");
  fs.mkdirSync(path.join(imagesDir, "p"), { recursive: true });
  fs.mkdirSync(path.join(imagesDir, "b"), { recursive: true });

  const movieRows = await discover("movie", MOVIE_TARGET);
  const tvRows = await discover("tv", TV_TARGET);

  const movieResult = await enrichMovies(movieRows, genreMap, imagesDir);
  const tvResult = await enrichTv(tvRows, genreMap, imagesDir);

  const titles = [...movieResult.titles, ...tvResult.titles];
  const outPath = path.join(ROOT, "data", "catalog.json");
  fs.writeFileSync(outPath, JSON.stringify(titles));
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  const withCert = titles.filter((t) => t.rating).length;
  console.log(`\nWrote ${titles.length} titles -> ${outPath}`);
  console.log(`  movies: ${movieResult.titles.length}, tv: ${tvResult.titles.length}`);
  console.log(`  with US rating: ${withCert}/${titles.length}`);
  console.log(`  enrich failures: ${movieResult.failed + tvResult.failed}`);
  console.log(`  elapsed: ${mins} min`);
}

main().catch((err) => {
  console.error("seed failed:", err);
  process.exit(1);
});
