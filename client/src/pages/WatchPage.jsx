import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, backdropUrl } from "../api.js";
import { useConfig } from "../context/ConfigContext.jsx";
import { buildCinesrcUrl } from "../lib/cinesrc.js";
import CinesrcPlayer from "../components/CinesrcPlayer.jsx";
import LocalPlayer from "../components/LocalPlayer.jsx";

export default function WatchPage() {
  const { key } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { cinesrc } = useConfig();

  const season = Number(params.get("s") || 1);
  const episode = Number(params.get("e") || 1);

  const [title, setTitle] = useState(null);
  const [error, setError] = useState(null);
  const [seasons, setSeasons] = useState(null);
  const [episodes, setEpisodes] = useState(null);
  const [startTime, setStartTime] = useState(0);
  const startLoaded = useRef(false);

  useEffect(() => {
    let alive = true;
    startLoaded.current = false;
    api
      .title(key)
      .then((d) => alive && setTitle(d.title))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [key]);

  // Load resume position once per key
  useEffect(() => {
    if (!title || startLoaded.current) return;
    startLoaded.current = true;
    const isTv = title.media_type === "tv";
    api
      .progressItem(key, isTv ? season : undefined, isTv ? episode : undefined)
      .then((d) => {
        if (d?.progress?.seconds) setStartTime(d.progress.seconds);
      })
      .catch(() => {});
  }, [title, key, season, episode]);

  // TV season/episode metadata
  useEffect(() => {
    if (!title || title.media_type !== "tv") return;
    let alive = true;
    api.tvEpisodes(key).then((d) => alive && setSeasons(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [title, key]);

  useEffect(() => {
    if (!title || title.media_type !== "tv") return;
    let alive = true;
    setEpisodes(null);
    api.tvSeason(key, season).then((d) => alive && setEpisodes(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [title, key, season]);

  const playerUrl = useMemo(() => {
    if (!title || title.local || title.media_type === "tv") return null;
    return buildCinesrcUrl(title, { cinesrc, startTime });
  }, [title, cinesrc, startTime]);

  const tvUrl = useMemo(() => {
    if (!title || title.local || title.media_type !== "tv") return null;
    return buildCinesrcUrl(title, { cinesrc, season, episode, startTime });
  }, [title, cinesrc, season, episode, startTime]);

  const handleProgress = async (data) => {
    if (!title || !data) return;
    try {
      await api.saveProgress({
        titleKey: title.key,
        season: title.media_type === "tv" ? season : null,
        episode: title.media_type === "tv" ? episode : null,
        seconds: data.currentTime,
        duration: data.duration,
      });
    } catch {
      /* progress endpoint may not exist yet */
    }
  };

  const goToEpisode = (s, e) => {
    setStartTime(0);
    startLoaded.current = false;
    setParams({ s: String(s), e: String(e) });
  };

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black text-center">
        <p className="text-neutral-300">{error}</p>
        <Link to="/" className="text-brand hover:underline">
          ← Back to home
        </Link>
      </div>
    );
  }

  if (!title) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-neutral-500">
        Loading…
      </div>
    );
  }

  const isLocalAudio = title.local?.kind === "audio";

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <div className="flex items-center gap-4 px-4 py-3 sm:px-8">
        <Link
          to={`/title/${encodeURIComponent(key)}`}
          className="text-sm text-neutral-300 hover:text-white"
        >
          ← Back
        </Link>
        <h1 className="truncate text-sm text-neutral-400">
          {title.title}
          {title.media_type === "tv" && ` · S${season}E${episode}`}
        </h1>
      </div>

      <div className="relative aspect-video w-full max-h-[80vh] shrink-0 bg-black">
        {title.local ? (
          <LocalPlayer
            src={title.local.url}
            kind={isLocalAudio ? "audio" : "video"}
            onProgress={handleProgress}
          />
        ) : title.media_type === "tv" ? (
          tvUrl && <CinesrcPlayer url={tvUrl} onProgress={handleProgress} />
        ) : (
          playerUrl && <CinesrcPlayer url={playerUrl} onProgress={handleProgress} />
        )}
      </div>

      {title.media_type === "tv" && (
        <EpisodeSelector
          seasons={seasons}
          episodes={episodes}
          season={season}
          episode={episode}
          onSelect={goToEpisode}
          backdrop={title.backdrop_path}
        />
      )}
    </div>
  );
}

function EpisodeSelector({ seasons, episodes, season, episode, onSelect }) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8">
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm text-neutral-400">Season</label>
        <select
          value={season}
          onChange={(e) => onSelect(Number(e.target.value), 1)}
          className="rounded bg-neutral-800 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
        >
          {(seasons?.seasons || [{ number: season, name: `Season ${season}` }]).map((s) => (
            <option key={s.number} value={s.number}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {!episodes && <p className="text-sm text-neutral-500">Loading episodes…</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        {(episodes?.episodes || []).map((e) => (
          <button
            key={e.number}
            onClick={() => onSelect(season, e.number)}
            className={`flex items-start gap-3 rounded-lg p-3 text-left transition ${
              e.number === episode ? "bg-white/15 ring-1 ring-white/30" : "bg-white/5 hover:bg-white/10"
            }`}
          >
            <span className="mt-0.5 w-6 shrink-0 text-sm font-semibold text-neutral-400">
              {e.number}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{e.name}</span>
              {e.overview && (
                <span className="mt-1 line-clamp-2 block text-xs text-neutral-500">{e.overview}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
