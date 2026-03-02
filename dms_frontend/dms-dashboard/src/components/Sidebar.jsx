import { NavLink } from "react-router-dom";

// ✅ NEW: FontAwesome
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faGaugeHigh,
  faClockRotateLeft,
  faSliders,
  faVideo,
} from "@fortawesome/free-solid-svg-icons";

const navItems = [
  { label: "Dashboard", to: "/dashboard", icon: faGaugeHigh },
  { label: "Alerts History", to: "/alerts", icon: faClockRotateLeft },
  { label: "Settings", to: "/settings", icon: faSliders },
  { label: "Live", to: "/live", icon: faVideo },
];

export default function Sidebar({ className = "", onNavigate }) {
  return (
    <aside className={`sidebar ${className}`}>
      <div>
        <div className="sidebar-title">Driver Monitoring</div>
        <div className="sidebar-subtitle">DMS Control Panel</div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                "sidebar-link " + (isActive ? "sidebar-link-active" : "")
              }
            >
              {/* ✅ NEW: icon */}
              <span className="sidebar-link__icon">
                <FontAwesomeIcon icon={item.icon} />
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="sidebar-subtitle" style={{ marginTop: "auto" }}>
        DMS DANH-CAO
      </div>
    </aside>
  );
}
