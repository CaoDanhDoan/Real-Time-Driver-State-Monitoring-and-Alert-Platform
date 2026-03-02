// src/pages/Dashboard.jsx
import { useEffect, useMemo, useState, memo } from "react";

import StatCard from "../components/StatCard";
import SystemStatusCard from "../components/SystemStatusCard";
import {
  fetchDashboardOverview,
  fetchMonthlyStats,
  fetchDailyStats,
  fetchSystemStatus,
} from "../api";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

// ✅ FontAwesome
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTriangleExclamation,
  faMobileScreenButton,
  faEye,
  faServer,
  faBell,
  faGauge,
  faClock,
  faChartArea,
} from "@fortawesome/free-solid-svg-icons";

const EMPTY_STATUS = {
  esp32: false,
  rtsp: false,
  backend: false,
};

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [dailyDrowsy, setDailyDrowsy] = useState([]);
  const [dailyPhone, setDailyPhone] = useState([]);
  const [monthlyDrowsy, setMonthlyDrowsy] = useState([]);
  const [monthlyPhone, setMonthlyPhone] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [
          overviewRes,
          statusRes,
          dailyDrowsyRes,
          dailyPhoneRes,
          monthlyDrowsyRes,
          monthlyPhoneRes,
        ] = await Promise.all([
          fetchDashboardOverview(),
          fetchSystemStatus(),
          fetchDailyStats("drowsy", 7),
          fetchDailyStats("phone", 7),
          fetchMonthlyStats("drowsy"),
          fetchMonthlyStats("phone"),
        ]);

        if (cancelled) return;

        setOverview(overviewRes || null);
        setSystemStatus(statusRes || EMPTY_STATUS);
        setDailyDrowsy(dailyDrowsyRes || []);
        setDailyPhone(dailyPhoneRes || []);
        setMonthlyDrowsy(monthlyDrowsyRes || []);
        setMonthlyPhone(monthlyPhoneRes || []);
      } catch (err) {
        console.error("[Dashboard] load error", err);
        if (!cancelled) {
          setError("Failed to load dashboard data. Please check your network connection.");
        }
      }
    }

    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const totalAlertsText = useMemo(() => {
    if (!overview) return "--";
    return new Intl.NumberFormat("en-US").format(overview.total ?? 0);
  }, [overview]);

  // const avgSpeedText = useMemo(() => {
  //   if (!overview || overview.avg_speed == null) return "--";
  //   return `${overview.avg_speed.toFixed(1)} km/h (Average)`;
  // }, [overview]);
   const avgSpeedText = useMemo(() => {
    return "NaN"; 
  }, []);

  const timeText = useMemo(() => {
    if (!overview || !overview.last_alert) return "--";
    return overview.last_alert;
  }, [overview]);

  // ===== DAILY =====
  const formatDailyData = (items, maxDays = 7) => {
    const mapped =
      (items || []).map((d) => {
        const raw = d.date;
        let label = raw || "";

        if (raw && raw.length === 10) {
          const parts = raw.split("-");
          label = `${parts[2]}/${parts[1]}`;
        } else if (raw && raw.length === 5) {
          const parts = raw.split("-");
          label = `${parts[1]}/${parts[0]}`;
        }

        return {
          label,
          count: Number(d.count ?? 0),
        };
      }) || [];

    if (mapped.length > maxDays) return mapped.slice(mapped.length - maxDays);
    return mapped;
  };

  const formatMonthlyData = (items) =>
    (items || []).map((d) => ({
      label: d.month ?? "",
      count: Number(d.count ?? 0),
    }));

  const dailyDrowsyData = useMemo(() => formatDailyData(dailyDrowsy, 7), [dailyDrowsy]);
  const dailyPhoneData = useMemo(() => formatDailyData(dailyPhone, 7), [dailyPhone]);
  const monthlyDrowsyData = useMemo(() => formatMonthlyData(monthlyDrowsy), [monthlyDrowsy]);
  const monthlyPhoneData = useMemo(() => formatMonthlyData(monthlyPhone), [monthlyPhone]);

  return (
    <div className="page">
      <header>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          Driver Status Overview & Alert Frequency.
        </p>
      </header>

      {error && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-title">Error</div>
          <div className="card-subtitle">{error}</div>
        </div>
      )}

      <div className="grid grid-4">
        <StatCard
          title="Drowsy"
          value={overview?.drowsy ?? 0}
          subtitle="Total drowsy events"
          accent="danger"
          icon={<FontAwesomeIcon icon={faTriangleExclamation} />}
        />
        <StatCard
          title="Phone"
          value={overview?.phone ?? 0}
          subtitle="Texting / Calling"
          accent="warning"
          icon={<FontAwesomeIcon icon={faMobileScreenButton} />}
        />
        <StatCard
          title="Turning"
          value={overview?.turning ?? 0}
          subtitle="Total turning events"
          accent="accent"
          icon={<FontAwesomeIcon icon={faEye} />}
        />
        <SystemStatusCard
          status={systemStatus || EMPTY_STATUS}
          icon={<FontAwesomeIcon icon={faServer} />}
        />
      </div>

      <div className="grid grid-3">
        <StatCard
          title="Total Alerts"
          value={totalAlertsText}
          subtitle="All alert events"
          icon={<FontAwesomeIcon icon={faBell} />}
        />
        <StatCard title="Avg Speed" value={avgSpeedText} icon={<FontAwesomeIcon icon={faGauge} />} />
        <StatCard title="Time" value={timeText} icon={<FontAwesomeIcon icon={faClock} />} />
      </div>

      <div className="grid grid-2">
        <ChartCard
          title="Drowsy Events by Day"
          data={dailyDrowsyData}
          variant="drowsy"
          mode="daily"
          icon={<FontAwesomeIcon icon={faChartArea} />}
        />
        <ChartCard
          title="Phone Events by Day"
          data={dailyPhoneData}
          variant="phone"
          mode="daily"
          icon={<FontAwesomeIcon icon={faChartArea} />}
        />
      </div>

      <div className="grid grid-2">
        <ChartCard
          title="Drowsy Events by Month"
          data={monthlyDrowsyData}
          variant="drowsy"
          mode="monthly"
          icon={<FontAwesomeIcon icon={faChartArea} />}
        />
        <ChartCard
          title="Phone Events by Month"
          data={monthlyPhoneData}
          variant="phone"
          mode="monthly"
          icon={<FontAwesomeIcon icon={faChartArea} />}
        />
      </div>
    </div>
  );
}

/* ================= CHART CARD (Option A: Area) ================= */

const ChartCard = memo(function ChartCard({ title, data, variant, mode, icon }) {
  const isDaily = mode === "daily";

  const Y_MAX = isDaily ? 30 : 200;
  const ticks = isDaily ? [0, 10, 20, 30] : [0, 50, 100, 150, 200];

  const strokeColor = variant === "drowsy" ? "#fb7185" : "#fbbf24";
  const fillColor =
    variant === "drowsy"
      ? "rgba(251,113,133,0.18)"
      : "rgba(251,191,36,0.18)";

  const chartData = useMemo(() => {
    return (data || []).map((d) => ({
      ...d,
      displayCount: Math.min(d.count, Y_MAX),
    }));
  }, [data, Y_MAX]);

  const hasData = chartData.some((d) => d.count > 0);

  const delta = useMemo(() => {
    if (!chartData || chartData.length < 2) return 0;
    return (chartData.at(-1)?.count ?? 0) - (chartData.at(-2)?.count ?? 0);
  }, [chartData]);

  return (
    <div className="card chart-card">
      <div className="card-title-row">
        {icon ? <span className="card-icon">{icon}</span> : null}
        <div className="card-title">{title}</div>
      </div>

      <div className="card-subtitle" style={{ marginTop: 2 }}>
        {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : "• 0"} vs. Previous Period
      </div>

      <div className="chart-box chart-box--area">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 0, left: -5, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="4 6"
                stroke="rgba(148,163,184,0.14)"
                vertical={false}
              />

              <XAxis
                dataKey="label"
                interval="preserveEnd"
                padding={{ left: 0, right: 0 }}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={{ stroke: "rgba(31,41,55,0.9)" }}
                tickLine={false}
              />


             <YAxis
                width={30} 
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={{ stroke: "rgba(31,41,55,0.9)" }}
                tickLine={false}
                allowDecimals={false}
                domain={[0, Y_MAX]}
                ticks={ticks}
              />

              <Tooltip
                cursor={{ stroke: "rgba(251,191,36,0.35)", strokeWidth: 1 }}
                contentStyle={{
                  background: "rgba(2,6,23,0.92)",
                  border: "1px solid rgba(31,41,55,0.9)",
                  fontSize: 12,
                  borderRadius: 12,
                  boxShadow: "0 18px 40px rgba(0,0,0,0.55)",
                }}
                formatter={(value, name, props) => [props.payload.count, "count"]}
              />

              <Area
                type="monotone"
                dataKey="displayCount"
                stroke={strokeColor}
                strokeWidth={2}
                fill={fillColor}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={false} 
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <span className="card-subtitle">No records found for this time period</span>
        )}
      </div>
    </div>
  );
});
