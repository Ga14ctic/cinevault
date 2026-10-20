import { useEffect, useRef, useState, useCallback } from "react";

const ORIGIN = "https://cinesrc.st";

export default function CinesrcPlayer({ url, onProgress, onNextEpisode }) {
  const iframeRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [retryKey, setRetryKey] = useState(0);
  const lastSent = useRef(0);

  useEffect(() => {
    function handleMessage(event) {
      if (event.origin !== ORIGIN) return;
      const data = event.data;
      if (!data || typeof data.type !== "string") return;

      switch (data.type) {
        case "cinesrc:ready":
          setStatus("ready");
          break;
        case "cinesrc:play":
          setStatus("playing");
          break;
        case "cinesrc:loadedmetadata":
          break;
        case "cinesrc:timeupdate": {
          const now = Date.now();
          if (now - lastSent.current >= 10000 && data.duration > 0) {
            lastSent.current = now;
            onProgress?.({
              currentTime: data.currentTime,
              duration: data.duration,
            });
          }
          break;
        }
        case "cinesrc:pause":
          onProgress?.({ force: true, last: true });
          break;
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

  const retry = useCallback(() => {
    setStatus("loading");
    setRetryKey((k) => k + 1);
  }, []);

  if (!url) return null;

  // Cache-bust on retry so the iframe fully remounts
  const src = retryKey > 0 ? `${url}&_r=${retryKey}` : url;

  return (
    <div className="relative h-full w-full bg-black">
      <iframe
        key={retryKey}
        ref={iframeRef}
        src={src}
        title="Player"
        className="h-full w-full border-0"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
      />
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/95 text-center">
          <p className="text-lg text-neutral-200">Stream unavailable</p>
          <p className="max-w-sm text-sm text-neutral-500">
            No working source responded for this title right now.
          </p>
          <button
            onClick={retry}
            className="rounded bg-brand px-6 py-2 font-semibold hover:bg-brand-hover"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
