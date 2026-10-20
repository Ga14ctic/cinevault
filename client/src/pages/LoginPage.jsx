import { useState } from "react";
import { useLocation, useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginPage() {
  const { user, login, loading } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "/";

  if (loading) return null;
  if (user) return <Navigate to={from} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-black via-neutral-950 to-black px-4">
      <div className="w-full max-w-sm rounded-lg bg-black/70 p-8 ring-1 ring-white/10">
        <h1 className="mb-6 text-3xl font-bold text-brand">CineVault</h1>
        <form onSubmit={submit} className="space-y-4">
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            className="w-full rounded bg-neutral-800 px-4 py-3 text-white outline-none ring-1 ring-white/10 focus:ring-white/40"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="w-full rounded bg-neutral-800 px-4 py-3 text-white outline-none ring-1 ring-white/10 focus:ring-white/40"
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            disabled={busy || !username || !password}
            className="w-full rounded bg-brand py-3 font-semibold transition hover:bg-brand-hover disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <p className="mt-6 text-xs text-neutral-500">
          Accounts are created by the household admin. Ask them to set you up.
        </p>
      </div>
    </div>
  );
}
