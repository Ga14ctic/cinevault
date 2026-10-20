import { MOVIE_RATINGS, TV_RATINGS } from "./auth.js";

const CAP_UNRATED = true;

function rank(list, value) {
  const i = list.indexOf(value);
  return i === -1 ? -1 : i;
}

export function ratingAllowed(title, caps) {
  if (!caps) return true;
  if (!title || title.rating == null || title.rating === "") return CAP_UNRATED;
  const list = title.media_type === "tv" ? TV_RATINGS : MOVIE_RATINGS;
  const capList = title.media_type === "tv" ? TV_RATINGS : MOVIE_RATINGS;
  const cap = caps[title.media_type === "tv" ? "tv" : "movie"];
  const titleRank = rank(list, title.rating);
  const capRank = rank(capList, cap);
  if (titleRank === -1) return CAP_UNRATED;
  if (capRank === -1) return false;
  return titleRank <= capRank;
}

export function capsFilterFor(user) {
  if (!user || user.role === "root") return {};
  const caps = user.caps;

  const allowedStrings = [];
  allowedStrings.push(null, "");

  const movieCapRank = rank(MOVIE_RATINGS, caps?.movie);
  for (let i = 0; i <= movieCapRank; i++) allowedStrings.push(MOVIE_RATINGS[i]);

  const tvCapRank = rank(TV_RATINGS, caps?.tv);
  for (let i = 0; i <= tvCapRank; i++) allowedStrings.push(TV_RATINGS[i]);

  return {
    $or: [
      { rating: { $in: allowedStrings } },
      { rating: { $exists: false } },
      { rating: null },
    ],
  };
}

export function mergeFilter(base, capsFilter) {
  if (!capsFilter || Object.keys(capsFilter).length === 0) return base || {};
  if (!base || Object.keys(base).length === 0) return capsFilter;
  return { $and: [base, capsFilter] };
}
