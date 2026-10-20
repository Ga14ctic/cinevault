import { useEffect, useRef, useState } from "react";

export default function LocalPlayer({ src, kind = "video", onProgress }) {
  const ref = useRef(null);
  const [error, setError] = useState(null);
  const lastSent = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const emit = (force) => {
      if (!el.duration || !isFinite(el.duration)) return;
      const now = Date.now();
      if (!force && now - lastSent.current < 10000) return;
      lastSent.current = now;
      onProgress?.({ currentTime: el.currentTime, duration: el.duration });
    };
    const onTime = () => emit(false);
    const onPause = () => emit(true);
    const onError = () =>
      setError("This file can't be played in your browser (unsupported codec).");

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onPause);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("error", onError);
    };
  }, [onProgress]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-black text-center">
        <p className="text-lg text-neutral-200">{error}</p>
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-black">
        <div className="text-6xl">♪</div>
        <audio ref={ref} src={src} controls className="w-80" />
      </div>
    );
  }

  return (
    <video
      ref={ref}
      src={src}
      controls
      playsInline
      className="h-full w-full bg-black"
      onEnded={() => onProgress?.(null)}
    />
  );
}
