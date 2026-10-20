const JSON_HEADERS = { "Content-Type": "application/json" };

async function request(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const message = data?.error?.message || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

export const api = {
  me: () => request("/api/auth/me"),
  login: (username, password) =>
    request("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ username, password }) }),
  logout: () => request("/api/auth/logout", { method: "POST" }),
  rows: () => request("/api/rows"),
  library: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    return request(`/api/library${qs ? `?${qs}` : ""}`);
  },
  title: (key) => request(`/api/titles/${encodeURIComponent(key)}`),
  genres: () => request("/api/genres"),
};

export function posterUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `/images${path}`;
}

export function backdropUrl(path) {
  return posterUrl(path);
}
