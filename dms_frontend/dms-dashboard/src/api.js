// src/api.js

export const BACKEND_BASE =
  import.meta.env.VITE_BACKEND_URL ||
  window.location.origin;

export function resolveMediaUrl(url) {
  if (!url) return "";

  // absolute URL
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (u.pathname.startsWith("/snapshots/")) {
        return `${BACKEND_BASE}${u.pathname}`;
      }

      if (window.location.protocol === "https:" && u.protocol === "http:") {
        const b = new URL(BACKEND_BASE);
        if (u.host === b.host) {
          return `https://${u.host}${u.pathname}${u.search}`;
        }
      }
    } catch {}
    return url;
  }

  if (url.startsWith("/")) return `${BACKEND_BASE}${url}`;
  return `${BACKEND_BASE}/${url.replace(/^\/+/, "")}`;
}

async function getJSON(path) {
  const res = await fetch(`${BACKEND_BASE}${path}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

/* ========= DASHBOARD ========= */
export function fetchDashboardOverview() { return getJSON("/api/dashboard/overview"); }
export function fetchSystemStatus() { return getJSON("/api/system/status"); }
export function fetchMonthlyStats(cls, months = 6) {
  return getJSON(`/api/stats/monthly?cls=${encodeURIComponent(cls)}&months=${months}`);
}
export function fetchDailyStats(cls, days = 14) {
  return getJSON(`/api/stats/daily?cls=${encodeURIComponent(cls)}&days=${days}`);
}

/* ========= ALERTS ========= */
export function fetchAlertsHistory(limit = 200) {
  return getJSON(`/api/alerts/history?limit=${limit}`);
}
export function fetchLatestAlert() { return getJSON("/api/alerts/latest"); }

/* ========= SETTINGS ========= */
export function fetchSettings() { return getJSON("/api/settings"); }
export async function updateSettings(payload) {
  const res = await fetch(`${BACKEND_BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}
