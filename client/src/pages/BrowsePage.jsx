import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import PosterCard from "../components/PosterCard.jsx";

const SORTS = [
  { value: "popularity", label: "Popularity" },
  { value: "rating", label: "Rating" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "title", label: "A–Z" },
];

export default function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const type = params.get("type") || "";
  const genre = params.get("genre") || "";
  const sort = params.get("sort") || "popularity";
  const decade = params.get("decade") || "";
  const page = Number(params.get("page") || 1);

  const [result, setResult] = useState(null);
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.genres().then((d) => setGenres(d.genres)).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .library({ type, genre, sort, decade, page, limit: 60 })
      .then((d) => alive && setResult(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [type, genre, sort, decade, page]);

  const update = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next);
  };

  const selectCls =
    "rounded bg-neutral-800 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 focus:ring-white/40";

  return (
    <div className="px-4 pb-16 pt-4 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">
          {type === "movie" ? "Movies" : type === "tv" ? "TV Shows" : "Browse"}
        </h1>
        <select value={type} onChange={(e) => update("type", e.target.value)} className={selectCls}>
          <option value="">All types</option>
          <option value="movie">Movies</option>
          <option value="tv">TV Shows</option>
        </select>
        <select value={genre} onChange={(e) => update("genre", e.target.value)} className={selectCls}>
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select value={decade} onChange={(e) => update("decade", e.target.value)} className={selectCls}>
          <option value="">Any year</option>
          {[2020, 2010, 2000, 1990, 1980, 1970, 1960, 1950].map((d) => (
            <option key={d} value={d}>
              {d}s
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => update("sort", e.target.value)} className={selectCls}>
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-neutral-500">Loading…</p>}
      {!loading && result && (
        <>
          <p className="mb-4 text-sm text-neutral-500">{result.total} titles</p>
          <div className="flex flex-wrap gap-3">
            {result.items.map((t) => (
              <PosterCard key={t.key} title={t} />
            ))}
          </div>
          {result.pages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-4 text-sm">
              <button
                disabled={page <= 1}
                onClick={() => update("page", String(page - 1))}
                className="rounded bg-white/10 px-4 py-2 disabled:opacity-30"
              >
                Previous
              </button>
              <span className="text-neutral-400">
                Page {result.page} / {result.pages}
              </span>
              <button
                disabled={page >= result.pages}
                onClick={() => update("page", String(page + 1))}
                className="rounded bg-white/10 px-4 py-2 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
