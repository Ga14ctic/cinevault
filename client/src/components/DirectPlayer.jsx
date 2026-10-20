import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

const BAD = /unsupported|not supported|cannot|invalid|manifest|network/i;

function isHls(url) {
  return /\.m3u8(\?|$)/i.test(url);
}

// Plays a direct stream URL (HLS via hls.js, or native mp4/mkv/etc).
// onProgress mirrors the other players: { currentTime, duration } every ~10s
// and null on end. onFail lets the parent advance to the next source.
export default function DirectPlayer({ src, startTime = 0, onProgress, onFail }) {
  const videoRef = useRef(null);
  const lastSent = useRef(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !src) return;
    setError(null);
    lastSent.current = 0;

    let hls;
    const seekOnce = () => {
      if (startTime > 30 && el.duration && startTime < el.duration - 10) {
        try {
          el.currentTime = startTime;
        } catch {
          /* ignore */
        }
      }
    };

    if (isHls(src) && Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, capLevelToPlayerSize: true });
      hls.loadSource(src);
      hls.attachMedia(el);
      hls.on(Hls.Events.MANIFEST_PARSED, seekOnce);
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // one recovery attempt, then fail over
            if (!hls._retried) {
              hls._retried = true;
              hls.startLoad();
              return;
            }
          }
          setError("This source failed to play.");
          onFail?.();
        }
      });
    } else {
      el.src = src;
      el.addEventListener("loadedmetadata", seekOnce, { once: true });
    }

    const emit = (force) => {
      if (!el.duration || !isFinite(el.duration)) return;
      const now = Date.now();
      if (!force && now - lastSent.current < 10000) return;
      lastSent.current = now;
      onProgress?.({ currentTime: el.currentTime, duration: el.duration });
    };
    const onTime = () => emit(false);
    const onPause = () => emit(true);
    const onError = () => {
      setError("This source can't be played in your browser.");
      onFail?.();
    };

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
      if (hls) hls.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <div className="relative h-full w-full bg-black">
      <video
        ref={videoRef}
        controls
        playsInline
        className="h-full w-full bg-black"
        onEnded={() => onProgress?.(null)}
      />
      {error && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/70 px-3 py-1.5 text-center text-sm text-neutral-300">
          {error} Trying another source…
        </div>
      )}
    </div>
  );
}
