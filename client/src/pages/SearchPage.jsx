import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import PosterCard from "../components/PosterCard.jsx";

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!q) return;
    let alive = true;
    setLoading(true);
    api
      .library({ q, limit: 60 })
      .then((d) => alive && setResult(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q]);

  return (
    <div className="px-4 pb-16 pt-4 sm:px-8">
      <h1 className="mb-4 text-xl text-neutral-300">
        {q ? (
          <>
            Results for <span className="font-semibold text-white">“{q}”</span>
          </>
        ) : (
          "Search"
        )}
      </h1>
      {loading && <p className="text-neutral-500">Searching…</p>}
      {result && result.items.length === 0 && (
        <p className="text-neutral-500">No titles found.</p>
      )}
      {result && result.items.length > 0 && (
        <>
          <p className="mb-4 text-sm text-neutral-500">{result.total} results</p>
          <div className="flex flex-wrap gap-3">
            {result.items.map((t) => (
              <PosterCard key={t.key} title={t} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
