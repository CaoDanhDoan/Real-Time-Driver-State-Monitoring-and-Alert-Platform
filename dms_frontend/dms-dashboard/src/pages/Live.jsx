// src/pages/Live.jsx
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fetchLatestAlert, fetchAlertsHistory } from "../api";

// FontAwesome for Timeline (Option A)
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMobileScreenButton,
  faPhone,
  faEye,
  faCircleCheck,
  faListUl,
  faCamera,
  faBolt,
  faChartLine,
  faArrowRight, 
} from "@fortawesome/free-solid-svg-icons";

const CLASS_LABELS = {
  drowsy: "Drowsy",
  awake: "Awake",
  texting_phone: "Texting Phone",
  talking_phone: "Talking Phone",
  turning: "Turning",
};

function formatDateTimeVN(raw) {
  if (!raw) return "--";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleString("vi-VN", { hour12: false });
}

function formatTimeVN(raw) {
  if (!raw) return "--";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return raw;
  return dt.toLocaleTimeString("vi-VN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getClassMeta(cls) {
  switch (cls) {
    case "drowsy":
      return { tone: "danger", icon: faEye };

    case "texting_phone":
      return { tone: "warning", icon: faMobileScreenButton };

    case "talking_phone":
      return { tone: "warning2", icon: faPhone };

    case "turning":
      return { tone: "accent", icon: faArrowRight }; //\

    case "awake":
      return { tone: "ok", icon: faCircleCheck };

    default:
      return { tone: "neutral", icon: faListUl };
  }
}

function getWsUrl(pathname) {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${pathname}`;
}

function getHttpUrl(pathname) {
  return `${window.location.origin}${pathname}`;
}

function clamp01(x) {
  const v = Number(x);
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function Sparkline({ values }) {
  const pts = (values || [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  if (!pts.length) return <div className="card-subtitle">--</div>;

  const w = 160;
  const h = 36;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const den = max - min || 1;

  const step = pts.length > 1 ? w / (pts.length - 1) : w;

  const d = pts
    .map((v, i) => {
      const x = Math.round(i * step);
      const y = Math.round(h - clamp01((v - min) / den) * h);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="sparkline">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        points={d}
        opacity="0.9"
      />
    </svg>
  );
}

export default function Live() {
  const [latest, setLatest] = useState(null);
  const [timeline, setTimeline] = useState([]);

  //  live state (RAM-only) from backend
  const [liveState, setLiveState] = useState(null);

  // Timeline sizing: đo chiều cao cột trái để timeline cao đúng bằng nó
  const leftColRef = useRef(null);
  const [timelineMaxH, setTimelineMaxH] = useState(null);

  // =========================
  // 1) INITIAL LOAD (fallback)
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadInitial() {
      try {
        const [latestRes, historyRes] = await Promise.all([
          fetchLatestAlert(),
          fetchAlertsHistory(20),
        ]);
        if (cancelled) return;
        setLatest(latestRes || null);
        setTimeline(historyRes || []);
      } catch (err) {
        console.error("[Live] initial load error", err);
      }
    }

    loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  // =========================================
  // 2) LIVE STATE (1s polling)
  // =========================================
  useEffect(() => {
    let cancelled = false;

    async function loadLiveState() {
      try {
        const res = await fetch(getHttpUrl("/api/live/state"), { cache: "no-store" });
        const data = await res.json();
        if (cancelled) return;
        setLiveState(data || null);
      } catch {
        // im lặng để demo không bị spam lỗi
      }
    }

    loadLiveState();
    const t = setInterval(loadLiveState, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // ====================================
  // 3) TIMELINE REALTIME via WebSocket
  // ====================================
  useEffect(() => {
    let ws;
    let closed = false;

    function connect() {
      try {
        ws = new WebSocket(getWsUrl("/ws/timeline"));

        ws.onopen = () => {};

        ws.onmessage = (ev) => {
          try {
            const obj = JSON.parse(ev.data);

            setTimeline((prev) => {
              const arr = Array.isArray(prev) ? prev.slice() : [];
              const id = obj?.id;

              // de-dup theo id
              if (id != null && arr.some((x) => x?.id === id)) return arr;

              arr.unshift(obj);

              // giữ timeline tối đa 30 record để UI nhẹ
              if (arr.length > 30) arr.length = 30;
              return arr;
            });

            // update "latest" cho details
            setLatest(obj || null);
          } catch {
            // ignore parse errors
          }
        };

        ws.onclose = () => {
          if (closed) return;
          setTimeout(connect, 1200);
        };

        ws.onerror = () => {
          try {
            ws?.close();
          } catch {}
        };
      } catch {
        setTimeout(connect, 1500);
      }
    }

    connect();
    return () => {
      closed = true;
      try {
        ws?.close();
      } catch {}
    };
  }, []);

  // ✅ auto update height khi layout thay đổi
  useLayoutEffect(() => {
    const leftEl = leftColRef.current;
    if (!leftEl) return;

    const apply = () => {
      const h = Math.round(leftEl.getBoundingClientRect().height || 0);
      if (h > 0) setTimelineMaxH(h);
    };

    apply();

    const ro = new ResizeObserver(() => apply());
    ro.observe(leftEl);

    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  const mjpegUrl = useMemo(() => {
    const fps = 15;
    const ts = Date.now(); 
    return `${getHttpUrl("/api/live/mjpeg")}?fps=${fps}&t=${encodeURIComponent(ts)}`;
  }, []);

  // ===============================
  // Details vẫn dựa trên alert latest (Mongo alert stream)
  // ===============================
  const primaryAlert = useMemo(() => {
    if (latest) return latest;
    const sorted = (timeline || [])
      .slice()
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    return sorted[0] || null;
  }, [latest, timeline]);

  const alertClass = CLASS_LABELS[primaryAlert?.class] || primaryAlert?.class || "--";
  const alertTimeFull = formatDateTimeVN(primaryAlert?.created_at || primaryAlert?.created_dt);
  const alertSpeed =
    primaryAlert?.speed != null && Number(primaryAlert.speed) > 0
      ? `${Math.round(Number(primaryAlert.speed))} km/h`
      : "--";
  const alertId = primaryAlert?.id ?? "--";
  const alertScore = typeof primaryAlert?.score === "number" ? primaryAlert.score.toFixed(2) : null;
  const alertMessage = primaryAlert?.message || "No alert content available";

  const timelineRows = useMemo(() => {
    return (timeline || [])
      .slice()
      .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
      .slice(0, 15);
  }, [timeline]);

  const newestId = timelineRows?.[0]?.id ?? null;

  // ===============================
  // Driver State indicator (big)
  // ===============================
  const driverState = useMemo(() => {
    const s = String(liveState?.state || "").toUpperCase();
    if (s) return s;
    const cls = primaryAlert?.class;
    if (cls === "drowsy") return "DROWSY";
    if (cls === "turning") return "TURNING";
    if (cls === "texting_phone" || cls === "talking_phone") return "PHONE";
    if (cls === "awake") return "AWAKE";
    return "UNKNOWN";
  }, [liveState, primaryAlert]);

  const stateTone = useMemo(() => {
    switch (driverState) {
      case "DROWSY":
        return "danger";
      case "PHONE":
        return "warning";
      case "TURNING":
        return "accent";
      case "AWAKE":
        return "ok";
      default:
        return "neutral";
    }
  }, [driverState]);

  const drowsy60s = liveState?.drowsy_60s ?? "--";
  const alertsPerMin = liveState?.alerts_per_min ?? "--";
  const sparkValues = liveState?.spark || [];

  //  pulse / scan nhẹ 
  const heroFxClass = useMemo(() => {
    switch (driverState) {
      case "DROWSY":
        return "live-hero--danger fx-pulse";
      case "PHONE":
        return "live-hero--warning fx-pulse";
      case "TURNING":
        return "live-hero--accent fx-scan";
      case "AWAKE":
        return "live-hero--ok";
      default:
        return "live-hero--neutral";
    }
  }, [driverState]);

  return (
    <div className="page">
      <header>
        <h1 className="page-title">Live Monitoring</h1>
        <p className="page-subtitle">Real-time stream of latest images and alerts.</p>
      </header>

      <div className="live-layout live-layout--pro">
        {/* LEFT: HERO */}
        <div ref={leftColRef}>
          <div className={`card live-hero ${heroFxClass}`}>
            <div className="live-hero-head">
              <div>
                <div className="card-title">
                  <span style={{ marginRight: 8 }}>
                    <FontAwesomeIcon icon={faCamera} />
                  </span>
                  LIVE CAMERA FEED
                </div>

                {/* ✅ Driver state indicator BIG */}
                <div
                  className={`live-state live-state--${stateTone}`}
                  data-state={driverState}
                  style={{
                    marginTop: 10,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderRadius: 16,
                    border: "1px solid rgba(31,41,55,0.9)",
                    background: "rgba(2,6,23,0.55)",
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    fontSize: 18,
                  }}
                >
                  <FontAwesomeIcon icon={faBolt} />
                  {driverState}
                </div>

                <div className="live-hero-sub" style={{ marginTop: 8 }}>
                  <span className="badge">Class</span> {alertClass}
                  {alertScore ? (
                    <span style={{ marginLeft: 10 }}>
                      <span className="badge">Score</span> {alertScore}
                    </span>
                  ) : null}
                </div>
              </div>

              {/* rolling stats mini */}
              <div style={{ textAlign: "right" }}>
                <div
                  className="badge"
                  style={{ display: "inline-flex", gap: 8, alignItems: "center" }}
                >
                  <FontAwesomeIcon icon={faChartLine} />
                  Realtime
                </div>

                <div style={{ marginTop: 10, display: "grid", gap: 8, justifyItems: "end" }}>
                  <div className="live-hero-chip">
                    <span className="badge">Drowsy in 60s</span> {drowsy60s}
                  </div>
                  <div className="live-hero-chip">
                    <span className="badge">Alerts/min</span>{" "}
                    {typeof alertsPerMin === "number" ? alertsPerMin.toFixed(1) : alertsPerMin}
                  </div>
                  <div
                    className="live-hero-chip"
                    style={{ display: "flex", alignItems: "center", gap: 10 }}
                  >
                    <span className="badge">Trend</span>
                    <span style={{ color: "#e5e7eb" }}>
                      <Sparkline values={sparkValues} />
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="live-hero-media">
              {/* ✅ MJPEG stream */}
              <LiveMjpegWithFallback
                src={mjpegUrl}
                meta={{
                  alertTimeFull,
                  alertSpeed,
                  alertId,
                }}
              />
            </div>
          </div>

          {/* DETAILS */}
          <div className="grid grid-2" style={{ marginTop: 20 }}>
            <div className="card">
              <div className="card-title">Alert Details</div>

              <div className="live-kv">
                <div className="live-kv-row">
                  <span className="live-kv-k">Class</span>
                  <span className="live-kv-v">{alertClass}</span>
                </div>
                <div className="live-kv-row">
                  <span className="live-kv-k">Time</span>
                  <span className="live-kv-v">{alertTimeFull}</span>
                </div>
                <div className="live-kv-row">
                  <span className="live-kv-k">Speed</span>
                  <span className="live-kv-v">{alertSpeed}</span>
                </div>
                <div className="live-kv-row">
                  <span className="live-kv-k">ID</span>
                  <span className="live-kv-v">{alertId}</span>
                </div>
                {alertScore ? (
                  <div className="live-kv-row">
                    <span className="live-kv-k">Score</span>
                    <span className="live-kv-v">{alertScore}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-title">Message</div>
              <div className="live-message">{alertMessage}</div>
            </div>
          </div>
        </div>

        {/* RIGHT: TIMELINE (Option A) */}
        <div
          className="card timeline-card"
          style={timelineMaxH ? { height: timelineMaxH } : undefined}
        >
          <div className="card-title tl-head">
            <span style={{ marginRight: 8 }}>
              <FontAwesomeIcon icon={faListUl} />
            </span>
            Activity Timeline
          </div>

          <ul className="timeline-list">
            {timelineRows.map((a) => {
              const label = CLASS_LABELS[a.class] || a.class || "--";
              const raw = a.created_at || a.created_dt;
              const timeStr = formatTimeVN(raw);
              const isNewest = newestId != null && a.id === newestId;

              const meta = getClassMeta(a.class);
              const scoreStr = typeof a.score === "number" ? a.score.toFixed(2) : null;

              return (
                <li
                  className={`timeline-item tl-item tl-item--${meta.tone} ${
                    isNewest ? "timeline-item--newest tl-item--newest" : ""
                  }`}
                  key={a._id ?? a.id}
                >
                  <span className={`tl-chip tl-chip--${meta.tone}`} aria-hidden="true">
                    <FontAwesomeIcon icon={meta.icon} />
                  </span>

                  <div className="tl-body" style={{ minWidth: 0 }}>
                    <div className="tl-top">
                      <span className={`tl-class tl-class--${meta.tone}`}>{label}</span>
                      {scoreStr ? <span className="tl-score">{scoreStr}</span> : null}
                    </div>

                    <div className="timeline-text-sub tl-msg">{a.message || "Alert"}</div>
                  </div>

                  <div className="timeline-time tl-time">{timeStr}</div>
                </li>
              );
            })}

            {timelineRows.length === 0 && (
              <li className="timeline-item tl-item tl-item--neutral">
                <div className="timeline-text-sub">No recent activity.</div>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function LiveMjpegWithFallback({ src, meta }) {
  const [ok, setOk] = useState(true);

  useEffect(() => {
    setOk(true);
  }, [src]);

  return ok ? (
    <>
      <a href={src} target="_blank" rel="noopener noreferrer" className="live-hero-media-link">
        <img
          src={src}
          alt="live mjpeg stream"
          onError={() => setOk(false)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </a>

      {/* Overlay info */}
      <div className="live-hero-overlay">
        <div className="live-hero-chip">
          <span className="badge">Time</span> {meta?.alertTimeFull || "--"}
        </div>
        <div className="live-hero-chip">
          <span className="badge">Speed</span> {meta?.alertSpeed || "--"}
        </div>
        <div className="live-hero-chip">
          <span className="badge">ID</span> {meta?.alertId || "--"}
        </div>
      </div>
    </>
  ) : (
    <div className="live-hero-empty">
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No stream available</div>
      <div className="page-subtitle">
        Backend is not serving <b>/api/live/mjpeg</b> or the source is not feeding frames.
      </div>
      <div className="page-subtitle" style={{ marginTop: 8 }}>
        Try opening URL: <b>{src}</b>
      </div>
    </div>
  );
}
