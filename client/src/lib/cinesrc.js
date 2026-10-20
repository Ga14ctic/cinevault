export function buildCinesrcUrl(title, opts = {}) {
  const { cinesrc = {}, season, episode, startTime } = opts;
  if (!title?.tmdb_id) return null;
  const isTv = title.media_type === "tv";

  const params = new URLSearchParams();
  params.set("color", cinesrc.color || "#e50914");
  params.set("autoplay", String(cinesrc.autoplay !== false));
  params.set("autonext", String(cinesrc.autonext !== false));
  params.set("autoskip", String(cinesrc.autoskip === true));
  params.set("seek", String(cinesrc.seek ?? 10));
  if (cinesrc.quality) params.set("quality", cinesrc.quality);
  if (cinesrc.febboxToken) params.set("febbox", cinesrc.febboxToken);
  if (isTv) {
    params.set("s", String(season ?? 1));
    params.set("e", String(episode ?? 1));
  }
  if (startTime && startTime > 30) {
    params.set("t", String(Math.floor(startTime)));
    params.set("continueprompt", "false");
  }

  const path = isTv ? "tv" : "movie";
  return `https://cinesrc.st/embed/${path}/${title.tmdb_id}?${params.toString()}`;
}
