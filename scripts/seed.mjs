import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

const MOVIE_TARGET = Number(process.env.SEED_MOVIES || 6000);
const TV_TARGET = Number(process.env.SEED_TV || 4000);
const RPS = Number(process.env.SEED_RPS || 5);
const IMG_WORKERS = Number(process.env.SEED_IMG_WORKERS || 8);
const SKIP_IMAGES = process.env.SEED_SKIP_IMAGES === "1";

const DECADES = [
  { gte: "1950-01-01", lte: "1959-12-31", label: "1950s" },
  { gte: "1960-01-01", lte: "1969-12-31", label: "1960s" },
  { gte: "1970-01-01", lte: "1979-12-31", label: "1970s" },
  { gte: "1980-01-01", lte: "1989-12-31", label: "1980s" },
  { gte: "1990-01-01", lte: "1999-12-31", label: "1990s" },
  { gte: "2000-01-01", lte: "2009-12-31", label: "2000s" },
  { gte: "2010-01-01", lte: "2019-12-31", label: "2010s" },
  { gte: "2020-01-01", lte: "2029-12-31", label: "2020s" },
];

const key = process.env.TMDB_API_KEY || readDotEnv("TMDB_API_KEY");

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
        await sleep(1000 * attempt + Math.random() * 500);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
}

async function fetchGenres() {
  const [movie, tv] = await Promise.all([tmdb("/genre/movie/list"), tmdb("/genre/tv/list")]);
  const map = {};
  for (const g of [...movie.genres, ...tv.genres]) map[g.id] = g.name;
  return map;
}

function discoverUrl(type, sort, page, extra = {}) {
  const base = type === "movie" ? "/discover/movie" : "/discover/tv";
  const params = new URLSearchParams({
    sort_by: sort,
    page: String(page),
    include_adult: "false",
    with_original_language: "en",
  });
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return `${base}?${params.toString()}`;
}

async function collectPages(type, sort, pages, extra, seen, bucket) {
  for (let page = 1; page <= pages; page++) {
    let data;
    try {
      data = await tmdb(discoverUrl(type, sort, page, extra));
    } catch {
      continue;
    }
    const results = data.results || [];
    if (results.length === 0) return;
    for (const r of results) {
      if (!r.poster_path) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      bucket.set(r.id, r);
    }
  }
}

async function buildBucket(type, genreMap, target) {
  const seen = new Set();
  const bucket = new Map();

  const log = (label) =>
    process.stdout.write(`\r  ${type} [${label}]: ${bucket.size}/${target}   `);

  // 1) Deep popularity (mainstream + mid-tier, but recency-biased)
  const popPages = Math.ceil((target / 20) * 1.6);
  await collectPages(type, "popularity.desc", popPages, {}, seen, bucket);
  log("popularity");

  // 1b) Most-voted (rank by TOTAL number of ratings) — the best proxy for
  // "widely watched", catches beloved-but-not-trending films (Anchorman,
  // Borat, Zoolander, The Dictator) that popularity.desc skips.
  const votePages = Math.ceil((target / 20) * 1.2);
  await collectPages(type, "vote_count.desc", votePages, {}, seen, bucket);
  log("most-voted");

  // 2) Top-rated with vote floor (critically loved, not trending)
  const ratePages = Math.ceil((target / 20) * 0.8);
  await collectPages(
    type,
    "vote_average.desc",
    ratePages,
    { "vote_count.gte": "500" },
    seen,
    bucket
  );
  log("top-rated");

  // 3) By decade
  for (const d of DECADES) {
    const extra =
      type === "movie"
        ? { "primary_release_date.gte": d.gte, "primary_release_date.lte": d.lte }
        : { "first_air_date.gte": d.gte, "first_air_date.lte": d.lte };
    await collectPages(type, "popularity.desc", Math.ceil(target / 100), extra, seen, bucket);
    log(d.label);
  }

  // 4) By genre
  const genreIds = Object.keys(genreMap).map(Number);
  const perGenrePages = Math.max(2, Math.ceil(target / genreIds.length / 40));
  for (const gid of genreIds) {
    await collectPages(
      type,
      "popularity.desc",
      perGenrePages,
      { with_genres: String(gid) },
      seen,
      bucket
    );
  }
  log("genres");

  process.stdout.write("\n");

  // Rank the merged pool and keep the best `target`. Score rewards titles
  // many people have rated (vote_count) with a popularity nudge, so the cap
  // trims obscure entries rather than widely-watched ones.
  const scored = [...bucket.values()].map((r) => {
    const votes = r.vote_count || 0;
    const pop = r.popularity || 0;
    return { r, score: Math.log10(votes + 1) * 100 + pop };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, target).map((s) => s.r);
}

async function movieCertification(id) {
  try {
    const data = await tmdb(`/movie/${id}/release_dates`);
    const set = new Set();
    for (const entry of data.results || []) {
      if (entry.iso_3166_1 !== "US") continue;
      for (const rd of entry.release_dates || []) {
        const c = (rd.certification || "").trim();
        if (c) set.add(c);
      }
    }
    const order = ["G", "PG", "PG-13", "R", "NC-17"];
    for (const c of order) if (set.has(c)) return c;
    return null;
  } catch {
    return null;
  }
}

async function tvCertification(id) {
  try {
    const data = await tmdb(`/tv/${id}`);
    const us = (data?.content_ratings?.results || []).find((r) => r.iso_3166_1 === "US");
    return (us?.rating || "").trim() || null;
  } catch {
    return null;
  }
}

async function downloadImage(remotePath, destAbs) {
  if (SKIP_IMAGES || !remotePath) return false;
  if (fs.existsSync(destAbs)) return true;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${IMG}${remotePath}`);
      if (res.status === 404) return false;
      if (!res.ok) throw new Error(String(res.status));
      await fs.promises.writeFile(destAbs, Buffer.from(await res.arrayBuffer()));
      return true;
    } catch {
      if (attempt === 2) return false;
      await sleep(400);
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
      if (done % 50 === 0 || done === total) {
        process.stdout.write(`\r  enrich: ${done}/${total} (failed ${failed})   `);
      }
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  process.stdout.write("\n");
  return failed;
}

async function buildRows(type, rows, genreMap, imagesDir) {
  const out = new Array(rows.length);
  const enrichWorkers = Math.max(2, Math.min(10, Math.ceil(RPS * 1.5)));
  const failed = await runPool(rows, enrichWorkers, async (r, idx) => {
    const isMovie = type === "movie";
    const cert = isMovie ? await movieCertification(r.id) : await tvCertification(r.id);
    const date = isMovie ? r.release_date : r.first_air_date;
    const year = (date || "").split("-")[0];
    await Promise.all([
      downloadImage(`${IMG}/w500${r.poster_path}`, path.join(imagesDir, "p", `${r.id}.jpg`)),
      downloadImage(`${IMG}/w1280${r.backdrop_path}`, path.join(imagesDir, "b", `${r.id}.jpg`)),
    ]);
    out[idx] = {
      key: `tmdb:${type}:${r.id}`,
      media_type: type,
      tmdb_id: r.id,
      title: isMovie ? r.title : r.name,
      original_title: (isMovie ? r.original_title : r.original_name) || (isMovie ? r.title : r.name),
      overview: r.overview || "",
      year: year ? Number(year) : null,
      poster_path: `/p/${r.id}.jpg`,
      backdrop_path: r.backdrop_path ? `/b/${r.id}.jpg` : null,
      poster_remote: r.poster_path || null,
      backdrop_remote: r.backdrop_path || null,
      genres: r.genre_ids || [],
      genre_names: (r.genre_ids || []).map((g) => genreMap[g]).filter(Boolean),
      rating: cert,
      vote_average: r.vote_average ?? null,
      popularity: r.popularity ?? null,
      runtime: null,
      source: "seed",
      local: null,
    };
  });
  return { titles: out.filter(Boolean), failed };
}

async function main() {
  const started = Date.now();

  // Images-only mode: regenerate local posters/backdrops from an existing
  // catalog.json (used when moving the library to a new machine — the JSON is
  // committed to git, the ~3GB of images are regenerated locally).
  if (process.env.SEED_IMAGES_ONLY === "1") {
    const outPath = path.join(ROOT, "data", "catalog.json");
    if (!fs.existsSync(outPath)) {
      console.error(`No catalog.json at ${outPath} — nothing to fetch images for.`);
      process.exit(1);
    }
    const titles = JSON.parse(fs.readFileSync(outPath, "utf8"));
    const imagesDir = path.join(ROOT, "data", "images");
    fs.mkdirSync(path.join(imagesDir, "p"), { recursive: true });
    fs.mkdirSync(path.join(imagesDir, "b"), { recursive: true });
    console.log(`Fetching images for ${titles.length} titles from catalog.json...`);
    const failed = await runPool(titles, IMG_WORKERS, async (t) => {
      if (!t.tmdb_id) return;
      const p = path.join(imagesDir, "p", `${t.tmdb_id}.jpg`);
      const b = path.join(imagesDir, "b", `${t.tmdb_id}.jpg`);
      if (t.poster_remote && !fs.existsSync(p)) await downloadImage(`${IMG}/w500${t.poster_remote}`, p);
      if (t.backdrop_remote && !fs.existsSync(b)) await downloadImage(`${IMG}/w1280${t.backdrop_remote}`, b);
    });
    console.log(`\nDone. images dir: ${imagesDir} (failed ${failed})`);
    return;
  }

  const genreMap = await fetchGenres();
  console.log(`Loaded ${Object.keys(genreMap).length} genres.`);

  const imagesDir = path.join(ROOT, "data", "images");
  fs.mkdirSync(path.join(imagesDir, "p"), { recursive: true });
  fs.mkdirSync(path.join(imagesDir, "b"), { recursive: true });

  console.log(`\nDiscovering movies (target ${MOVIE_TARGET})...`);
  const movieRows = await buildBucket("movie", genreMap, MOVIE_TARGET);
  console.log(`\nDiscovering TV (target ${TV_TARGET})...`);
  const tvRows = await buildBucket("tv", genreMap, TV_TARGET);

  console.log(`\nEnriching ${movieRows.length} movies (certifications + images)...`);
  const movieResult = await buildRows("movie", movieRows, genreMap, imagesDir);
  console.log(`Enriching ${tvRows.length} TV shows (certifications + images)...`);
  const tvResult = await buildRows("tv", tvRows, genreMap, imagesDir);

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
