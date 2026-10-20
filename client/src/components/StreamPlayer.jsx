import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import DirectPlayer from "./DirectPlayer.jsx";
import EmbedPlayer from "./EmbedPlayer.jsx";

// Quality rank for default ordering (higher = preferred).
function qRank(q) {
  const s = String(q || "").toLowerCase();
  if (s.includes("2160") || s.includes("4k")) return 2160;
  if (s.includes("1440")) return 1440;
  if (s.includes("1080")) return 1080;
  if (s.includes("720")) return 720;
  if (s.includes("480")) return 480;
  if (s.includes("360")) return 360;
  return 500; // "auto"/unknown — mid preference
}

// Prefer 1080p-ish, and direct MP4 files (which play natively) over HLS from
// providers that serve obfuscated segments our <video> can't demux.
function score(s) {
  const q = qRank(s.quality);
  const qScore = q >= 1080 ? 1000 : q; // cap so 4K isn't wildly ahead
  const isFile = !s.url.includes("m3u8-proxy");
  const fileBonus = isFile ? 200 : 0;
  const providerPenalty = /4khdhub/i.test(s.provider || "") ? 40 : 0; // huge remux files
  return qScore + fileBonus - providerPenalty;
}

function label(s) {
  const q = s.quality && s.quality !== "Auto" ? s.quality : "";
  return [s.provider, q].filter(Boolean).join(" · ") || s.name || "Source";
}

// Handles stream selection, automatic failover, and the source switcher.
// Falls back to the iframe EmbedPlayer when the aggregator has nothing.
export function StreamPlayer({
  title,
  season,
  episode,
  startTime,
  cinesrc,
  onProgress,
  onNextEpisode,
}) {
  const key = title?.key;
  const [streams, setStreams] = useState(null); // null=loading, []=none
  const [idx, setIdx] = useState(0);
  const [aggMissing, setAggMissing] = useState(false);
  const triedRef = useRef(new Set());

  useEffect(() => {
    if (!key || title?.local) return;
    let alive = true;
    setStreams(null);
    setIdx(0);
    triedRef.current = new Set();
    const isTv = title.media_type === "tv";
    api
      .streams(key, isTv ? season : undefined, isTv ? episode : undefined)
      .then((d) => {
        if (!alive) return;
        const list = [...(d.streams || [])].sort((a, b) => score(b) - score(a));
        setStreams(list);
      })
      .catch((e) => {
        if (!alive) return;
        if (e?.code === "NO_EMBED_API") setAggMissing(true);
        setStreams([]);
      });
    return () => {
      alive = false;
    };
  }, [key, season, episode, title?.media_type, title?.local]);

  const handleFail = () => {
    setIdx((i) => {
      triedRef.current.add(i);
      const next = streams ? streams.findIndex((_, n) => n > i && !triedRef.current.has(n)) : -1;
      return next > -1 ? next : i;
    });
  };

  // Aggregator not configured → straight to iframe providers.
  if (aggMissing) {
    return (
      <EmbedPlayer
        title={title}
        season={season}
        episode={episode}
        cinesrc={cinesrc}
        onProgress={onProgress}
        onNextEpisode={onNextEpisode}
      />
    );
  }

  if (streams === null) {
    return (
      <div className="flex aspect-video max-h-[80vh] w-full items-center justify-center bg-black">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    );
  }

  // No direct streams → fall back to iframe providers.
  if (streams.length === 0) {
    return (
      <EmbedPlayer
        title={title}
        season={season}
        episode={episode}
        cinesrc={cinesrc}
        onProgress={onProgress}
        onNextEpisode={onNextEpisode}
      />
    );
  }

  const current = streams[Math.min(idx, streams.length - 1)];

  return (
    <div className="flex w-full flex-col bg-black">
      <div className="relative aspect-video max-h-[80vh] w-full">
        <DirectPlayer
          key={`${key}-${season}-${episode}-${idx}-${current.url}`}
          src={current.url}
          startTime={startTime}
          onProgress={onProgress}
          onFail={handleFail}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-neutral-950 px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Source</span>
        <select
          value={idx}
          onChange={(e) => setIdx(Number(e.target.value))}
          className="rounded bg-neutral-800 px-2 py-1 text-sm outline-none ring-1 ring-white/10"
        >
          {streams.map((s, i) => (
            <option key={i} value={i}>
              {label(s)}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-600">
          {streams.length} source{streams.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

export default StreamPlayer;
