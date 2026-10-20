import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, backdropUrl, posterUrl } from "../api.js";

export default function TitlePage() {
  const { key } = useParams();
  const [title, setTitle] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setTitle(null);
    setError(null);
    api
      .title(key)
      .then((d) => alive && setTitle(d.title))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [key]);

  if (error) {
    return (
      <div className="px-8 py-16 text-center">
        <p className="text-lg text-neutral-300">{error}</p>
        <Link to="/" className="mt-4 inline-block text-brand hover:underline">
          ← Back to home
        </Link>
      </div>
    );
  }

  if (!title) {
    return <div className="px-8 py-16 text-neutral-500">Loading…</div>;
  }

  const bg = backdropUrl(title.backdrop_path);
  const poster = posterUrl(title.poster_path);

  return (
    <div className="pb-16">
      <div className="relative h-[50vh] min-h-[360px] w-full">
        {bg ? (
          <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-neutral-900" />
        )}
        <div className="poster-fade absolute inset-0" />
        <Link
          to="/"
          className="absolute left-4 top-4 rounded-full bg-black/60 px-3 py-1.5 text-sm backdrop-blur hover:bg-black/80"
        >
          ← Back
        </Link>
      </div>

      <div className="relative z-10 -mt-32 mx-auto max-w-5xl px-4 sm:px-8">
        <div className="flex flex-col gap-6 sm:flex-row">
          {poster && (
            <img
              src={poster}
              alt={title.title}
              className="hidden w-48 shrink-0 rounded-lg ring-1 ring-white/10 sm:block"
            />
          )}
          <div className="flex-1">
            <h1 className="text-3xl font-bold sm:text-4xl">{title.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-300">
              {title.rating && (
                <span className="rounded border border-white/30 px-1.5 py-0.5 text-xs">{title.rating}</span>
              )}
              {title.year && <span>{title.year}</span>}
              {title.vote_average > 0 && <span>★ {Number(title.vote_average).toFixed(1)}</span>}
              <span>{title.media_type === "tv" ? "TV Series" : "Movie"}</span>
              {title.runtime ? <span>{title.runtime} min</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(title.genre_names || []).map((g) => (
                <span key={g} className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs">
                  {g}
                </span>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to={`/watch/${encodeURIComponent(title.key)}`}
                className="flex items-center gap-2 rounded bg-white px-6 py-2.5 font-semibold text-black hover:bg-neutral-200"
              >
                ▶ Play
              </Link>
            </div>

            {title.overview && (
              <p className="mt-6 max-w-3xl leading-relaxed text-neutral-300">{title.overview}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
