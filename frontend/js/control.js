//  ./frontend/js/control.js
//  control.js - Drive Control: mengemudikan vehicle dari joystick melalui GCS.

//  NOTE:
//  Modul ini membuat chip "DRIVE" di header dan panel kontrol berisi: Enable/Disable Control, STOP, ARM/DISARM, pemilih mode, monitor axis, status tombol joystick, dan diagnostik Joystick Bridge.
//
//  INPUT SOURCE (dipilih otomatis saat Enable Control)
//    1. Bridge  (disarankan): tools/joystick_bridge.py membaca joystick di luar browser, sehingga tidak terpengaruh tab / fokus. Dashboard hanya dipakai untuk Enable / STOP / ARM / mode / monitoring.
//    2. Browser (fallback)  : Gamepad API. Browser menghentikan data gamepad saat tab disembunyikan atau jendela kehilangan fokus, sehingga control dimatikan otomatis pada kondisi tersebut.
//
//  KONFIGURASI
//    Axis mapping, deadband, exponential, dan gain diatur di Settings > Joystick, lalu dikirim berkala ke backend (/control/config) agar Bridge memakai pengaturan yang sama.
//
//  BUTTON FUNCTIONS
//    Fungsi tiap tombol (arm, disarm, mode_*, shift, gain_inc, ...) disimpan di Pixhawk (BTNn_FUNCTION / BTNn_SFUNCTION).
//    Dashboard hanya mengirim bitmask tombol yang sedang ditekan, bernomor mengikuti QGC / SDL GameController.
//    Bridge sudah memakai urutan tersebut; sumber Browser menerjemahkannya lewat STD_TO_SDL.
//    Peta tombol manual (opsional, hanya sumber Browser) untuk gamepad non-standard:
//      localStorage.setItem("rov.buttonMap", JSON.stringify([...]))   // isi[nomorBrowser] = nomorQGC
//      localStorage.removeItem("rov.buttonMap")                       // kembali ke default
//
//  KEYBOARD & AUTENTIKASI
//    Space = emergency STOP (selama dashboard fokus).
//    Jika backend memakai ROV_CONTROL_TOKEN:  localStorage.setItem("rov.controlToken", "<token>")


import { BACKEND_URL } from "./config.js";
import { appendLog } from "./logger.js";
import { JOY_AXES, QGC_BUTTON_LABELS, getConfig, processAxes, readSnapshot } from "./joystick.js";

const SEND_MS = 50;          // 20 Hz: laju kirim dan render (sumber Browser)
const SEND_TIMEOUT_MS = 250; // satu paket joystick tidak boleh menunggu lebih lama dari ini
const STATUS_MS = 500;       // polling status normal
const FAST_STATUS_MS = 150;  // polling saat panel terbuka dan Bridge aktif (grafik lebih halus)
const CONFIG_PUSH_MS = 2000; // interval sinkronisasi konfigurasi joystick ke backend
const MAX_FAILS = 20;        // ~1 detik gagal berturut-turut -> control dimatikan (sumber Browser)
const TOKEN_KEY = "rov.controlToken";
const BTN_MAP_KEY = "rov.buttonMap";
const BTN_BITS = 16;         // MANUAL_CONTROL.buttons berukuran 16 bit (tombol 0..15)

const ZERO = { surge: 0, sway: 0, heave: 0, yaw: 0 };
const RAW_NAMES = ["LX", "LY", "RX", "RY", "LT", "RT"];   // nama axis mentah dari Bridge (urutan SDL)

// custom_mode ArduSub -> nilai pada dropdown mode
const MODE_FROM_ID = { 19: "manual", 0: "stabilize", 2: "depth_hold" };

// Gamepad API (mapping "standard") -> nomor tombol QGC / SDL GameController. -1 = tidak ada padanannya (LT / RT adalah axis).
//   browser:  0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 Back, 9 Start, 10 L3, 11 R3, 12-15 D-pad atas/bawah/kiri/kanan, 16 Guide
//   QGC/SDL:  0 A, 1 B, 2 X, 3 Y, 4 Back, 5 Guide, 6 Start, 7 L3, 8 R3, 9 LB, 10 RB, 11-14 D-pad atas/bawah/kiri/kanan
const STD_TO_SDL = [0, 1, 2, 3, 9, 10, -1, -1, 4, 6, 7, 8, 11, 12, 13, 14, 5];

// ===== State =====
let status = null;       // balasan terakhir /control/status
let wantActive = false;  // operator sedang mengemudi
let activeSource = "";   // "bridge" | "browser"
let inflight = false;    // request /control/axes sedang berjalan (sumber Browser)
let polling = false;     // request status sedang berjalan
let lastPoll = 0;
let fails = 0;
let busy = false;        // Enable / ARM / mode sedang diproses
let epoch = 0;           // naik tiap Enable/Stop: balasan status yang berangkat SEBELUM itu dibuang
let adoptBlockUntil = 0; // jangan "mengadopsi" control backend sesaat setelah STOP
let cfgSent = "";        // konfigurasi terakhir yang sudah terkirim ke backend
let ui = null;           // referensi elemen UI


// ===== Tombol joystick (sumber Browser) =====
function loadButtonMap() {
  try {
    const m = JSON.parse(localStorage.getItem(BTN_MAP_KEY));
    if (Array.isArray(m)) return m.map((v) => (Number.isInteger(v) ? v : -1));
  } catch (_) { /* tidak ada / rusak: pakai default */ }
  return null;
}
const buttonMap = loadButtonMap();

function toQgc(i, snap) {
  if (buttonMap) return buttonMap[i] ?? -1;
  if (snap.mapping === "standard") return STD_TO_SDL[i] ?? -1;
  return i;   // gamepad non-standard: dipakai apa adanya
}

/** Bitmask tombol (nomor QGC) dari snapshot browser. Tombol di luar 0..15 diabaikan. */
function buttonMask(snap) {
  let mask = 0;
  snap.buttons.forEach((pressed, i) => {
    if (!pressed) return;
    const q = toQgc(i, snap);
    if (q >= 0 && q < BTN_BITS) mask |= (1 << q);
  });
  return mask;
}


// ===== Panggilan ke backend =====
async function api(path, { method = "GET", body, timeoutMs = 3000 } = {}) {
  const headers = {};
  // text/plain = "simple request": browser tidak perlu preflight CORS di setiap paket
  if (body !== undefined) headers["Content-Type"] = "text/plain";
  let token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { /* storage diblokir */ }
  if (token) headers["X-ROV-Token"] = token;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* respons bukan JSON */ }
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

/** Tampilkan pesan status di panel Drive Control. level: "" | "ok" | "warn" | "error". */
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
      <span>${a.label}</span>
      <div class="dv-bar" data-bar="${a.key}"><i></i></div>
      <b data-val="${a.key}">0.00</b>
    </div>`).join("");

  const chips = QGC_BUTTON_LABELS.map((label, i) =>
    `<span class="dv-bchip" data-b="${i}" title="Button ${i}: ${label}">${i}</span>`).join("");

  return `
    <div class="dv-head">
      <b><i class="fa-solid fa-gamepad"></i> DRIVE CONTROL</b>
      <button type="button" class="dv-x" id="dv-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <div class="dv-pills">
      <span class="dv-pill" data-p="link" title="MAVLink connection between the backend and the Pixhawk">Pixhawk: --</span>
      <span class="dv-pill" data-p="ctrl" title="Whether joystick control is currently sending commands">Control: --</span>
      <span class="dv-pill" data-p="armed" title="Arm state reported by the Pixhawk heartbeat">Armed: --</span>
      <span class="dv-pill" data-p="mode" title="Flight mode reported by the Pixhawk heartbeat">Mode: --</span>
      <span class="dv-pill" data-p="joy" title="Active joystick input source">Joystick: --</span>
    </div>

    <div class="dv-row">
      <button type="button" class="dv-btn dv-primary" id="dv-toggle" title="Start / stop sending joystick input to the vehicle. Sticks must be centered."><i class="fa-solid fa-play"></i> Enable Control</button>
      <button type="button" class="dv-btn dv-stop" id="dv-stop" title="Emergency stop: turn control OFF and send neutral (Space)"><i class="fa-solid fa-circle-stop"></i> STOP</button>
    </div>

    <div class="dv-row">
      <button type="button" class="dv-btn" id="dv-arm" title="Arm / disarm the motors"><i class="fa-solid fa-lock-open"></i> ARM</button>
      <label class="dv-mode">Mode
        <select id="dv-mode" class="dv-select" title="Flight mode">
          <option value="manual">Manual</option>
          <option value="stabilize">Stabilize</option>
          <option value="depth_hold">Depth Hold</option>
          <option value="other" hidden>--</option>
        </select>
      </label>
    </div>

    <div class="dv-axes" title="Joystick output after mapping, deadband, exponential, and gain">${bars}</div>

    <div class="dv-btns">
      <span class="dv-btns-title">Buttons</span>
      <div class="dv-bchips">${chips}</div>
      <div class="dv-bnames" id="dv-bnames">--</div>
    </div>

    <div class="dv-diag" id="dv-diag" data-state="off" title="Health of the Joystick Bridge link to the backend">Bridge: --</div>
    <div class="dv-raw" id="dv-raw" title="Raw axis values received from the Bridge, before mapping"></div>
    <div class="dv-evt" id="dv-evt"></div>

    <div class="dv-last" id="dv-last" title="Last MANUAL_CONTROL packet sent to the Pixhawk (X/Y/R: -1000..1000, Z: 0..1000, B: button bitmask)">Sent: --</div>

    <p class="dv-msg" id="dv-msg"></p>
    <p class="dv-note">
      <b>Input sources.</b> The Joystick Bridge (tools/joystick_bridge.py) is recommended: it runs independently of the browser tab and focus.
      Without it, the browser Gamepad API is used and control turns OFF automatically when the tab is hidden.<br>
      <b>Safety.</b> Space = emergency STOP. Only one ground station may send MANUAL_CONTROL: disable the QGroundControl joystick while driving from here.
      Button functions are stored on the Pixhawk (BTNn_FUNCTION); button numbers follow QGroundControl / SDL.
    </p>`;
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

/** mask = bitmask nomor QGC. snap hanya diberikan untuk sumber Browser (untuk melaporkan tombol yang tidak terkirim). */
function renderButtons(mask, snap) {
  const names = [];
  ui.chips.forEach((el, i) => {
    const on = (mask & (1 << i)) !== 0;
    el.classList.toggle("on", on);
    if (on) names.push(`${i} ${QGC_BUTTON_LABELS[i] || ""}`.trim());
  });
  const lost = [];
  if (snap) {
    snap.buttons.forEach((p, i) => {
      if (!p) return;
      const q = toQgc(i, snap);
      if (q < 0 || q >= BTN_BITS) lost.push(`#${i}`);
    });
  }
  let text = names.length ? names.join("  +  ") : "--";
  if (lost.length) text += `   (not sent: browser button ${lost.join(", ")})`;
  ui.bnames.textContent = text;
}

/** Bukti bahwa input dari Bridge sampai di backend: laju paket, umur data, axis mentah, dan tombol terakhir. */
function renderBridgeDiag(s) {
  const b = s?.bridge;
  if (!b || !b.connected) {
    ui.diag.dataset.state = "off";
    ui.diag.textContent = "Bridge: not connected. Start tools/joystick_bridge.py on the operator laptop.";
    ui.raw.textContent = "";
    ui.evt.textContent = "";
    return;
  }
  const flowing = b.rate_hz >= 5 && (b.age_ms ?? 9999) < 500;
  ui.diag.dataset.state = flowing ? "ok" : "warn";
  ui.diag.textContent =
    `Bridge ● ${shorten(b.name || "controller", 22)} · ${b.rate_hz} Hz · ${b.age_ms ?? "--"} ms · ${b.rx} packets`;
  ui.raw.textContent = "Raw  " + (b.raw || []).map((v, i) => `${RAW_NAMES[i] || "S" + i} ${v >= 0 ? "+" : ""}${v.toFixed(2)}`).join("  ");
  const ev = b.events?.[0];
  ui.evt.textContent = ev
    ? `Last press: ${ev.n} ${QGC_BUTTON_LABELS[ev.n] || ""} (${(ev.age_ms / 1000).toFixed(1)}s ago)`
    : "Last press: --  (press a joystick button)";
}

function render() {
  if (!ui) return;
  const s = status;
  const avail = !!s?.available;
  const conn = !!s?.connected;
  const active = wantActive && !!s?.active;
  const stale = active && !!s?.stale;
  const armed = !!s?.armed;
  const bridgeOn = !!s?.bridge?.connected;

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

  // Pill status
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
  if (bridgeOn) pill("joy", `Joystick: ${shorten(s.bridge.name || "controller", 24)} (Bridge)`, "ok");
  else if (snap.connected) pill("joy", "Joystick: Browser only", "warn");
  else pill("joy", "Joystick: Not found", "bad");

  // Tombol aksi
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

  if (s && !avail) {
    say("Control is disabled on the backend. Start it with ROV_ENABLE_CONTROL=1.", "warn");
  }

  renderBridgeDiag(s);

  ui.last.textContent = s
    ? `Sent  X ${s.last.x}  Y ${s.last.y}  Z ${s.last.z}  R ${s.last.r}  B ${s.last.b ?? 0}   ·   limit ${Math.round(s.limit * 100)}%` +
      (active ? `   ·   via ${s.source || activeSource}` : "") +
      (stale ? "   ·   WATCHDOG: neutral" : "")
    : "Sent: --";
}


// ==================== Aksi ====================
function applyStatus(s) {
  status = s;

  // Backend mematikan control sendiri (mis. Pixhawk terputus, Bridge berhenti)
  if (wantActive && !s.active) {
    wantActive = false;
    const why = s.reason || "turned off by the backend";
    say(`Control OFF: ${why}`, "warn");
    appendLog(`[DRIVE] Control OFF — ${why}`, "warn");
  }

  // Halaman di-refresh saat control via Bridge masih ON: sambungkan kembali tampilannya
  if (!wantActive && s.active && s.source === "bridge" && Date.now() > adoptBlockUntil && !busy) {
    wantActive = true;
    activeSource = "bridge";
    say("Control via Bridge is already ON (UI reconnected).", "ok");
  }
  render();
}

async function pollStatus() {
  if (polling) return;
  polling = true;
  lastPoll = Date.now();
  const myEpoch = epoch;
  try {
    const s = await api("/control/status", { timeoutMs: 1500 });
    // Balasan ini berangkat sebelum Enable/Stop terakhir -> sudah basi, abaikan.
    if (myEpoch !== epoch) return;
    applyStatus(s);
  } catch (_) {
    if (myEpoch !== epoch) return;
    status = null;
    // Sumber Bridge tidak bergantung pada koneksi browser ke backend, jadi jangan dimatikan dari sini.
    if (wantActive && activeSource === "browser") stopDrive("backend unreachable", "error", false);
    render();
  } finally {
    polling = false;
  }
}

/** Kirim konfigurasi joystick ke backend jika berubah (dipakai oleh Bridge). */
async function pushConfig() {
  if (status && !status.available) return;   // kontrol dimatikan di backend: tidak ada gunanya
  const json = JSON.stringify(getConfig());
  if (json === cfgSent) return;
  try {
    await api("/control/config", { method: "POST", body: JSON.parse(json) });
    cfgSent = json;
    appendLog("[DRIVE] Konfigurasi joystick dikirim ke backend (dipakai Bridge).");
  } catch (_) { /* backend belum siap / kontrol dimatikan: dicoba lagi pada siklus berikutnya */ }
}

async function enableDrive() {
  const bridgeOn = !!status?.bridge?.connected;
  let body;

  if (bridgeOn) {
    body = { enabled: true, source: "bridge" };   // backend memeriksa sendiri bahwa stick netral dari data Bridge
  } else {
    const cfg = getConfig();
    const snap = readSnapshot(cfg);
    if (!snap.connected) {
      say("No joystick detected. Start the Joystick Bridge (recommended) or move a stick so the browser detects it.", "error");
      return;
    }
    const out = processAxes(snap.rawAxes, cfg);
    if (Object.values(out).some((v) => Math.abs(v) > 0.001)) {
      say("Center all sticks first, then press Enable again.", "error");
      return;
    }
    if (buttonMask(snap) !== 0) {
      say("Release all joystick buttons first, then press Enable again.", "error");
      return;
    }
    body = { enabled: true, source: "browser", axes: out, buttons: 0 };
  }

  busy = true; epoch++; render();
  try {
    const s = await api("/control/enable", { method: "POST", body });
    epoch++;
    wantActive = true;
    activeSource = body.source;
    fails = 0;
    appendLog(`[DRIVE] Control ON via ${activeSource === "bridge" ? "Bridge" : "Browser"} (limit ${Math.round(s.limit * 100)}%)`);
    say(activeSource === "bridge"
      ? "Control ON via Bridge. Other tabs and windows can be used. Space = STOP."
      : "Control ON via Browser. Keep this tab visible and focused (use the Bridge for background operation). Space = STOP.", "ok");
    applyStatus(s);
  } catch (e) {
    reportError("Enable failed", e);
  }
  busy = false; render();
}

function stopDrive(reason, level = "warn", tell = true) {
  const was = wantActive;
  wantActive = false;
  epoch++;
  fails = 0;
  adoptBlockUntil = Date.now() + 1500;
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
  if (!armed && !confirm("ARM the vehicle?\nPropellers may spin. Make sure the area is clear.")) return;
  busy = true; render();
  try {
    const r = await api("/control/arm", { method: "POST", body: { arm: !armed }, timeoutMs: 8000 });
    const word = !armed ? "ARMED" : "DISARMED";
    if (r.verified) {
      say(`Vehicle ${word}.`, "ok");
      appendLog(`[DRIVE] Vehicle ${word}`);
    } else {
      say(`Command accepted, but the ${word} state has not been confirmed by the heartbeat yet.`, "warn");
      appendLog(`[DRIVE] ${word}: belum terkonfirmasi heartbeat`, "warn");
    }
    await pollStatus();
  } catch (e) {
    reportError(`${armed ? "DISARM" : "ARM"} failed`, e);
  }
  busy = false; render();
}

async function changeMode() {
  const mode = ui.mode.value;
  if (mode === "other") return;
  busy = true; render();
  try {
    const r = await api("/control/mode", { method: "POST", body: { mode }, timeoutMs: 8000 });
    say(`Mode: ${r.mode}${r.verified ? "" : " (not yet confirmed by the heartbeat)"}`, r.verified ? "ok" : "warn");
    appendLog(`[DRIVE] Mode → ${r.mode}${r.verified ? "" : " (belum terkonfirmasi)"}`);
    await pollStatus();
  } catch (e) {
    reportError("Mode change failed", e);
  }
  busy = false; render();
}


// ==================== Loop 20 Hz ====================
function tick() {
  if (!ui) return;
  const popOpen = !ui.pop.hidden;
  const bridgeOn = !!status?.bridge?.connected;

  // Panel terbuka + Bridge aktif: ambil status lebih sering agar bar bergerak halus
  if (popOpen && bridgeOn && !polling && Date.now() - lastPoll > FAST_STATUS_MS) pollStatus();

  if (!wantActive && !popOpen) return;

  const cfg = getConfig();
  const snap = readSnapshot(cfg);

  if (popOpen) {
    if (bridgeOn) {
      renderBars(status.bridge.axes || ZERO);
      renderButtons((status.bridge.recent ?? status.bridge.buttons) | 0, null);
    } else {
      renderBars(snap.connected ? processAxes(snap.rawAxes, cfg) : ZERO);
      renderButtons(snap.connected ? buttonMask(snap) : 0, snap);
    }
  }

  // Source BRIDGE: Bridge mengirim langsung ke backend, dashboard tidak perlu mengirim apa pun.
  if (!wantActive || activeSource !== "browser") return;

  // ----- Source BROWSER -----
  if (!snap.connected) {
    stopDrive("joystick disconnected", "error");
    return;
  }
  if (inflight) return;   // jangan menumpuk request; nilai terbaru dikirim pada tick berikutnya
  const out = processAxes(snap.rawAxes, cfg);
  const mask = buttonMask(snap);
  inflight = true;
  api("/control/axes", { method: "POST", body: { ...out, buttons: mask }, timeoutMs: SEND_TIMEOUT_MS })
    .then((r) => {
      fails = 0;
      if (r.active === false && wantActive) {
        wantActive = false;
        const why = r.reason || "turned off by the backend";
        say(`Control OFF: ${why}`, "warn");
        appendLog(`[DRIVE] Control OFF — ${why}`, "warn");
        render();
      }
    })
    .catch(() => {
      fails++;
      if (fails >= MAX_FAILS && wantActive) stopDrive("unstable connection to the backend", "error", false);
    })
    .finally(() => { inflight = false; });
}


// ==================== Init ====================
export function initControl() {
  if (ui) return;

  // Chip di header (disisipkan sebelum tombol Settings / menu)
  const chip = document.createElement("button");
  chip.type = "button";
  chip.id = "driveChip";
  chip.className = "drive-chip";
  chip.dataset.state = "unknown";
  chip.title = "Open Drive Control";
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
    diag:   pop.querySelector("#dv-diag"),
    raw:    pop.querySelector("#dv-raw"),
    evt:    pop.querySelector("#dv-evt"),
    msg:    pop.querySelector("#dv-msg"),
    bnames: pop.querySelector("#dv-bnames"),
    chips:  Array.from(pop.querySelectorAll(".dv-bchip")),
  };

  chip.addEventListener("click", () => { pop.hidden = !pop.hidden; render(); });
  pop.querySelector("#dv-close").addEventListener("click", () => { pop.hidden = true; });
  ui.toggle.addEventListener("click", () => (wantActive ? stopDrive("disabled by operator") : enableDrive()));
  ui.stop.addEventListener("click", () => stopDrive("STOP pressed"));
  ui.arm.addEventListener("click", toggleArm);
  ui.mode.addEventListener("change", changeMode);

  // Space = emergency STOP (berlaku untuk semua source, selama dashboard fokus)
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && wantActive) {
      e.preventDefault();
      e.stopPropagation();
      stopDrive("STOP (Space)");
    }
  }, true);

  // Pengaman khusus source Browser: Gamepad API membeku saat tab disembunyikan / jendela kehilangan fokus.
  // Source Bridge tidak terpengaruh, sehingga tidak dimatikan di sini.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && wantActive && activeSource === "browser") {
      stopDrive("tab hidden (the browser pauses gamepad input). Use the Joystick Bridge for background operation.");
    }
  });
  window.addEventListener("blur", () => {
    if (wantActive && activeSource === "browser") {
      stopDrive("window lost focus (the browser pauses gamepad input). Use the Joystick Bridge for background operation.");
    }
  });
  window.addEventListener("pagehide", () => {
    if (wantActive && activeSource === "browser") {
      try { navigator.sendBeacon(`${BACKEND_URL}/control/stop`); } catch (_) { /* watchdog backend yang akan menetralkan */ }
    }
  });

  setInterval(tick, SEND_MS);
  setInterval(pollStatus, STATUS_MS);
  setInterval(pushConfig, CONFIG_PUSH_MS);
  pollStatus().then(pushConfig);
  render();
}