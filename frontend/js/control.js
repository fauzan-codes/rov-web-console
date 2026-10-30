//  ./frontend/js/control.js
//  control.js - TAHAP 2: nyetir ROV dari joystick di GCS. Chip "DRIVE" di header membuka panel kecil:
//  Enable/Disable Control, STOP, ARM/DISARM, pilih mode, bar nilai joystick, dan status tombol joystick.

//  NOTE:
//  Alur: joystick (Gamepad API) -> processAxes() (joystick.js, pengaturan SIMPAN dari popup Settings)
//        -> POST /control/axes 20 Hz -> backend (rov_control.py) -> MANUAL_CONTROL -> Pixhawk.
//  Nilai yang dikirim SAMA dengan yang dilihat operator di popup Settings (kolom kanan "Pemetaan sumbu").
//  Ingat: perubahan pemetaan baru berlaku setelah tombol Simpan di popup.
//
//  TOMBOL JOYSTICK:
//    Fungsi tiap tombol (arm, disarm, mode_manual, shift, gain_inc, dst.) TIDAK disimpan di web,
//    tapi di PIXHAWK (parameter BTNn_FUNCTION / BTNn_SFUNCTION) - itu yang diatur QGC di halaman Joystick.
//    Web cukup mengirim "tombol nomor berapa yang sedang ditekan" (bitmask 16-bit di MANUAL_CONTROL),
//    jadi selama NOMOR tombolnya sama dengan QGC, perilakunya otomatis sama (termasuk Shift).
//    Nomor tombol browser bisa beda dengan QGC (Gamepad API vs SDL). Kalau beda, isi peta dari Console:
//      localStorage.setItem("rov.buttonMap", JSON.stringify([...]))   // isi[nomorBrowser] = nomorQGC
//      localStorage.removeItem("rov.buttonMap")                       // kembali ke bawaan (sama persis)
//    Cek nomornya lewat deretan kotak "Buttons" di panel DRIVE (menyala saat tombol ditekan).
//
//  PENGAMAN DI SISI BROWSER (pengaman utama tetap watchdog di backend):
//    - Enable ditolak kalau joystick tidak terdeteksi, stick belum netral, atau ada tombol yang ditekan.
//    - Control otomatis OFF kalau: joystick terputus, tab disembunyikan, jendela kehilangan fokus
//      (Gamepad API hanya hidup di halaman yang fokus), backend tidak terjangkau, atau tombol Space ditekan.
//    - Space = STOP darurat (selama control ON).
//    - Tombol joystick hanya dikirim saat control ON (kalau OFF, kotak Buttons hanya untuk cek nomor).


import { BACKEND_URL } from "./config.js";
import { appendLog } from "./logger.js";
import { JOY_AXES, getConfig, processAxes, readSnapshot } from "./joystick.js";

const SEND_MS = 50;          // 20 Hz
const SEND_TIMEOUT_MS = 250; // satu paket joystick tidak boleh menunggu lebih lama dari ini
const STATUS_MS = 500;
const MAX_FAILS = 20;        // ~1 detik gagal berturut-turut -> control dimatikan
const TOKEN_KEY = "rov.controlToken";
const BTN_MAP_KEY = "rov.buttonMap";

const ZERO = { surge: 0, sway: 0, heave: 0, yaw: 0 };
const AXIS_LABEL = { surge: "Surge", sway: "Sway", heave: "Heave", yaw: "Yaw" };
const MODE_FROM_ID = { 19: "manual", 0: "stabilize", 2: "depth_hold" };

// Nama fungsi tombol, disalin dari halaman Joystick QGC (hanya untuk TAMPILAN / tooltip).
// Yang benar-benar menentukan aksi adalah parameter BTNn_FUNCTION di Pixhawk. Kalau kamu ubah
// setup di QGC, perbarui tabel ini supaya tooltip tidak menyesatkan.
const QGC_BUTTONS = [
  "mount_center", "mode_manual", "mode_depth_hold", "mode_stabilize", "disarm", "shift", "arm",
  "(No Action - fungsi QGC)", "roll_pitch_toggle", "servo_1_min_momentary", "servo_1_max_momentary",
  "gain_inc", "gain_dec", "servo_3_inc", "servo_3_dec",
];
const QGC_SHIFT = { 9: "mount_pan_left", 10: "mount_pan_right", 11: "trim_pitch_dec", 12: "trim_pitch_inc" };
const BTN_BITS = 16;         // MANUAL_CONTROL.buttons = 16 bit (tombol 0..15)

// ===== State =====
let status = null;      // balasan terakhir /control/status
let wantActive = false; // operator sedang menyetir (sisi browser)
let inflight = false;
let fails = 0;
let busy = false;       // arm / mode sedang diproses
let epoch = 0;          // naik tiap Enable/Stop: balasan status yang berangkat SEBELUM itu dibuang
let ui = null;


// ===== Tombol joystick =====
function loadButtonMap() {
  try {
    const m = JSON.parse(localStorage.getItem(BTN_MAP_KEY));
    if (Array.isArray(m)) return m.map((v) => (Number.isInteger(v) ? v : -1));
  } catch (_) { /* tidak ada / rusak -> bawaan */ }
  return null;
}
let buttonMap = loadButtonMap();

const toQgc = (i) => (buttonMap ? (buttonMap[i] ?? -1) : i);

/** Bitmask tombol (nomor QGC) dari snapshot joystick. Tombol di luar 0..15 diabaikan. */
function buttonMask(snap) {
  let mask = 0;
  snap.buttons.forEach((pressed, i) => {
    if (!pressed) return;
    const q = toQgc(i);
    if (q >= 0 && q < BTN_BITS) mask |= (1 << q);
  });
  return mask;
}

function btnName(q) {
  const base = QGC_BUTTONS[q] || "(tidak diatur di tabel)";
  return QGC_SHIFT[q] ? `${base}  |  shift: ${QGC_SHIFT[q]}` : base;
}


// ===== Panggilan ke backend =====
async function api(path, { method = "GET", body, timeoutMs = 3000 } = {}) {
  const headers = {};
  // text/plain = "simple request" -> browser tidak perlu preflight CORS tiap paket
  if (body !== undefined) headers["Content-Type"] = "text/plain";
  let token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { /* diblokir */ }
  if (token) headers["X-ROV-Token"] = token;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* bukan JSON */ }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.pixhawk_text ? `${data.pixhawk_text} [${data.error}]` : (data.error || `HTTP ${res.status}`));
    err.data = data;
    throw err;
  }
  return data;
}

const shorten = (t, max = 90) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function say(text, level = "") {
  if (!ui) return;
  ui.msg.textContent = text;
  ui.msg.dataset.level = level;
}

function reportError(prefix, e) {
  console.error(`[DRIVE] ${prefix}: ${e.message}`, e.data ?? "", e);
  const short = shorten(e.message);
  say(`${prefix}: ${short}`, "error");
  appendLog(`[DRIVE] ${prefix}: ${short}`, "error");
}


// ==================== Tampilan ====================
function template() {
  const bars = JOY_AXES.map((a) => `
    <div class="dv-axis">
      <span>${AXIS_LABEL[a.key] || a.label}</span>
      <div class="dv-bar" data-bar="${a.key}"><i></i></div>
      <b data-val="${a.key}">0.00</b>
    </div>`).join("");

  const chips = QGC_BUTTONS.map((_, i) =>
    `<span class="dv-bchip" data-b="${i}" title="${i}: ${btnName(i)}">${i}</span>`).join("");

  return `
    <div class="dv-head">
      <b><i class="fa-solid fa-gamepad"></i> DRIVE CONTROL</b>
      <button type="button" class="dv-x" id="dv-close" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="dv-pills">
      <span class="dv-pill" data-p="link">Pixhawk: --</span>
      <span class="dv-pill" data-p="ctrl">Control: --</span>
      <span class="dv-pill" data-p="armed">Armed: --</span>
      <span class="dv-pill" data-p="mode">Mode: --</span>
      <span class="dv-pill" data-p="joy">Joystick: --</span>
    </div>

    <div class="dv-row">
      <button type="button" class="dv-btn dv-primary" id="dv-toggle"><i class="fa-solid fa-play"></i> Enable Control</button>
      <button type="button" class="dv-btn dv-stop" id="dv-stop"><i class="fa-solid fa-circle-stop"></i> STOP</button>
    </div>

    <div class="dv-row">
      <button type="button" class="dv-btn" id="dv-arm"><i class="fa-solid fa-lock-open"></i> ARM</button>
      <label class="dv-mode">Mode
        <select id="dv-mode" class="dv-select">
          <option value="manual">Manual</option>
          <option value="stabilize">Stabilize</option>
          <option value="depth_hold">Depth Hold</option>
          <option value="other" hidden>--</option>
        </select>
      </label>
    </div>

    <div class="dv-axes">${bars}</div>

    <div class="dv-btns">
      <span class="dv-btns-title">Buttons</span>
      <div class="dv-bchips">${chips}</div>
      <div class="dv-bnames" id="dv-bnames">--</div>
    </div>

    <div class="dv-last" id="dv-last">Sent: --</div>

    <p class="dv-msg" id="dv-msg"></p>
    <p class="dv-note">Space = STOP darurat. Control otomatis OFF kalau jendela kehilangan fokus. Tutup QGC (atau matikan joystick-nya) saat nyetir dari sini.
    Fungsi tombol diatur di Pixhawk (sama dengan QGC); nomor tombol harus sama dengan di QGC.</p>`;
}

function renderBars(out) {
  for (const { key } of JOY_AXES) {
    const bar = ui.pop.querySelector(`[data-bar="${key}"]`);
    const val = ui.pop.querySelector(`[data-val="${key}"]`);
    const v = Math.max(-1, Math.min(1, out[key] || 0));
    const fill = bar.firstElementChild;
    fill.style.left = `${v < 0 ? 50 + v * 50 : 50}%`;
    fill.style.width = `${Math.abs(v) * 50}%`;
    val.textContent = v.toFixed(2);
  }
}

function renderButtons(mask, snap) {
  const names = [];
  ui.chips.forEach((el, i) => {
    const on = (mask & (1 << i)) !== 0;
    el.classList.toggle("on", on);
    if (on) names.push(`${i} ${QGC_BUTTONS[i] || ""}`.trim());
  });
  // tombol di luar 0..15 / di luar peta: tampilkan supaya operator tahu kenapa tidak berefek
  const lost = [];
  snap.buttons.forEach((p, i) => {
    if (!p) return;
    const q = toQgc(i);
    if (q < 0 || q >= BTN_BITS) lost.push(`#${i}`);
  });
  let text = names.length ? names.join("  +  ") : "--";
  if (lost.length) text += `   (tidak dikirim: browser ${lost.join(", ")})`;
  ui.bnames.textContent = text;
}

function render() {
  if (!ui) return;
  const s = status;
  const avail = !!s?.available;
  const conn = !!s?.connected;
  const active = wantActive && !!s?.active;
  const stale = active && !!s?.stale;
  const armed = !!s?.armed;

  // Chip di header
  let state = "off";
  if (!s) state = "unknown";
  else if (!avail) state = "locked";
  else if (stale) state = "warn";
  else if (active) state = "on";
  ui.chip.dataset.state = state;
  ui.chipText.textContent = !s
    ? "DRIVE --"
    : !avail
      ? "DRIVE LOCKED"
      : `DRIVE ${active ? "ON" : "OFF"} · ${armed ? "ARMED" : "DISARMED"}`;

  // Pill
  const pill = (key, text, st) => {
    const el = ui.pop.querySelector(`[data-p="${key}"]`);
    el.textContent = text;
    el.dataset.state = st;
  };
  const snap = readSnapshot(getConfig());
  pill("link", `Pixhawk: ${!s ? "--" : conn ? "Connected" : "Disconnected"}`, conn ? "ok" : "bad");
  pill("ctrl", `Control: ${!s ? "--" : avail ? (active ? "ON" : "Ready") : "Locked"}`, !s ? "warn" : avail ? (active ? "ok" : "warn") : "bad");
  pill("armed", `Armed: ${!s ? "--" : armed ? "YES" : "NO"}`, armed ? "bad" : "ok");
  pill("mode", `Mode: ${s ? s.mode : "--"}`, "ok");
  pill("joy", `Joystick: ${snap.connected ? "Connected" : "Not found"}`, snap.connected ? "ok" : "bad");

  // Tombol
  const can = avail && conn && !busy;
  ui.toggle.disabled = !can && !wantActive;
  ui.toggle.innerHTML = wantActive
    ? `<i class="fa-solid fa-pause"></i> Disable Control`
    : `<i class="fa-solid fa-play"></i> Enable Control`;
  ui.toggle.classList.toggle("on", wantActive);
  ui.stop.disabled = !wantActive;

  ui.arm.disabled = !can;
  ui.arm.innerHTML = armed
    ? `<i class="fa-solid fa-lock"></i> DISARM`
    : `<i class="fa-solid fa-lock-open"></i> ARM`;
  ui.arm.classList.toggle("armed", armed);

  ui.mode.disabled = !can;
  if (s && document.activeElement !== ui.mode) {
    const key = MODE_FROM_ID[s.mode_id];
    if (key) {
      ui.mode.value = key;
    } else {
      const other = ui.mode.querySelector('[value="other"]');
      other.textContent = s.mode;
      other.hidden = false;
      ui.mode.value = "other";
    }
  }

  // Alasan terkunci
  if (s && !avail) {
    say("Control dimatikan di backend. Jalankan backend dengan ROV_ENABLE_CONTROL=1.", "warn");
  }

  ui.last.textContent = s
    ? `Sent  X ${s.last.x}  Y ${s.last.y}  Z ${s.last.z}  R ${s.last.r}  B ${s.last.b ?? 0}   ·   limit ${Math.round(s.limit * 100)}%` +
      (stale ? "   ·   WATCHDOG: netral" : "")
    : "Sent: --";
}


// ==================== Aksi ====================
function applyStatus(s) {
  status = s;
  // Backend mematikan control sendiri (mis. Pixhawk terputus)
  if (wantActive && !s.active) {
    wantActive = false;
    const why = s.reason || "dimatikan backend";
    say(`Control OFF: ${why}`, "warn");
    appendLog(`[DRIVE] Control OFF — ${why}`, "warn");
  }
  render();
}

async function pollStatus() {
  const myEpoch = epoch;
  try {
    const s = await api("/control/status", { timeoutMs: 1500 });
    // Balasan ini berangkat sebelum Enable/Stop terakhir -> isinya sudah basi, jangan dipakai
    // (kalau dipakai, "active:false" lama bisa mematikan control yang baru saja dinyalakan).
    if (myEpoch !== epoch) return;
    applyStatus(s);
  } catch (_) {
    if (myEpoch !== epoch) return;
    status = null;
    if (wantActive) stopDrive("Backend tidak terjangkau", "error", false);
    render();
  }
}

async function enableDrive() {
  const cfg = getConfig();
  const snap = readSnapshot(cfg);
  if (!snap.connected) {
    say("Joystick belum terdeteksi. Gerakkan stick atau tekan satu tombol, lalu coba lagi.", "error");
    return;
  }
  const out = processAxes(snap.rawAxes, cfg);
  if (Object.values(out).some((v) => Math.abs(v) > 0.001)) {
    say("Lepas semua stick dulu (harus netral), lalu tekan Enable lagi.", "error");
    return;
  }
  if (buttonMask(snap) !== 0) {
    say("Lepas semua tombol joystick dulu, lalu tekan Enable lagi.", "error");
    return;
  }
  busy = true; epoch++; render();
  try {
    const s = await api("/control/enable", { method: "POST", body: { enabled: true, axes: out, buttons: 0 } });
    epoch++;
    wantActive = true;
    fails = 0;
    appendLog(`[DRIVE] Control ON (limit ${Math.round(s.limit * 100)}%)`);
    say("Control ON. Gerakkan joystick untuk menyetir. Space = STOP.", "ok");
    applyStatus(s);
  } catch (e) {
    reportError("Enable gagal", e);
  }
  busy = false; render();
}

function stopDrive(reason, level = "warn", tell = true) {
  const was = wantActive;
  wantActive = false;
  epoch++;
  fails = 0;
  if (tell) {
    api("/control/stop", { method: "POST", body: {}, timeoutMs: 1500 }).then(applyStatus).catch(() => {});
  }
  if (was) {
    appendLog(`[DRIVE] Control OFF — ${reason}`, level);
    say(`Control OFF: ${reason}`, level);
  }
  render();
}

async function toggleArm() {
  const armed = !!status?.armed;
  if (!armed && !confirm("ARM robot?\nBaling-baling bisa berputar. Pastikan area aman.")) return;
  busy = true; render();
  try {
    const r = await api("/control/arm", { method: "POST", body: { arm: !armed }, timeoutMs: 8000 });
    const word = !armed ? "ARMED" : "DISARMED";
    if (r.verified) {
      say(`Robot ${word}.`, "ok");
      appendLog(`[DRIVE] Robot ${word}`);
    } else {
      say(`Perintah diterima, tapi status ${word} belum terbukti dari heartbeat.`, "warn");
      appendLog(`[DRIVE] ${word}: belum terbukti dari heartbeat`, "warn");
    }
    await pollStatus();
  } catch (e) {
    reportError(`${armed ? "DISARM" : "ARM"} gagal`, e);
  }
  busy = false; render();
}

async function changeMode() {
  const mode = ui.mode.value;
  if (mode === "other") return;
  busy = true; render();
  try {
    const r = await api("/control/mode", { method: "POST", body: { mode }, timeoutMs: 8000 });
    say(`Mode: ${r.mode}${r.verified ? "" : " (belum terbukti dari heartbeat)"}`, r.verified ? "ok" : "warn");
    appendLog(`[DRIVE] Mode → ${r.mode}${r.verified ? "" : " (belum terbukti)"}`);
    await pollStatus();
  } catch (e) {
    reportError("Ganti mode gagal", e);
  }
  busy = false; render();
}


// ==================== Loop 20 Hz ====================
function tick() {
  if (!ui) return;
  const popOpen = !ui.pop.hidden;
  if (!wantActive && !popOpen) return;

  const cfg = getConfig();
  const snap = readSnapshot(cfg);
  const out = snap.connected ? processAxes(snap.rawAxes, cfg) : { ...ZERO };
  const mask = snap.connected ? buttonMask(snap) : 0;
  if (popOpen) {
    renderBars(out);
    renderButtons(mask, snap);
  }
  if (!wantActive) return;

  if (!snap.connected) {
    stopDrive("Joystick terputus", "error");
    return;
  }
  if (inflight) return;   // jangan menumpuk request; nilai terbaru dikirim di tick berikutnya
  inflight = true;
  api("/control/axes", { method: "POST", body: { ...out, buttons: mask }, timeoutMs: SEND_TIMEOUT_MS })
    .then((r) => {
      fails = 0;
      if (r.active === false && wantActive) {
        wantActive = false;
        const why = r.reason || "dimatikan backend";
        say(`Control OFF: ${why}`, "warn");
        appendLog(`[DRIVE] Control OFF — ${why}`, "warn");
        render();
      }
    })
    .catch(() => {
      fails++;
      if (fails >= MAX_FAILS && wantActive) stopDrive("Koneksi ke backend bermasalah", "error", false);
    })
    .finally(() => { inflight = false; });
}


// ==================== Init ====================
export function initControl() {
  if (ui) return;

  // Chip di header (sebelum tombol Pengaturan / menu)
  const chip = document.createElement("button");
  chip.type = "button";
  chip.id = "driveChip";
  chip.className = "drive-chip";
  chip.dataset.state = "unknown";
  chip.innerHTML = `<i class="fa-solid fa-gamepad"></i><span>DRIVE --</span>`;

  const host = document.querySelector(".system-info");
  const anchor = document.getElementById("settingBtn") || document.getElementById("menuBtn");
  if (host && anchor) host.insertBefore(chip, anchor);
  else if (host) host.appendChild(chip);
  else { chip.classList.add("floating"); document.body.appendChild(chip); }

  // Panel
  const pop = document.createElement("div");
  pop.className = "drive-pop";
  pop.id = "drivePop";
  pop.hidden = true;
  pop.innerHTML = template();
  document.body.appendChild(pop);

  ui = {
    chip, chipText: chip.querySelector("span"), pop,
    toggle: pop.querySelector("#dv-toggle"),
    stop:   pop.querySelector("#dv-stop"),
    arm:    pop.querySelector("#dv-arm"),
    mode:   pop.querySelector("#dv-mode"),
    last:   pop.querySelector("#dv-last"),
    msg:    pop.querySelector("#dv-msg"),
    bnames: pop.querySelector("#dv-bnames"),
    chips:  Array.from(pop.querySelectorAll(".dv-bchip")),
  };

  chip.addEventListener("click", () => { pop.hidden = !pop.hidden; render(); });
  pop.querySelector("#dv-close").addEventListener("click", () => { pop.hidden = true; });
  ui.toggle.addEventListener("click", () => (wantActive ? stopDrive("dimatikan operator") : enableDrive()));
  ui.stop.addEventListener("click", () => stopDrive("STOP ditekan"));
  ui.arm.addEventListener("click", toggleArm);
  ui.mode.addEventListener("change", changeMode);

  // Pengaman browser
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && wantActive) {
      e.preventDefault();
      e.stopPropagation();
      stopDrive("STOP (Space)");
    }
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && wantActive) stopDrive("Tab disembunyikan");
  });
  window.addEventListener("blur", () => {
    if (wantActive) stopDrive("Jendela kehilangan fokus");
  });
  window.addEventListener("pagehide", () => {
    if (wantActive) {
      try { navigator.sendBeacon(`${BACKEND_URL}/control/stop`); } catch (_) { /* watchdog backend yang menutup */ }
    }
  });

  setInterval(tick, SEND_MS);
  setInterval(pollStatus, STATUS_MS);
  pollStatus();
  render();
}