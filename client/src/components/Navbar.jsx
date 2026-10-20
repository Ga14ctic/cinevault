import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Navbar({ onSearch }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-40 flex items-center gap-4 bg-gradient-to-b from-black via-black/90 to-transparent px-4 py-3 sm:px-8">
      <Link to="/" className="text-xl font-bold tracking-tight text-brand">
        CineVault
      </Link>
      <nav className="hidden items-center gap-4 text-sm text-neutral-300 sm:flex">
        <Link to="/" className="hover:text-white">
          Home
        </Link>
        <Link to="/browse?type=movie" className="hover:text-white">
          Movies
        </Link>
        <Link to="/browse?type=tv" className="hover:text-white">
          TV Shows
        </Link>
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = e.currentTarget.elements.q.value.trim();
            if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
          }}
        >
          <input
            name="q"
            placeholder="Search"
            onChange={(e) => onSearch?.(e.target.value)}
            className="w-28 rounded border border-white/20 bg-black/60 px-3 py-1.5 text-sm outline-none transition focus:w-48 focus:border-white/50 sm:w-40"
          />
        </form>
        {user ? (
          <div className="flex items-center gap-3">
            {user.role === "root" && (
              <Link to="/admin" className="text-sm text-neutral-300 hover:text-white">
                Admin
              </Link>
            )}
            <span className="hidden text-sm text-neutral-400 sm:inline">{user.username}</span>
            <button
              onClick={handleLogout}
              className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
            >
              Sign out
            </button>
          </div>
        ) : (
          <Link to="/login" className="rounded bg-brand px-3 py-1.5 text-sm font-semibold hover:bg-brand-hover">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
