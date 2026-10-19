
import {
  BACKEND_URL, TELEMETRY_POLL_MS, TELEMETRY_TIMEOUT_MS,
  LOG_TELEMETRY_EVERY_MS, DEPTH_WARN_M,
} from "./config.js";
import { appendLog } from "./logger.js";
import { recordTrajPoint, setWaiting, setOffline } from "./trajectory.js";
import { pushCsvRow } from "./recorder.js";
import { getActiveCameraCount } from "./camera.js";
import { $ } from "./util.js";

const el = {
  depth:      $("telDepth"),
  depthCard:  $("depthCard"),
  roll:       $("telRoll"),
  pitch:      $("telPitch"),
  yaw:        $("telYaw"),
  qrCard:     $("qrCard"),
  qrTarget:   $("qrTarget"),
  qrSource:   $("qrSource"),
  qrStatus:   $("qrStatus"),
  qrTime:     $("qrTime"),
  specCamera:   $("specCamera"),
  specGripper:  $("specGripper"),
  specThruster: $("specThruster"),
  sysStatus:  $("sysStatus"),
  brandDot:   $("brandDot"),
  brandText:  $("brandStatus"),
};

const pwmEls = {};
document.querySelectorAll("[data-pwm]").forEach((b) => {
  pwmEls[`PWM${b.dataset.pwm}`] = b;
});

let offline = false;
let lastTelemetryLog = 0;
let depthAlarmArmed = false;
let depthAlarmActive = false;
let lastSystemState = "";

const SYSTEM_VIEW = {
  connecting: { badge: "CONNECTING",  cls: "amber-badge", dot: "warn",    text: "CONNECTING TO BACKEND…" },
  ok:         { badge: "OPERATIONAL", cls: "green-badge", dot: "ok",      text: "GCS SYSTEM ONLINE" },
  nolink:     { badge: "NO PIXHAWK",  cls: "amber-badge", dot: "warn",    text: "BACKEND ONLINE · NO PIXHAWK" },
  offline:    { badge: "OFFLINE",     cls: "red-badge",   dot: "offline", text: "BACKEND OFFLINE" },
};

function setSystemState(kind) {
  if (kind === lastSystemState) return;
  lastSystemState = kind;
  const v = SYSTEM_VIEW[kind];
  if (el.sysStatus) {
    el.sysStatus.textContent = v.badge;
    el.sysStatus.className = `badge ${v.cls}`;
  }
  if (el.brandDot)  el.brandDot.dataset.state = v.dot;
  if (el.brandText) el.brandText.textContent = v.text;
}

function setSpec(node, text, state) {
  if (!node) return;
  node.textContent = text;
  node.dataset.state = state;   
}

export function setDepthAlarmArmed(armed) {
  depthAlarmArmed = armed;
  if (!armed) {
    depthAlarmActive = false;
    el.depthCard?.classList.remove("alarm");
  }
}

function updateDepthAlarm(depth) {
  const active = depthAlarmArmed && depth >= DEPTH_WARN_M;
  el.depthCard?.classList.toggle("alarm", active);
  if (active && !depthAlarmActive) {
    appendLog(`⚠ KEDALAMAN ${depth.toFixed(2)} m melewati batas ${DEPTH_WARN_M} m`, "warn");
  }
  depthAlarmActive = active;
}

function updatePwm(pwm) {
  if (!pwm) return;
  for (const [label, node] of Object.entries(pwmEls)) {
    const v = pwm[label];
    if (v != null) node.textContent = Math.round(v);
  }
}

function updateQr(qr) {
  if (!qr || !el.qrCard) return;
  const valid = !!qr.valid;
  el.qrCard.dataset.state = valid ? "valid" : "idle";
  if (el.qrTarget) el.qrTarget.textContent = qr.target_id || "-";
  if (el.qrTime)   el.qrTime.textContent   = qr.time || "--:--:--";
  if (el.qrSource) {
    el.qrSource.textContent = qr.camera_id != null ? `CAM ${Number(qr.camera_id) + 1}` : "--";
  }
  if (el.qrStatus) {
    el.qrStatus.innerHTML = valid
      ? `<i class="fa-solid fa-circle-check"></i> VALID`
      : `<i class="fa-solid fa-circle-xmark"></i> NOT FOUND`;
  }
}

function updateSpecs(d) {
  const camCount = getActiveCameraCount();
  setSpec(el.specCamera, camCount > 0 ? `${camCount} ONLINE` : "OFFLINE", camCount > 0 ? "ok" : "off");

  const pwmCount = d.pwm ? Object.values(d.pwm).filter((v) => Number.isFinite(v)).length : 0;
  setSpec(el.specThruster, `${pwmCount} PWM`, d.mavlink_connected && pwmCount > 0 ? "ok" : "off");

  if (d.gripper !== undefined) setSpec(el.specGripper, String(d.gripper).toUpperCase(), "ok");
}

function resolvePosition(d) {
  const posValid = d.pos_valid === true && Number.isFinite(d.x) && Number.isFinite(d.y);
  const drValid  = Number.isFinite(d.dr_x) && Number.isFinite(d.dr_y);

  const depth =
    Number.isFinite(d.depth_pressure) && d.depth_pressure > 0.05
      ? d.depth_pressure
      : (Number.isFinite(d.depth) ? d.depth : 0);

  if (posValid) return { mode: "PIXHAWK", x: d.x,    y: d.y,    depth };
  if (drValid)  return { mode: "DR",      x: d.dr_x, y: d.dr_y, depth };
  return { mode: "WAITING", x: 0, y: 0, depth };
}

function applyTelemetry(d) {
  if (offline) {
    offline = false;
    appendLog("[SYS] Backend tersambung kembali.");
  }

  const yaw = Number.isFinite(d.yaw) ? d.yaw : 0;

  if (el.depth) el.depth.textContent = `${(d.depth || 0).toFixed(2)} m`;
  if (el.roll)  el.roll.textContent  = `${Math.round(d.roll  || 0)}°`;
  if (el.pitch) el.pitch.textContent = `${Math.round(d.pitch || 0)}°`;
  if (el.yaw)   el.yaw.textContent   = `${Math.round(d.yaw   || 0)}°`;

  if (window.updateRovOrientation) {
    window.updateRovOrientation(d.roll || 0, d.pitch || 0, d.yaw || 0, d.depth || 0, !!d.mavlink_connected);
  }

  updatePwm(d.pwm);
  updateQr(d.qr_data);
  updateSpecs(d);
  setSystemState(d.mavlink_connected ? "ok" : "nolink");

  const pos = resolvePosition(d);
  if (pos.mode === "WAITING") {
    setWaiting(yaw);
  } else {
    recordTrajPoint(pos.x, pos.y, pos.depth, yaw, pos.mode);
  }
  if (window.updateRov3DTrail) {
    window.updateRov3DTrail(pos.x, pos.y, pos.depth, yaw, pos.mode !== "WAITING");
  }

  updateDepthAlarm(pos.depth);
  pushCsvRow(d);

  const now = Date.now();
  if (now - lastTelemetryLog >= LOG_TELEMETRY_EVERY_MS) {
    lastTelemetryLog = now;
    appendLog(
      `${pos.mode} X:${pos.x.toFixed(2)} Y:${pos.y.toFixed(2)} | ` +
      `DEPTH:${pos.depth.toFixed(2)}m | YAW:${yaw.toFixed(1)}°`
    );
  }
}

function handleOffline(err) {
  if (!offline) {
    console.error("[GCS] fetchTelemetry gagal — cek alamat backend/jaringan/backend:", err);
    appendLog(`[ERR] Tidak bisa menghubungi backend di ${BACKEND_URL} — cek IP/jaringan/status backend.`, "error");
  }
  offline = true;
  setOffline();
  setSystemState("offline");
  setSpec(el.specThruster, "-- PWM", "off");
}

async function fetchTelemetry() {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TELEMETRY_TIMEOUT_MS);
  try {
    const res = await fetch(`${BACKEND_URL}/telemetry`, { signal: ctrl.signal });
    if (!res.ok) return;
    applyTelemetry(await res.json());
  } catch (err) {
    handleOffline(err);
  } finally {
    clearTimeout(timeout);
  }
}

export function startTelemetry() {
  setSystemState("connecting");
  const tick = async () => {
    await fetchTelemetry();
    setTimeout(tick, TELEMETRY_POLL_MS);
  };
  tick();
}
