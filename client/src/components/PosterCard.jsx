import { Link } from "react-router-dom";
import { posterUrl } from "../api.js";

export default function PosterCard({ title, progress }) {
  const src = posterUrl(title.poster_path);
  const pct = progress ? Math.round((progress.percent || 0) * 100) : 0;

  return (
    <Link
      to={`/title/${encodeURIComponent(title.key)}`}
      className="group block w-[150px] shrink-0 sm:w-[160px] lg:w-[180px] focus:outline-none"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-neutral-900 ring-1 ring-white/5 transition duration-200 group-hover:ring-white/40 group-focus-visible:ring-2 group-focus-visible:ring-brand group-hover:scale-[1.03]">
        {src ? (
          <img
            src={src}
            alt={title.title}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-neutral-500">
            {title.title}
          </div>
        )}
        {title.rating && (
          <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-neutral-200">
            {title.rating}
          </span>
        )}
        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="mt-1.5 truncate px-0.5 text-sm text-neutral-300 group-hover:text-white">
        {title.title}
      </div>
      <div className="px-0.5 text-xs text-neutral-500">
        {title.media_type === "tv" ? "TV" : "Movie"}
        {title.year ? ` · ${title.year}` : ""}
        {progress?.season ? ` · S${progress.season}E${progress.episode}` : ""}
      </div>
    </Link>
  );
}
