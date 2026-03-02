import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import AlertsHistory from "./pages/AlertsHistory";
import Live from "./pages/Live";
import Settings from "./pages/Settings";

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => (document.body.style.overflow = "");
  }, [drawerOpen]);

  return (
    <div className="app-root">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile topbar */}
      <header className="topbar">
        <button
          className="topbar-btn"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          ☰
        </button>

        <div className="topbar-title">
          <div className="topbar-main">Driver Monitoring</div>
          <div className="topbar-sub">DMS Control Panel</div>
        </div>
      </header>

      {/* Drawer */}
      <div
        className={`drawer-overlay ${drawerOpen ? "open" : ""}`}
        onClick={() => setDrawerOpen(false)}
      />
      <aside className={`drawer ${drawerOpen ? "open" : ""}`}>
        <div className="drawer-head">
          <button
            className="drawer-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <Sidebar className="sidebar--drawer" onNavigate={() => setDrawerOpen(false)} />
      </aside>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/alerts" element={<AlertsHistory />} />
          <Route path="/live" element={<Live />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
