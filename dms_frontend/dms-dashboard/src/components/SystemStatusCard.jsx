// src/components/SystemStatusCard.jsx
export default function SystemStatusCard({ status, icon = null }) {
  const safe = status || {};

  return (
    <div className="card">
      <div className="card-title-row">
        {icon ? <span className="card-icon">{icon}</span> : null}
        <div className="card-title">System Status</div>
      </div>

      <ul className="status-list">
        <StatusItem label="ESP32 Node" ok={safe.esp32} />
        <StatusItem label="RTSP Stream" ok={safe.rtsp} />
        <StatusItem label="Backend API" ok={safe.backend} />
      </ul>
    </div>
  );
}

function StatusItem({ label, ok }) {
  return (
    <li>
      <span className={`status-dot ${ok ? "on" : "off"}`} />
      <span className="status-label">{label}</span>
    </li>
  );
}
