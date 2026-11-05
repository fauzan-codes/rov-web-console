//  ./frontend/js/joystick.js
//  joystick.js - Pembacaan joystick (Gamepad API), konfigurasi joystick, dan konversi input mentah menjadi nilai gerak.

//  NOTE:
//  Modul ini bersifat read-only: tidak mengirim apa pun ke backend. 
//  Fungsi processAxes() dipakai bersama oleh Settings (preview) dan Drive Control (sumber Browser), sehingga nilai yang dilihat operator identik dengan nilai yang dikirim ke vehicle. 
//  Backend memiliki implementasi yang setara (rov_control.py: _process / _curve)
//  untuk sumber Bridge; jaga agar keduanya tetap sama.
//
//  Pipeline per axis:  raw -> (invert) -> deadband -> exponential -> gain -> clamp -1..1
//
//  Konfigurasi disimpan di localStorage, sehingga berlaku per browser + origin (http://localhost dan http://127.0.0.1 dianggap origin yang berbeda). 
//  Untuk memindahkan konfigurasi antar komputer gunakan Export / Import di Settings > Joystick.
//
//  Penomoran tombol mengikuti urutan SDL GameController (sama dengan QGroundControl), lihat QGC_BUTTON_LABELS.


import { appendLog } from "./logger.js";

const STORAGE_KEY = "rov.joystick.config";
const CONFIG_VERSION = 2;   // naikkan jika struktur konfigurasi berubah; versi lama akan di-reset ke default

/** Daftar axis kendali. `key` dipakai di konfigurasi dan backend, `label` mengikuti istilah QGroundControl. */
export const JOY_AXES = [
  { key: "sway",  label: "Lateral" },
  { key: "surge", label: "Forward" },
  { key: "yaw",   label: "Yaw" },
  { key: "heave", label: "Throttle" },
];

/** Konfigurasi default (layout "Mode 4"). Harus sama dengan JOY_DEFAULT di backend/rov_control.py. */
export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    deviceId: null,
    axes: {
      surge: { axis: 1, invert: true },  // Forward : stick kiri vertikal, atas = maju
      sway:  { axis: 2, invert: false }, // Lateral : stick kanan horizontal
      heave: { axis: 3, invert: true },  // Throttle: stick kanan vertikal, atas = naik
      yaw:   { axis: 0, invert: false }, // Yaw     : stick kiri horizontal
    },
    deadzone: 0.05,   // deadband
    expo: 0,          // exponential
    gain: 1.0,
  };
}

const num = (v, min, max, fallback) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Validasi dan bersihkan konfigurasi dari localStorage / file import agar data rusak atau versi lama tidak menimbulkan error. */
export function sanitizeConfig(raw) {
  const def = defaultConfig();
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {
    version: CONFIG_VERSION,
    deviceId: typeof src.deviceId === "string" ? src.deviceId : null,
    axes: {},
    deadzone: num(src.deadzone, 0, 0.5, def.deadzone),
    expo:     num(src.expo, 0, 1, def.expo),
    gain:     num(src.gain, 0.1, 1, def.gain),
  };
  for (const { key } of JOY_AXES) {
    const m = src.axes && src.axes[key];
    out.axes[key] = {
      axis: Number.isInteger(m?.axis) && m.axis >= -1 && m.axis < 32 ? m.axis : def.axes[key].axis,
      invert: typeof m?.invert === "boolean" ? m.invert : def.axes[key].invert,
    };
  }
  return out;
}

function loadConfig() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (text) {
      const saved = JSON.parse(text);
      if (saved && saved.version === CONFIG_VERSION) return sanitizeConfig(saved);
    }
  } catch (_) { /* data rusak atau storage diblokir: pakai default */ }
  return defaultConfig();
}

let config = loadConfig();

export const getConfig = () => config;

/** Simpan konfigurasi ke localStorage. Mengembalikan konfigurasi yang sudah divalidasi. */
export function saveConfig(cfg) {
  config = sanitizeConfig(cfg);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    appendLog(`[JOY] Gagal menyimpan konfigurasi ke browser: ${e.message}`, "error");
  }
  return config;
}

export const exportConfigText = (cfg) => JSON.stringify(sanitizeConfig(cfg), null, 2);

export function parseConfigText(text) {
  const raw = JSON.parse(text);   // melempar error jika bukan JSON
  if (!raw || typeof raw !== "object" || !raw.axes) {
    throw new Error("not a joystick configuration file");
  }
  return sanitizeConfig(raw);
}


// ==================== Response curve ====================
/** Deadband -> exponential -> gain untuk satu nilai axis (-1..1). */
export function applyCurve(v, cfg) {
  const a = Math.abs(v);
  if (a <= cfg.deadzone) return 0;
  const n = (a - cfg.deadzone) / (1 - cfg.deadzone);
  const shaped = (1 - cfg.expo) * n + cfg.expo * n ** 3;
  return Math.sign(v) * Math.min(1, shaped * cfg.gain);
}

/** Axis mentah (urutan SDL / Gamepad) -> { surge, sway, heave, yaw } sesuai mapping, invert, dan curve. */
export function processAxes(rawAxes, cfg) {
  const out = {};
  for (const { key } of JOY_AXES) {
    const m = cfg.axes[key];
    let v = m.axis >= 0 ? rawAxes[m.axis] : 0;
    if (!Number.isFinite(v)) v = 0;
    out[key] = applyCurve(m.invert ? -v : v, cfg);
  }
  return out;
}


// ==================== Perangkat (Gamepad API) ====================
/**
 * Gamepad API hanya tersedia pada secure context (http://localhost atau HTTPS).
 * Jika dashboard dibuka lewat http://192.168.x.x, browser menyembunyikan gamepad.
 * Mengembalikan pesan masalah, atau null jika tidak ada masalah.
 */
export function getGamepadProblem() {
  if (typeof navigator.getGamepads !== "function") {
    return "The Gamepad API is not supported by this browser. Use Chrome or Edge.";
  }
  if (!window.isSecureContext) {
    return `Gamepad access requires http://localhost or HTTPS (current origin: ${location.origin}).`;
  }
  return null;
}

function listPads() {
  if (getGamepadProblem()) return [];
  try {
    return Array.from(navigator.getGamepads() || []).filter((p) => p && p.connected);
  } catch (_) {
    return [];
  }
}

/** Snapshot status joystick dari browser (axis mentah dan tombol). */
export function readSnapshot(cfg = config) {
  const pads = listPads();
  const pad = pads.find((p) => p.id === cfg.deviceId) || pads[0] || null;
  const devices = pads.map((p) => ({ id: p.id, index: p.index }));
  if (!pad) return { connected: false, id: "", index: -1, rawAxes: [], buttons: [], devices };
  return {
    connected: true,
    id: pad.id,
    index: pad.index,
    mapping: pad.mapping,   // "standard" jika browser mengenali layout gamepad
    rawAxes: Array.from(pad.axes),
    buttons: Array.from(pad.buttons, (b) => !!b.pressed),
    devices,
  };
}


// ==================== Event connect / disconnect ====================
let started = false;

export function startJoystick() {
  if (started) return;
  started = true;
  window.addEventListener("gamepadconnected", (e) => {
    appendLog(`[JOY] Terhubung: ${e.gamepad.id} (${e.gamepad.axes.length} axis, ${e.gamepad.buttons.length} tombol)`);
  });
  window.addEventListener("gamepaddisconnected", (e) => {
    appendLog(`[JOY] Terputus: ${e.gamepad.id}`, "warn");
  });
  const problem = getGamepadProblem();
  if (problem) appendLog(`[JOY] ${problem}`, "warn");
}


// ==================== Penomoran tombol (SDL GameController / QGroundControl) ====================
/** Label tombol berdasarkan nomor QGC / SDL (indeks = nomor tombol). LT dan RT adalah axis, bukan tombol. */
export const QGC_BUTTON_LABELS = ["A", "B", "X", "Y", "Back", "Guide", "Start", "L3", "R3", "LB", "RB", "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →"];

// Gamepad API ("standard" mapping) -> nomor QGC. -1 = tidak ada padanannya (LT dan RT adalah axis).
const STD_TO_SDL = [0, 1, 2, 3, 9, 10, -1, -1, 4, 6, 7, 8, 11, 12, 13, 14, 5];

/** Bitmask tombol (nomor QGC) dari sebuah snapshot. Snapshot dengan mapping selain "standard" dipakai apa adanya. */
export function buttonMaskQgc(snap) {
  let mask = 0;
  snap.buttons.forEach((pressed, i) => {
    if (!pressed) return;
    const q = snap.mapping === "standard" ? (STD_TO_SDL[i] ?? -1) : i;
    if (q >= 0 && q < 16) mask |= (1 << q);
  });
  return mask;
}