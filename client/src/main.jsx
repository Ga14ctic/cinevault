import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black text-white">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">CineVault</h1>
        <p className="mt-2 text-neutral-400">Phase 1 skeleton — API is live.</p>
        <a
          href="/api/health"
          className="mt-4 inline-block rounded bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500"
        >
          Check health
        </a>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
