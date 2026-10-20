import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";

export default function WatchPage() {
  const { key } = useParams();
  const [title, setTitle] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .title(key)
      .then((d) => alive && setTitle(d.title))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [key]);

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <div className="flex items-center gap-4 px-4 py-3 sm:px-8">
        <Link to={`/title/${encodeURIComponent(key)}`} className="text-sm text-neutral-300 hover:text-white">
          ← Back
        </Link>
        {title && <h1 className="truncate text-sm text-neutral-400">{title.title}</h1>}
      </div>
      <div className="flex flex-1 items-center justify-center px-4 text-center">
        <div className="max-w-md">
          <p className="text-lg text-neutral-300">
            {error ? error : "Player coming in Phase 5."}
          </p>
          {!error && (
            <p className="mt-2 text-sm text-neutral-500">
              Streaming integration (cinesrc embed / local playback) is the next milestone.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
