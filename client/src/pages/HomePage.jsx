import { useEffect, useState } from "react";
import { api } from "../api.js";
import Row from "../components/Row.jsx";
import Hero from "../components/Hero.jsx";

export default function HomePage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .rows()
      .then((d) => alive && setRows(d.rows))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  const hero = rows?.[0]?.items?.[0];

  return (
    <div className="pb-16">
      {hero && !rows?.[0]?.id?.startsWith("continue") && <Hero title={hero} />}
      {rows?.[0]?.id === "continue" && <Hero title={rows[0].items[0]} resume />}

      <div className="-mt-16 relative z-10 space-y-8">
        {error && <p className="px-8 text-red-400">Failed to load library: {error}</p>}
        {!rows && !error && (
          <div className="space-y-8 px-4 sm:px-8">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-5 w-40 animate-pulse rounded bg-neutral-800" />
                <div className="flex gap-3">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <div key={j} className="h-64 w-[160px] animate-pulse rounded-md bg-neutral-900" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {rows?.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}
