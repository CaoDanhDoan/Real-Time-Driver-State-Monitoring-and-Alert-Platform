// src/pages/AlertsHistory.jsx
import { useEffect, useMemo, useState } from "react";
import { fetchAlertsHistory, resolveMediaUrl } from "../api";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMagnifyingGlass,
  faFilter,
  faTriangleExclamation,
  faCircleInfo,
  faMobileScreenButton,
  faImage,
} from "@fortawesome/free-solid-svg-icons";

const CLASS_LABELS = {
  drowsy: "Drowsy",
  awake: "Awake",
  texting_phone: "Texting / Calling",
  talking_phone: "Talking / Calling",
  phone: "Phone",
  turning: "Turning",
};

const SEVERITY = {
  drowsy: "critical",
  texting_phone: "warning",
  talking_phone: "warning",
  turning: "info",
};

// ✅ NEW: severity icon mapping
const SEVERITY_ICON = {
  critical: faTriangleExclamation,
  warning: faMobileScreenButton,
  info: faCircleInfo,
};

export default function AlertsHistory() {
  const [alerts, setAlerts] = useState([]);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await fetchAlertsHistory(200);
        if (!cancelled) setAlerts(data || []);
      } catch (err) {
        console.error("[AlertsHistory] load error", err);
      }
    }

    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();

    const matchesClass = (a) => {
      if (classFilter === "all") return true;
      if (classFilter === "drowsy") return a.class === "drowsy";
      if (classFilter === "turning") return a.class === "turning";

      // Texting / Talking => gom 2 class lại
      if (classFilter === "phone") {
        return a.class === "texting_phone" || a.class === "talking_phone";
      }

      return true;
    };

    return (alerts || [])
      .filter((a) => {
        if (!matchesClass(a)) return false;
        if (!q) return true;

        return (
          String(a.id ?? "").includes(q) ||
          (a.class || "").toLowerCase().includes(q) ||
          (a.message || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  }, [alerts, search, classFilter]);

  const formatTime = (a) => {
    const raw = a.created_at || a.created_dt;
    if (!raw) return "--";
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return raw;
    return dt.toLocaleString("vi-VN", { hour12: false });
  };

  const formatSpeed = (v) => {
    if (v == null || v <= 0) return "--";
    return `${Math.round(v)} km/h`;
  };

  const getSeverity = (cls) => SEVERITY[cls] || "info";

  return (
    <div className="page">
      <header>
        <h1 className="page-title">Alerts History</h1>
        <p className="page-subtitle">Driver status alert logs</p>
      </header>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-title-row">
          <span className="card-icon">
            <FontAwesomeIcon icon={faFilter} />
          </span>
          <div className="card-title">Alerts</div>
        </div>

        {/* Toolbar */}
        <div className="alerts-toolbar">
          <div className="input-icon">
            <span className="input-icon__left">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
            </span>
            <input
              className="input input--with-icon"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 260 }}
            />
          </div>

          <div className="alerts-toolbar-spacer" />

          <div className="select-icon">
            <span className="select-icon__left">
              <FontAwesomeIcon icon={faFilter} />
            </span>
            <select
              className="select select--with-icon"
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            >
              <option value="all">All classes</option>
              <option value="drowsy">Drowsy</option>
              <option value="phone">Texting / Talking</option>
              <option value="turning">Turning</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th style={{ width: 110 }}>Severity</th>
                <th style={{ width: 140 }}>Class</th>
                <th style={{ width: 170 }}>Time</th>
                <th>Message</th>
                <th style={{ width: 90 }}>Speed</th>
                <th style={{ width: 110 }}>
                  <span className="th-icon">
                    <FontAwesomeIcon icon={faImage} />
                  </span>{" "}
                  Snapshot
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((a) => {
                const sev = getSeverity(a.class);
                const icon = SEVERITY_ICON[sev] || faCircleInfo;

                return (
                  <tr key={a._id ?? a.id}>
                    <td>{a.id ?? "--"}</td>

                    {/*  severity badge */}
                    <td>
                      <span className={`severity severity-${sev}`}>
                        <span className="severity__icon">
                          <FontAwesomeIcon icon={icon} />
                        </span>
                        {sev}
                      </span>
                    </td>

                    <td>{CLASS_LABELS[a.class] || a.class || "--"}</td>
                    <td>{formatTime(a)}</td>

                    {/* ✅ NEW: ellipsis + title full */}
                    <td>
                      <span className="message-preview" title={a.message || ""}>
                        {a.message || "--"}
                      </span>
                    </td>

                    <td>{formatSpeed(a.speed)}</td>

                    <td>
                      {a.snapshot_url ? (
                        (() => {
                          const snap = resolveMediaUrl(a.snapshot_url);
                          return (
                            <a href={snap} target="_blank" rel="noopener noreferrer">
                              <img
                                src={snap}
                                alt="snapshot"
                                className="snapshot-thumb"
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            </a>
                          );
                        })()
                      ) : (
                        <span className="page-subtitle">No image</span>
                      )}
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 16 }}>
                    <span className="page-subtitle">No alert logs.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ✅ small hint */}
        <div className="hint" style={{ marginTop: 10 }}>
          Click to view full image.
        </div>
      </div>
    </div>
  );
}
