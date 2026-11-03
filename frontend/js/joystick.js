//  ./frontend/js/joystick.js
//  joystick.js - baca joystick (Gamepad API), simpan pengaturannya, dan ubah input mentah jadi nilai gerak.

//  NOTE:
//  TAHAP 1: modul ini HANYA MEMBACA. Tidak ada yang dikirim ke backend atau robot.
//  Tahap 2 nanti memakai processAxes() dari sini supaya nilai yang dikirim ke robot sama persis dengan yang dilihat operator di popup Pengaturan.
//
//  Pengaturan disimpan di localStorage, jadi hanya berlaku untuk browser + alamat halaman yang sama (localhost dan 127.0.0.1 dianggap berbeda oleh browser).
//  Pindah laptop = pakai Ekspor / Impor di popup.


import { appendLog } from "./logger.js";

const STORAGE_KEY = "rov.joystick.config";
const CONFIG_VERSION = 2;

export const JOY_AXES = [
  { key: "sway",  label: "Lateral" },
  { key: "surge", label: "Forward" },
  { key: "yaw",   label: "Yaw" },
  { key: "heave", label: "Throttle" },
];

export function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    deviceId: null,
    axes: {
      surge: { axis: 1, invert: true }, // Forward : stick kiri vertikal, atas = maju
      sway: { axis: 2, invert: false }, // Lateral : stick kanan horizontal
      heave: { axis: 3, invert: true }, // Throttle: stick kanan vertikal, atas = naik
      yaw: { axis: 0, invert: false }, // Yaw     : stick kiri horizontal
    },
    deadzone: 0.05,
    expo: 0,
    gain: 1.0,
  };
}

const num = (v, min, max, fallback) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

// Apa pun yang dibaca dari localStorage / file impor dibersihkan dulu, supaya data rusak atau dari versi lama tidak bikin error.
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
  } catch (_) { /* rusak / diblokir -> bawaan */ }
  return defaultConfig();
}

let config = loadConfig();

export const getConfig = () => config;

/** Simpan permanen di browser. Mengembalikan config yang sudah dibersihkan. */
export function saveConfig(cfg) {
  config = sanitizeConfig(cfg);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    appendLog(`[JOY] Gagal menyimpan ke browser: ${e.message}`, "error");
  }
  return config;
}

export const exportConfigText = (cfg) => JSON.stringify(sanitizeConfig(cfg), null, 2);

export function parseConfigText(text) {
  const raw = JSON.parse(text);   // melempar error kalau bukan JSON
  if (!raw || typeof raw !== "object" || !raw.axes) {
    throw new Error("bukan file pengaturan joystick");
  }
  return sanitizeConfig(raw);
}


// ==================== Kurva respons ====================
export function applyCurve(v, cfg) {
  const a = Math.abs(v);
  if (a <= cfg.deadzone) return 0;
  const n = (a - cfg.deadzone) / (1 - cfg.deadzone);
  const shaped = (1 - cfg.expo) * n + cfg.expo * n ** 3;
  return Math.sign(v) * Math.min(1, shaped * cfg.gain);
}

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


// ==================== Perangkat ====================
// Gamepad API hanya jalan di halaman "secure" (http://localhost atau HTTPS).
// Kalau dashboard dibuka lewat http://192.168.x.x, browser menyembunyikannya.
export function getGamepadProblem() {
  if (typeof navigator.getGamepads !== "function") {
    return "Browser ini tidak mendukung Gamepad API. Pakai Chrome atau Edge.";
  }
  if (!window.isSecureContext) {
    return `Joystick butuh halaman dibuka lewat http://localhost atau HTTPS (sekarang: ${location.origin}).`;
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


export function readSnapshot(cfg = config) {
  const pads = listPads();
  const pad = pads.find((p) => p.id === cfg.deviceId) || pads[0] || null;
  const devices = pads.map((p) => ({ id: p.id, index: p.index }));
  if (!pad) return { connected: false, id: "", index: -1, rawAxes: [], buttons: [], devices };
  return {
    connected: true,
    id: pad.id,
    index: pad.index,
    rawAxes: Array.from(pad.axes),
    buttons: Array.from(pad.buttons, (b) => !!b.pressed),
    devices,
  };
}


// ==================== Event sambung / putus ====================
let started = false;

export function startJoystick() {
  if (started) return;
  started = true;
  window.addEventListener("gamepadconnected", (e) => {
    appendLog(`[JOY] Terhubung: ${e.gamepad.id} (${e.gamepad.axes.length} sumbu, ${e.gamepad.buttons.length} tombol)`);
  });
  window.addEventListener("gamepaddisconnected", (e) => {
    appendLog(`[JOY] Terputus: ${e.gamepad.id}`, "warn");
  });
  const problem = getGamepadProblem();
  if (problem) appendLog(`[JOY] ${problem}`, "warn");
}

// ==================== Nomor tombol (urutan SDL GameController) ====================
export const QGC_BUTTON_LABELS = ["A", "B", "X", "Y", "Back", "Guide", "Start", "L3", "R3", "LB", "RB", "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →"];
// Gamepad API ("standard") -> nomor QGC. -1 = tidak ada tombolnya di QGC (LT dan RT adalah sumbu).
const STD_TO_SDL = [0, 1, 2, 3, 9, 10, -1, -1, 4, 6, 7, 8, 11, 12, 13, 14, 5];

export function buttonMaskQgc(snap) {
  let mask = 0;
  snap.buttons.forEach((pressed, i) => {
    if (!pressed) return;
    const q = snap.mapping === "standard" ? (STD_TO_SDL[i] ?? -1) : i;
    if (q >= 0 && q < 16) mask |= (1 << q);
  });
  return mask;
}