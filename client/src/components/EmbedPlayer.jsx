import { useEffect, useRef, useState, useCallback } from "react";
import { PROVIDERS, providerById } from "../lib/providers.js";

const CINESRC_ORIGIN = "https://cinesrc.st";
const DEFAULT_PROVIDER = "cinesrc";

export default function EmbedPlayer({ title, season, episode, cinesrc, onProgress, onNextEpisode }) {
  const [providerId, setProviderId] = useState(DEFAULT_PROVIDER);
  const [status, setStatus] = useState("loading");
  const [retryKey, setRetryKey] = useState(0);
  const lastSent = useRef(0);

  const mediaType = title?.media_type;
  const tmdbId = title?.tmdb_id;

  // Reset when the title/episode changes.
  useEffect(() => {
    setStatus("loading");
    setRetryKey((k) => k + 1);
  }, [tmdbId, mediaType, season, episode, providerId]);

  useEffect(() => {
    function handleMessage(event) {
      if (event.origin !== CINESRC_ORIGIN) return;
      const data = event.data;
      if (!data || typeof data.type !== "string") return;
      switch (data.type) {
        case "cinesrc:ready":
          setStatus("ready");
          break;
        case "cinesrc:play":
          setStatus("playing");
          break;
        case "cinesrc:timeupdate": {
          const now = Date.now();
          if (now - lastSent.current >= 10000 && data.duration > 0) {
            lastSent.current = now;
            onProgress?.({ currentTime: data.currentTime, duration: data.duration });
          }
          break;
        }
        case "cinesrc:ended":
          onProgress?.(null);
          break;
        case "cinesrc:nextepisode":
          if (!data.internalNavigation) {
            onNextEpisode?.({ season: data.season, episode: data.episode });
          }
          break;
        case "cinesrc:error":
          setStatus("error");
          break;
        default:
          break;
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onProgress, onNextEpisode]);

  // Fall back to the error overlay if a provider never reports readiness.
  useEffect(() => {
    if (status !== "loading") return;
    const t = setTimeout(() => setStatus((s) => (s === "loading" ? "slow" : s)), 12000);
    return () => clearTimeout(t);
  }, [status, retryKey]);

  const provider = providerById(providerId);
  const url = provider.buildUrl({ tmdbId, mediaType, season, episode, cinesrc });

  const retry = useCallback(() => {
    setStatus("loading");
    setRetryKey((k) => k + 1);
  }, []);

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center bg-black text-neutral-500">
        No playable source for this title.
      </div>
    );
  }

  const src = retryKey > 0 ? `${url}${url.includes("?") ? "&" : "?"}_r=${retryKey}` : url;

  return (
    <div className="flex w-full flex-col bg-black">
      <div className="relative aspect-video max-h-[80vh] w-full">
        <iframe
          key={`${providerId}-${retryKey}`}
          src={src}
          title={`Player (${provider.label})`}
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
        />
        {status === "loading" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          </div>
        )}
        {(status === "error" || status === "slow") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/95 text-center">
            <p className="text-lg text-neutral-200">
              {status === "error" ? "Stream unavailable" : "This server is slow"}
            </p>
            <p className="max-w-sm text-sm text-neutral-500">
              Try another server below, or retry.
            </p>
            <button
              onClick={retry}
              className="rounded bg-brand px-5 py-2 text-sm font-semibold hover:bg-brand-hover"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-neutral-950 px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">Server</span>
        {PROVIDERS.map((p) => {
          const active = p.id === providerId;
          return (
            <button
              key={p.id}
              onClick={() => setProviderId(p.id)}
              className={`rounded px-3 py-1 text-sm transition ${
                active
                  ? "bg-brand font-semibold text-white"
                  : "bg-white/10 text-neutral-300 hover:bg-white/20"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
