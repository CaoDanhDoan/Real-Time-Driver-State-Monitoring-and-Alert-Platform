// src/components/StatCard.jsx
export default function StatCard({
  title,
  value,
  subtitle,
  accent = "normal",
  icon = null,
}) {
  let extraStyle = {};

  if (accent === "danger") {
    extraStyle = {
      background:
        "radial-gradient(circle at 0% 0%, rgba(239,68,68,0.18) 0, transparent 55%)," +
        "linear-gradient(135deg,#020617,#020617 30%,#111827 70%,#020617)",
      borderColor: "rgba(248,113,113,0.28)",
    };
  } else if (accent === "accent") {
    extraStyle = {
      background:
        "radial-gradient(circle at 0% 0%, rgba(56,189,248,0.25) 0, transparent 60%)," +
        "linear-gradient(135deg,#020617,#020617 25%,#0f172a 70%,#020617)",
      borderColor: "rgba(56,189,248,0.25)",
    };
  } else if (accent === "warning") {
    extraStyle = {
      background:
        "radial-gradient(circle at 0% 0%, rgba(251,191,36,0.20) 0, transparent 60%)," +
        "linear-gradient(135deg,#020617,#020617 25%,#0f172a 70%,#020617)",
      borderColor: "rgba(251,191,36,0.25)",
    };
  }

  return (
    <div className="card" style={extraStyle}>
      <div className="card-title-row">
        {icon ? <span className="card-icon">{icon}</span> : null}
        <div className="card-title">{title}</div>
      </div>

      <div className="card-value">{value ?? "--"}</div>
      {subtitle && <div className="card-subtitle">{subtitle}</div>}
    </div>
  );
}
