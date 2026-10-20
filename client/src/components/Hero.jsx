import { Link } from "react-router-dom";
import { backdropUrl } from "../api.js";

export default function Hero({ title, resume }) {
  const bg = backdropUrl(title.backdrop_path);
  const pct = title.progress ? Math.round((title.progress.percent || 0) * 100) : 0;

  return (
    <div className="relative h-[60vh] min-h-[420px] w-full">
      {bg ? (
        <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-neutral-900" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/60 to-transparent" />
      <div className="poster-fade absolute inset-0" />
      <div className="relative flex h-full max-w-2xl flex-col justify-end gap-3 px-4 pb-24 sm:px-8">
        <h1 className="text-4xl font-bold drop-shadow-lg sm:text-5xl">{title.title}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-300">
          {title.rating && (
            <span className="rounded border border-white/30 px-1.5 py-0.5 text-xs">{title.rating}</span>
          )}
          {title.year && <span>{title.year}</span>}
          {title.vote_average > 0 && <span>★ {Number(title.vote_average).toFixed(1)}</span>}
          <span>{title.media_type === "tv" ? "TV Series" : "Movie"}</span>
        </div>
        {title.overview && (
          <p className="line-clamp-3 max-w-xl text-sm text-neutral-300 sm:text-base">{title.overview}</p>
        )}
        <div className="mt-1 flex items-center gap-3">
          <Link
            to={`/title/${encodeURIComponent(title.key)}`}
            className="flex items-center gap-2 rounded bg-white px-5 py-2 font-semibold text-black transition hover:bg-neutral-200"
          >
            ▶ {resume ? "Resume" : "More Info"}
          </Link>
        </div>
        {pct > 0 && (
          <div className="mt-2 h-1 w-64 rounded bg-white/20">
            <div className="h-full rounded bg-brand" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
