// Streaming embed providers. Each exposes buildUrl({ tmdbId, mediaType,
// season, episode, cinesrc, startTime }) -> string | null.
//
// Notes:
// - These are public iframe embeds keyed by TMDB id. They come and go, and
//   some challenge server-side fetches while working in a real browser, so the
//   UI always offers a switcher + retry rather than trusting one provider.
// - Only cinesrc posts playback events back to us (progress/next-episode), so
//   it stays first when available.

export const PROVIDERS = [
  {
    id: "cinesrc",
    label: "CineSrc",
    postMessage: true,
    buildUrl: ({ tmdbId, mediaType, season, episode, cinesrc = {}, startTime }) => {
      if (!tmdbId) return null;
      const params = new URLSearchParams();
      params.set("color", cinesrc.color || "#e50914");
      params.set("autoplay", String(cinesrc.autoplay !== false));
      params.set("autonext", String(cinesrc.autonext !== false));
      params.set("autoskip", String(cinesrc.autoskip === true));
      params.set("seek", String(cinesrc.seek ?? 10));
      if (cinesrc.quality) params.set("quality", cinesrc.quality);
      if (cinesrc.febboxToken) params.set("febbox", cinesrc.febboxToken);
      const isTv = mediaType === "tv";
      if (isTv) {
        params.set("s", String(season ?? 1));
        params.set("e", String(episode ?? 1));
      }
      if (startTime && startTime > 30) {
        params.set("t", String(Math.floor(startTime)));
        params.set("continueprompt", "false");
      }
      const path = isTv ? "tv" : "movie";
      return `https://cinesrc.st/embed/${path}/${tmdbId}?${params.toString()}`;
    },
  },
  {
    id: "vidlink",
    label: "VidLink",
    buildUrl: ({ tmdbId, mediaType, season, episode }) => {
      if (!tmdbId) return null;
      return mediaType === "tv"
        ? `https://vidlink.pro/tv/${tmdbId}/${season ?? 1}/${episode ?? 1}`
        : `https://vidlink.pro/movie/${tmdbId}`;
    },
  },
  // VidFast 403s iframe document navigations and 2Embed shows a "content is
  // blocked" notice when framed — both refuse embedding, so they're disabled.
  // Re-enable if they change.
  // {
  //   id: "vidfast",
  //   label: "VidFast",
  //   buildUrl: ({ tmdbId, mediaType, season, episode }) =>
  //     mediaType === "tv"
  //       ? `https://vidfast.pro/tv/${tmdbId}/${season ?? 1}/${episode ?? 1}`
  //       : `https://vidfast.pro/movie/${tmdbId}`,
  // },
  // {
  //   id: "2embed",
  //   label: "2Embed",
  //   buildUrl: ({ tmdbId, mediaType, season, episode }) =>
  //     mediaType === "tv"
  //       ? `https://2embed.cc/embedtv/${tmdbId}&s=${season ?? 1}&e=${episode ?? 1}`
  //       : `https://2embed.cc/embed/${tmdbId}`,
  // },
];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}
