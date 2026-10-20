import { col } from "./db.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

const API = "https://api.themoviedb.org/3";

export async function getTmdbKey() {
  if (config.tmdbKeyEnv) return config.tmdbKeyEnv;
  const prefs = await col("prefs").findOne({ _id: "singleton" });
  return prefs?.tmdbKey || null;
}

export async function tmdbFetch(pathname, { key, retries = 2 } = {}) {
  const apiKey = key || (await getTmdbKey());
  if (!apiKey) {
    const err = new Error("TMDB key not configured");
    err.status = 503;
    err.code = "NO_TMDB_KEY";
    throw err;
  }
  const url = `${API}${pathname}${pathname.includes("?") ? "&" : "?"}api_key=${apiKey}`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      if (!res.ok) {
        const err = new Error(`TMDB ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

export async function getTvDetails(tmdbId) {
  const data = await tmdbFetch(`/tv/${tmdbId}`);
  return {
    seasons: (data.seasons || [])
      .filter((s) => s.season_number > 0 && s.episode_count > 0)
      .map((s) => ({
        number: s.season_number,
        name: s.name,
        episodes: s.episode_count,
        air_date: s.air_date,
      })),
    first_season: data.number_of_seasons,
    first_episode: 1,
  };
}

export async function getSeasonDetails(tmdbId, season) {
  const data = await tmdbFetch(`/tv/${tmdbId}/season/${season}`);
  return {
    season: data.season_number,
    episodes: (data.episodes || []).map((e) => ({
      number: e.episode_number,
      name: e.name,
      overview: e.overview,
      air_date: e.air_date,
      still_path: e.still_path || null,
      runtime: e.runtime,
    })),
  };
}

export async function searchTmdb(query) {
  const data = await tmdbFetch(`/search/multi?query=${encodeURIComponent(query)}`);
  return (data.results || [])
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .slice(0, 20)
    .map((r) => ({
      tmdb_id: r.id,
      media_type: r.media_type,
      title: r.media_type === "movie" ? r.title : r.name,
      year: ((r.media_type === "movie" ? r.release_date : r.first_air_date) || "").split("-")[0],
      poster_path: r.poster_path,
      overview: r.overview,
    }));
}

export async function fetchTitleByTmdb(type, id) {
  const isMovie = type === "movie";
  const data = await tmdbFetch(isMovie ? `/movie/${id}` : `/tv/${id}`);
  const date = isMovie ? data.release_date : data.first_air_date;
  const year = (date || "").split("-")[0];
  return {
    key: `tmdb:${type}:${id}`,
    media_type: type,
    tmdb_id: id,
    title: isMovie ? data.title : data.name,
    original_title: (isMovie ? data.original_title : data.original_name) || data.title || data.name,
    overview: data.overview || "",
    year: year ? Number(year) : null,
    poster_path: data.poster_path ? `/p/${id}.jpg` : null,
    backdrop_path: data.backdrop_path ? `/b/${id}.jpg` : null,
    poster_remote: data.poster_path || null,
    backdrop_remote: data.backdrop_path || null,
    genres: (data.genres || []).map((g) => g.id),
    genre_names: (data.genres || []).map((g) => g.name),
    rating: null,
    vote_average: data.vote_average ?? null,
    popularity: data.popularity ?? null,
    runtime: isMovie ? data.runtime ?? null : null,
    source: "admin",
    local: null,
  };
}
