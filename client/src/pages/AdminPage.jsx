import { useEffect, useState, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

const TABS = ["Users", "Settings", "Status"];

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function CapsSelect({ value, onChange, ratings }) {
  return (
    <div className="flex gap-2">
      <select
        value={value.movie}
        onChange={(e) => onChange({ ...value, movie: e.target.value })}
        className="rounded bg-neutral-800 px-2 py-1 text-sm ring-1 ring-white/10"
        title="Movie rating ceiling"
      >
        {ratings.movie.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <select
        value={value.tv}
        onChange={(e) => onChange({ ...value, tv: e.target.value })}
        className="rounded bg-neutral-800 px-2 py-1 text-sm ring-1 ring-white/10"
        title="TV rating ceiling"
      >
        {ratings.tv.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </div>
  );
}

function UsersTab({ ratings, refreshKey, onChanged }) {
  const { user: me } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", movie: "PG-13", tv: "TV-14" });

  const load = useCallback(() => {
    setError(null);
    api
      .adminUsers()
      .then((d) => setUsers(d.users))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.adminCreateUser({
        username: form.username,
        password: form.password,
        caps: { movie: form.movie, tv: form.tv },
      });
      setForm({ username: "", password: "", movie: "PG-13", tv: "TV-14" });
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id, body) => {
    setError(null);
    try {
      await api.adminUpdateUser(id, body);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (u) => {
    if (!confirm(`Delete user "${u.username}"? Their progress and sessions are removed.`)) return;
    setError(null);
    try {
      await api.adminDeleteUser(u.id);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    }
  };

  const revoke = async (u) => {
    setError(null);
    try {
      await api.adminRevokeSessions(u.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-8">
      <form onSubmit={create} className="rounded-lg bg-neutral-900/60 p-4 ring-1 ring-white/10">
        <h3 className="mb-3 font-semibold">Add user</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Username">
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="alex"
              className="rounded bg-neutral-800 px-3 py-1.5 text-sm ring-1 ring-white/10 focus:ring-white/40"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="min 8 chars"
              className="rounded bg-neutral-800 px-3 py-1.5 text-sm ring-1 ring-white/10 focus:ring-white/40"
            />
          </Field>
          <Field label="Caps (movie / tv)">
            <CapsSelect value={form} onChange={setForm} ratings={ratings} />
          </Field>
          <button
            disabled={busy || !form.username || form.password.length < 8}
            className="rounded bg-brand px-4 py-1.5 text-sm font-semibold hover:bg-brand-hover disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add user"}
          </button>
        </div>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-lg ring-1 ring-white/10">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-400">
            <tr>
              <th className="px-4 py-2">User</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Caps</th>
              <th className="px-4 py-2">Sessions</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {!users && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                  Loading…
                </td>
              </tr>
            )}
            {users?.map((u) => {
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id} className="border-t border-white/5">
                  <td className="px-4 py-2 font-medium">
                    {u.username}
                    {isSelf && <span className="ml-2 text-xs text-neutral-500">(you)</span>}
                  </td>
                  <td className="px-4 py-2 text-neutral-300">{u.role}</td>
                  <td className="px-4 py-2">
                    {u.role === "root" ? (
                      <span className="text-neutral-500">unrestricted</span>
                    ) : (
                      <CapsSelect value={u.caps} onChange={(caps) => patch(u.id, { caps })} ratings={ratings} />
                    )}
                  </td>
                  <td className="px-4 py-2 text-neutral-300">{u.sessions}</td>
                  <td className="px-4 py-2">
                    <span className={u.active ? "text-green-400" : "text-red-400"}>
                      {u.active ? "active" : "disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      {!isSelf && (
                        <button
                          onClick={() => patch(u.id, { active: !u.active })}
                          className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                        >
                          {u.active ? "Disable" : "Enable"}
                        </button>
                      )}
                      <button
                        onClick={() => revoke(u)}
                        className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                      >
                        Revoke sessions
                      </button>
                      {!isSelf && u.role !== "root" && (
                        <button
                          onClick={() => remove(u)}
                          className="rounded bg-red-900/60 px-2 py-1 text-xs hover:bg-red-800"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsTab({ onChanged }) {
  const [prefs, setPrefs] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .adminPrefs()
      .then((d) => setPrefs(d.prefs))
      .catch((e) => setError(e.message));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.adminSavePrefs({
        siteName: prefs.siteName,
        accentColor: prefs.accentColor,
        uploadMaxGb: Number(prefs.uploadMaxGb),
      });
      setSaved(true);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!prefs) return <p className="text-neutral-500">Loading…</p>;

  return (
    <form onSubmit={save} className="max-w-lg space-y-4 rounded-lg bg-neutral-900/60 p-4 ring-1 ring-white/10">
      <Field label="Site name">
        <input
          value={prefs.siteName}
          onChange={(e) => setPrefs({ ...prefs, siteName: e.target.value })}
          className="w-full rounded bg-neutral-800 px-3 py-1.5 text-sm ring-1 ring-white/10 focus:ring-white/40"
        />
      </Field>
      <Field label="Accent color">
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={prefs.accentColor}
            onChange={(e) => setPrefs({ ...prefs, accentColor: e.target.value })}
            className="h-8 w-12 rounded bg-neutral-800 ring-1 ring-white/10"
          />
          <input
            value={prefs.accentColor}
            onChange={(e) => setPrefs({ ...prefs, accentColor: e.target.value })}
            className="w-28 rounded bg-neutral-800 px-3 py-1.5 text-sm ring-1 ring-white/10 focus:ring-white/40"
          />
        </div>
      </Field>
      <Field label="Max upload size (GB)">
        <input
          type="number"
          min={1}
          max={2048}
          value={prefs.uploadMaxGb}
          onChange={(e) => setPrefs({ ...prefs, uploadMaxGb: e.target.value })}
          className="w-28 rounded bg-neutral-800 px-3 py-1.5 text-sm ring-1 ring-white/10 focus:ring-white/40"
        />
      </Field>
      <Field label="TMDB key">
        <span className={`text-sm ${prefs.tmdbKeySet ? "text-green-400" : "text-red-400"}`}>
          {prefs.tmdbKeySet ? "configured (via environment)" : "not configured"}
        </span>
      </Field>
      <div className="flex items-center gap-3">
        <button
          disabled={busy}
          className="rounded bg-brand px-4 py-1.5 text-sm font-semibold hover:bg-brand-hover disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-sm text-green-400">Saved</span>}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>
    </form>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-neutral-900/60 p-4 ring-1 ring-white/10">
      <div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

function StatusTab({ refreshKey }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setError(null);
    api
      .adminStatus()
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, [refreshKey]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!status) return <p className="text-neutral-500">Loading…</p>;

  const gb = (status.disk.usedBytes / 1024 ** 3).toFixed(2);
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <StatCard label="Titles" value={status.titles.toLocaleString()} sub={`${status.movies} movies · ${status.tv} TV`} />
      <StatCard label="Users" value={status.users} />
      <StatCard label="Uploads" value={status.local} sub="local files" />
      <StatCard label="Progress records" value={status.progressRecords.toLocaleString()} />
      <StatCard label="Media disk" value={`${gb} GB`} sub={`${status.disk.files} files`} />
      <StatCard label="Uptime" value={`${Math.floor(status.uptime / 60)}m`} sub={`${status.uptime}s`} />
    </div>
  );
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState("Users");
  const [ratings, setRatings] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (user?.role !== "root") return;
    api
      .adminUsers()
      .then((d) => setRatings(d.ratings))
      .catch(() => {});
  }, [user]);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "root") return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <h1 className="mb-6 text-2xl font-bold">Admin</h1>
      <div className="mb-6 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-3 py-1.5 text-sm ${
              tab === t ? "bg-white/15 text-white" : "text-neutral-400 hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Users" && ratings && (
        <UsersTab ratings={ratings} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />
      )}
      {tab === "Settings" && <SettingsTab onChanged={() => setRefreshKey((k) => k + 1)} />}
      {tab === "Status" && <StatusTab refreshKey={refreshKey} />}
    </div>
  );
}
