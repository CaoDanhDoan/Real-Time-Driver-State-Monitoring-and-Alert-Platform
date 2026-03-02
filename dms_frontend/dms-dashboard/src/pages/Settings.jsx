// src/pages/Settings.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSettings, updateSettings } from "../api";
import { faChevronDown } from "@fortawesome/free-solid-svg-icons";

// ✅ FontAwesome (UI only)
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSliders,
  faLock,
  faLockOpen,
  faHourglassHalf,
  faStopwatch,
  faVolumeHigh,
  faWrench,
  faTriangleExclamation,
  faMobileScreenButton,
  faPhone,
  faEye,
} from "@fortawesome/free-solid-svg-icons";

const DEFAULT_ALERT_SETTINGS = {
  enable_drowsy: true,
  enable_texting_phone: true,
  enable_talking_phone: true,
  enable_turning: true,

  detection_duration_sec: 3,

  detection_duration_drowsy_sec: 0,
  detection_duration_texting_phone_sec: 0,
  detection_duration_talking_phone_sec: 0,
  detection_duration_turning_sec: 0,


  cooldown_drowsy_sec: 10,
  cooldown_texting_phone_sec: 15,
  cooldown_talking_phone_sec: 15,
  cooldown_turning_sec: 5,

  buzzer_enabled: true,
  buzzer_cooldown_sec: 15,
};

const ADMIN_PASSWORD_HARDCODED = "admin";

export default function Settings() {
  const navigate = useNavigate();

  const [form, setForm] = useState(DEFAULT_ALERT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [unlocked, setUnlocked] = useState(false);
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const onAuthClose = () => {
    setAuthError("");
    setAuthPassword("");
    navigate(-1);
  };

  useEffect(() => {
    if (!unlocked) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const data = await fetchSettings();
        if (cancelled || !data) return;

        setForm((prev) => ({
          ...prev,
          enable_drowsy: data.enable_drowsy ?? DEFAULT_ALERT_SETTINGS.enable_drowsy,
          enable_texting_phone:
            data.enable_texting_phone ?? DEFAULT_ALERT_SETTINGS.enable_texting_phone,
          enable_talking_phone:
            data.enable_talking_phone ?? DEFAULT_ALERT_SETTINGS.enable_talking_phone,
          enable_turning: data.enable_turning ?? DEFAULT_ALERT_SETTINGS.enable_turning,

          detection_duration_sec:
            data.detection_duration_sec ?? DEFAULT_ALERT_SETTINGS.detection_duration_sec,

          detection_duration_drowsy_sec:
            data.detection_duration_drowsy_sec ??
            data.detection_duration_sec ??
            DEFAULT_ALERT_SETTINGS.detection_duration_drowsy_sec,
          detection_duration_texting_phone_sec:
            data.detection_duration_texting_phone_sec ??
            data.detection_duration_sec ??
            DEFAULT_ALERT_SETTINGS.detection_duration_texting_phone_sec,
          detection_duration_talking_phone_sec:
            data.detection_duration_talking_phone_sec ??
            data.detection_duration_sec ??
            DEFAULT_ALERT_SETTINGS.detection_duration_talking_phone_sec,
          detection_duration_turning_sec:
            data.detection_duration_turning_sec ??
            data.detection_duration_sec ??
            DEFAULT_ALERT_SETTINGS.detection_duration_turning_sec,

          cooldown_drowsy_sec: data.cooldown_drowsy_sec ?? DEFAULT_ALERT_SETTINGS.cooldown_drowsy_sec,
          cooldown_texting_phone_sec:
            data.cooldown_texting_phone_sec ?? DEFAULT_ALERT_SETTINGS.cooldown_texting_phone_sec,
          cooldown_talking_phone_sec:
            data.cooldown_talking_phone_sec ?? DEFAULT_ALERT_SETTINGS.cooldown_talking_phone_sec,
          cooldown_turning_sec:
            data.cooldown_turning_sec ?? DEFAULT_ALERT_SETTINGS.cooldown_turning_sec,

          buzzer_enabled: data.buzzer_enabled ?? DEFAULT_ALERT_SETTINGS.buzzer_enabled,
          buzzer_cooldown_sec: data.buzzer_cooldown_sec ?? DEFAULT_ALERT_SETTINGS.buzzer_cooldown_sec,
        }));
      } catch (err) {
        console.error("[Settings] load error", err);
        if (!cancelled) setMessage("Failed to load configuration from backend.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [unlocked]);

  const onBoolChange = (field) => (e) => {
    const checked = e.target.checked;
    setForm((prev) => ({ ...prev, [field]: checked }));
  };

  const onNumberChange = (field) => (e) => {
    const v = e.target.value;
    setForm((prev) => ({
      ...prev,
      [field]: v === "" ? "" : Number(v),
    }));
  };

  const buildPayload = (src) => ({
    enable_drowsy: !!src.enable_drowsy,
    enable_texting_phone: !!src.enable_texting_phone,
    enable_talking_phone: !!src.enable_talking_phone,
    enable_turning: !!src.enable_turning,

    detection_duration_sec:
      Number(src.detection_duration_sec) || DEFAULT_ALERT_SETTINGS.detection_duration_sec,

    detection_duration_drowsy_sec: Number(src.detection_duration_drowsy_sec) || 0,
    detection_duration_texting_phone_sec: Number(src.detection_duration_texting_phone_sec) || 0,
    detection_duration_talking_phone_sec: Number(src.detection_duration_talking_phone_sec) || 0,
    detection_duration_turning_sec: Number(src.detection_duration_turning_sec) || 0,

    cooldown_drowsy_sec: Number(src.cooldown_drowsy_sec) || DEFAULT_ALERT_SETTINGS.cooldown_drowsy_sec,
    cooldown_texting_phone_sec:
      Number(src.cooldown_texting_phone_sec) || DEFAULT_ALERT_SETTINGS.cooldown_texting_phone_sec,
    cooldown_talking_phone_sec:
      Number(src.cooldown_talking_phone_sec) || DEFAULT_ALERT_SETTINGS.cooldown_talking_phone_sec,
    cooldown_turning_sec:
      Number(src.cooldown_turning_sec) || DEFAULT_ALERT_SETTINGS.cooldown_turning_sec,

    buzzer_enabled: !!src.buzzer_enabled,
    buzzer_cooldown_sec:
      Number(src.buzzer_cooldown_sec) || DEFAULT_ALERT_SETTINGS.buzzer_cooldown_sec,

    admin_password: adminPassword || undefined,
  });

  const onAuthSubmit = (e) => {
    e.preventDefault();
    setAuthError("");
    setMessage("");

    if (authPassword === ADMIN_PASSWORD_HARDCODED) {
      setUnlocked(true);
      setAdminPassword(authPassword);
      setAuthError("");
    } else {
      setAuthError("The password you entered is incorrect.");
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const payload = buildPayload(form);
      await updateSettings(payload);
      setMessage("Alert configuration saved.");
    } catch (err) {
      console.error("[Settings] save error", err);
      setMessage("Failed to update settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const onResetDefaults = async () => {
    setSaving(true);
    setMessage("");

    try {
      setForm(DEFAULT_ALERT_SETTINGS);
      const payload = buildPayload(DEFAULT_ALERT_SETTINGS);
      await updateSettings(payload);
      setMessage("Default settings restored.");
    } catch (err) {
      console.error("[Settings] reset error", err);
      setMessage("Failed to reset settings.");
    } finally {
      setSaving(false);
    }
  };

  const quickRows = useMemo(
    () => [
      {
        key: "enable_drowsy",
        title: "Drowsy",
        desc: "Drowsy / Exhausted",
        icon: faTriangleExclamation,
      },
      {
        key: "enable_texting_phone",
        title: "Texting Phone",
        desc: "Texting while driving",
        icon: faMobileScreenButton,
      },
      {
        key: "enable_talking_phone",
        title: "Talking Phone",
        desc: "Talking on the phone",
        icon: faPhone,
      },
      {
        key: "enable_turning",
        title: "Turning",
        desc: "Looking away / Distraction",
        icon: faEye,
      },
    ],
    []
  );
  const hasCustomDuration = useMemo(() => {
  const global = Number(form.detection_duration_sec);

  return (
    (Number(form.detection_duration_drowsy_sec) > 0 &&
      Number(form.detection_duration_drowsy_sec) !== global) ||
    (Number(form.detection_duration_texting_phone_sec) > 0 &&
      Number(form.detection_duration_texting_phone_sec) !== global) ||
    (Number(form.detection_duration_talking_phone_sec) > 0 &&
      Number(form.detection_duration_talking_phone_sec) !== global) ||
    (Number(form.detection_duration_turning_sec) > 0 &&
      Number(form.detection_duration_turning_sec) !== global)
  );
}, [form]);

  if (!unlocked) {
    return (
      <div className="page">
        <header>
          <h1 className="page-title">Alert Settings</h1>
          <p className="page-subtitle">Please enter the password to unlock settings.</p>
        </header>

        {/*  modal overlay + blur  */}
        <div
          className="auth-modal-overlay auth-modal-overlay--sidebar-safe"
          onMouseDown={(e) => {
            // chỉ thoát khi click đúng backdrop
            if (e.target === e.currentTarget) onAuthClose();
          }}
        >
          <form
            onSubmit={onAuthSubmit}
            className="auth-wrap"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="card auth-card">
              <div className="card-title-row">
                <span className="card-icon">
                  <FontAwesomeIcon icon={faLock} />
                </span>
                <div className="card-title">Sign in as Administrator</div>
              </div>

              <div className="form-row">
                <input
                  className="input auth-input"
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Enter password"
                  autoFocus
                />
                <div className="hint">
                  After signing in, you can enable/disable alerts and adjust detection thresholds.
                </div>
              </div>

              {authError && <div className="auth-error">{authError}</div>}

              <div className="auth-actions">
                <button type="submit" className="btn-primary">
                  <span style={{ marginRight: 8 }}>
                    <FontAwesomeIcon icon={faLockOpen} />
                  </span>
                  Unlock Settings
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header>
        <h1 className="page-title">Alert Settings</h1>
        <p className="page-subtitle">
          Quick configuration of alert states. For detailed parameter adjustments, please use Advanced Settings.
        </p>
      </header>

      <form onSubmit={onSubmit}>
        {/* QUICK SETTINGS */}
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-title-row">
            <span className="card-icon">
              <FontAwesomeIcon icon={faSliders} />
            </span>
            <div className="card-title">Quick Settings</div>
          </div>

          <div className="quick-alert-list">
            {quickRows.map((r) => (
              <QuickToggle
                key={r.key}
                title={r.title}
                desc={r.desc}
                checked={!!form[r.key]}
                onChange={onBoolChange(r.key)}
                icon={<FontAwesomeIcon icon={r.icon} />} //  per-class icon
              />
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <label className="label">
              <span style={{ marginRight: 8 }}>
                <FontAwesomeIcon icon={faHourglassHalf} />
              </span>
              Default Detection Duration (seconds)
            </label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.detection_duration_sec}
              onChange={onNumberChange("detection_duration_sec")}
            />

            {hasCustomDuration && (
              <div className="hint" style={{ color: "#d97706", marginTop: 6 }}>
                ⚠️ Some alerts are using custom detection duration.
              </div>
            )}

            <div className="hint">
              Default detection duration for all behaviors (if Advanced is not set).
            </div>
          </div>
        </div>

        {/* BUZZER */}
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-title-row">
            <span className="card-icon">
              <FontAwesomeIcon icon={faVolumeHigh} />
            </span>
            <div className="card-title">Buzzer Alert</div>
          </div>

          <div className="form-grid-2">
           <div className="quick-toggle">
            <div className="quick-toggle__left">
              <div className="quick-label">
                <span className="quick-icon">
                  <FontAwesomeIcon icon={faVolumeHigh} />
                </span>
                Buzzer
              </div>
              <div className="quick-desc">
                Enable or disable buzzer alert sound
              </div>
            </div>

            <label className="switch">
              <input
                type="checkbox"
                checked={form.buzzer_enabled}
                onChange={onBoolChange("buzzer_enabled")}
              />
              <span className="switch-slider" />
            </label>
          </div>
            <div className="form-row">
              <label className="label">
                <span style={{ marginRight: 8 }}>
                  <FontAwesomeIcon icon={faStopwatch} />
                </span>
                Buzzer cooldown (seconds)
              </label>
              <input
                className="input"
                type="number"
                min={0}
                value={form.buzzer_cooldown_sec}
                onChange={onNumberChange("buzzer_cooldown_sec")}
                disabled={!form.buzzer_enabled}
                style={{
                  opacity: form.buzzer_enabled ? 1 : 0.5,
                  cursor: form.buzzer_enabled ? "text" : "not-allowed",
                }}
              />
              <div className="hint">
              {form.buzzer_enabled
                ? "Example: 15 seconds: in 15 seconds, buzzer will only buzz once."
                : "Buzzer is disabled."}
            </div>
            </div>
          </div>
        </div>

        {/* ADVANCED */}
        <details className="card settings-advanced" style={{ marginTop: 18 }}>
      <summary className="settings-advanced__summary">
        <div className="settings-advanced__left">
          <FontAwesomeIcon icon={faWrench} />
          <span>Advanced Alert Tuning</span>
          <span className="settings-advanced__hint">
            (Individual behavior settings)
          </span>
        </div>

        <FontAwesomeIcon icon={faChevronDown} className="advanced-chevron" />
      </summary>

          <div className="form-grid-2" style={{ marginTop: 14 }}>
            <AdvancedBlock
              title="Drowsy"
              detect={form.detection_duration_drowsy_sec}
              global={form.detection_duration_sec} 
              cooldown={form.cooldown_drowsy_sec}
              onDetect={onNumberChange("detection_duration_drowsy_sec")}
              onCooldown={onNumberChange("cooldown_drowsy_sec")}
            />
            <AdvancedBlock
              title="Texting Phone"
              detect={form.detection_duration_texting_phone_sec}
              global={form.detection_duration_sec} 
              cooldown={form.cooldown_texting_phone_sec}
              onDetect={onNumberChange("detection_duration_texting_phone_sec")}
              onCooldown={onNumberChange("cooldown_texting_phone_sec")}
            />
            <AdvancedBlock
              title="Talking Phone"
              detect={form.detection_duration_talking_phone_sec}
              global={form.detection_duration_sec} 
              cooldown={form.cooldown_talking_phone_sec}
              onDetect={onNumberChange("detection_duration_talking_phone_sec")}
              onCooldown={onNumberChange("cooldown_talking_phone_sec")}
            />
            <AdvancedBlock
              title="Turning"
              detect={form.detection_duration_turning_sec}
              global={form.detection_duration_sec} 
              cooldown={form.cooldown_turning_sec}
              onDetect={onNumberChange("detection_duration_turning_sec")}
              onCooldown={onNumberChange("cooldown_turning_sec")}
            />
          </div>

          <div className="hint" style={{ marginTop: 10 }}>
            Detection: Using default unless overridden. | Cooldown: Min 1s to prevent audio spam.
          </div>
        </details>

        {/* ACTION BAR */}
        <div className="settings-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving..." : "Save Settings"}
          </button>

          <button type="button" className="btn-secondary" onClick={onResetDefaults} disabled={saving}>
            Reset
          </button>

          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {loading && <span className="page-subtitle">Loading…</span>}
            {message && <span className="page-subtitle">{message}</span>}
          </div>
        </div>
      </form>
    </div>
  );
}

/* ===== UI helpers ===== */

function QuickToggle({ title, desc, checked, onChange, icon }) {
  return (
    <div className="quick-toggle">
      <div className="quick-toggle__left">
        <div className="quick-label">
          {icon ? <span className="quick-icon">{icon}</span> : null}
          {title}
        </div>
        <div className="quick-desc">{desc}</div>
      </div>

      {/*  toggle switch  */}
      <label className="switch">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="switch-slider" />
      </label>
    </div>
  );
}

function AdvancedBlock({ title, detect, global, cooldown, onDetect, onCooldown }) {
  const displayDetect = detect === 0 ? global : detect;

  return (
    <div className="advanced-block">
      <div className="advanced-title">{title}</div>

      <div className="form-row">
        <label className="label">
          Detection (sec)
          {detect === 0 && (
            <span style={{ marginLeft: 6, fontSize: 12, color: "#6b7280" }}>
              (Using default: {global}s)
            </span>
          )}
        </label>

        <input
          className="input"
          type="number"
          min={1}
          value={displayDetect}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v === global) {
              onDetect({ target: { value: 0 } });
            } else {
              onDetect(e);
            }
          }}
        />
      </div>

      <div className="form-row" style={{ marginTop: 10 }}>
        <label className="label">Cooldown (sec)</label>
        <input
          className="input"
          type="number"
          min={1}
          value={cooldown}
          onChange={onCooldown}
        />
        <div className="hint">Time to wait before re-alerting.</div>
      </div>
    </div>
  );
}
