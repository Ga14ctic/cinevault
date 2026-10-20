import { useRef } from "react";
import PosterCard from "./PosterCard.jsx";

export default function Row({ row }) {
  const scroller = useRef(null);

  const scrollBy = (dir) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  if (!row?.items?.length) return null;

  return (
    <section className="group/row relative">
      <h2 className="mb-2 px-4 text-lg font-semibold text-neutral-100 sm:px-8">{row.title}</h2>
      <div className="relative">
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
          className="absolute left-0 top-0 z-10 hidden h-full w-10 items-center justify-center bg-gradient-to-r from-black/80 to-transparent opacity-0 transition group-hover/row:opacity-100 lg:flex"
        >
          <span className="text-2xl">‹</span>
        </button>
        <div
          ref={scroller}
          className="no-scrollbar flex gap-3 overflow-x-auto scroll-smooth px-4 pb-1 sm:px-8"
        >
          {row.items.map((t) => (
            <PosterCard key={`${row.id}:${t.key}`} title={t} progress={t.progress} />
          ))}
        </div>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
          className="absolute right-0 top-0 z-10 hidden h-full w-10 items-center justify-center bg-gradient-to-l from-black/80 to-transparent opacity-0 transition group-hover/row:opacity-100 lg:flex"
        >
          <span className="text-2xl">›</span>
        </button>
      </div>
    </section>
  );
}
