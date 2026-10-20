import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import Navbar from "./components/Navbar.jsx";
import HomePage from "./pages/HomePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import SearchPage from "./pages/SearchPage.jsx";
import BrowsePage from "./pages/BrowsePage.jsx";
import TitlePage from "./pages/TitlePage.jsx";
import WatchPage from "./pages/WatchPage.jsx";

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <Protected>
            <div className="min-h-screen bg-black">
              <Navbar />
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/browse" element={<BrowsePage />} />
                <Route path="/title/:key" element={<TitlePage />} />
                <Route path="/watch/:key" element={<WatchPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </Protected>
        }
      />
    </Routes>
  );
}
