//  ./frontend/js/settings.js
//  settings.js - popup SETTINGS. Tab: Button Assignment, Joystick, dan Thruster.

//  NOTE:
//  Popup ini modal di halaman yang SAMA (bukan window baru), jadi halaman utama (kamera, telemetri, rekaman) tetap berjalan.
//
//  SUMBER JOYSTICK (otomatis, sama dengan yang dipakai Drive Control):
//    - Joystick Bridge tersambung -> tab Joystick menampilkan data dari Bridge (lewat backend /control/bridge)
//    - Bridge tidak ada           -> tab Joystick memakai Gamepad API browser
//  Perubahan di tab Joystick disimpan sebagai "draft" dulu. Baru permanen setelah Save (dan otomatis dikirim ke backend
//  oleh control.js, supaya Bridge memakai pengaturan yang sama). Gaya ada di css/settings.css.


import { appendLog } from "./logger.js";
import { downloadBlob } from "./storage.js";
import { mountThrusterTab } from "./thruster.js";
import { mountButtonsTab } from "./buttons.js";
import { watchBridge, getBridge } from "./bridge.js";
import { $ } from "./util.js";
import {
  JOY_AXES, defaultConfig, getConfig, saveConfig, readSnapshot, processAxes, applyCurve,
  exportConfigText, parseConfigText, getGamepadProblem, QGC_BUTTON_LABELS, buttonMaskQgc,
} from "./joystick.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const TUNES = [
  { key: "deadzone", label: "Deadband",    min: 0,   max: 0.5, step: 0.01, fmt: (v) => v.toFixed(2),
    hint: "Gerakan stick yang lebih kecil dari ini diabaikan, supaya robot tidak bergerak sendiri." },
  { key: "expo",     label: "Exponential", min: 0,   max: 1,   step: 0.05, fmt: (v) => v.toFixed(2),
    hint: "0 = linear. Makin besar, makin lembut di dekat tengah dan penuh di ujung stick." },
  { key: "gain",     label: "Gain",        min: 0.1, max: 1,   step: 0.05, fmt: (v) => `${Math.round(v * 100)}%`,
    hint: "Batas kekuatan maksimum saat stick didorong penuh." },
];

// Nama sumbu Bridge / SDL GameController
const BRIDGE_AXIS_NAMES = ["LX", "LY", "RX", "RY", "LT", "RT"];

// ===== State popup =====
let modal = null;
let ui = null;            // referensi elemen setelah popup dibuat
let rafId = 0;
let draft = null;
let dirty = false;
let deviceSig = "";       // penanda: kalau berubah, bagian daftar sumbu/tombol dibangun ulang
let lastFocus = null;
let thruster = null;      // { destroy } dari mountThrusterTab
let buttonsTab = null;
let unwatchBridge = null;


// ==================== Kerangka HTML ====================
function template() {
  const mapRows = JOY_AXES.map((a) => `
    <div class="st-map-row">
      <span class="st-map-name">${a.label}</span>
      <select class="st-select" data-map="${a.key}" aria-label="Axis untuk ${a.label}"></select>
      <label class="st-check"><input type="checkbox" data-inv="${a.key}" /> Invert</label>
      <div class="st-bar" data-out-bar="${a.key}"><i></i></div>
      <b class="st-val" data-out-val="${a.key}">0.00</b>
    </div>`).join("");

  const tuneRows = TUNES.map((t) => `
    <div class="st-tune-row" title="${t.hint}">
      <span>${t.label}</span>
      <input type="range" data-tune="${t.key}" min="${t.min}" max="${t.max}" step="${t.step}" />
      <b class="st-val" data-tune-val="${t.key}"></b>
    </div>`).join("");

  return `
    <div class="st-overlay" id="st-overlay"></div>
    <div class="st-box" role="dialog" aria-modal="true" aria-labelledby="st-title">

      <header class="st-head">
        <h2 id="st-title"><i class="fa-solid fa-gear"></i> Settings</h2>
        <nav class="st-tabs" role="tablist">
          <button type="button" class="st-tab" role="tab" data-tab="buttons">Button Assignment</button>
          <button type="button" class="st-tab" role="tab" data-tab="joystick">Joystick</button>
          <button type="button" class="st-tab" role="tab" data-tab="thruster">Thruster</button>
        </nav>
        <button type="button" class="st-close" id="st-close" aria-label="Tutup"><i class="fa-solid fa-xmark"></i></button>
      </header>

      <!-- ===== TAB JOYSTICK ===== -->
      <section class="st-pane" data-pane="joystick">
        <div class="st-joy">

          <div class="st-col">
            <div class="st-block">
              <h3 class="st-h">Status <span class="st-sub" id="st-source"></span></h3>
              <div class="st-status" id="st-status" data-state="off">
                <span class="dot" id="st-dot" data-state="warn"></span>
                <span class="st-status-text" id="st-status-text"></span>
              </div>
              <select class="st-select st-device" id="st-device" aria-label="Pilih joystick" hidden></select>
            </div>

            <div class="st-block">
              <h3 class="st-h">Axis monitor</h3>
              <div class="st-axes" id="st-axes"></div>
            </div>

            <div class="st-block">
              <h3 class="st-h">Buttons</h3>
              <div class="st-btns" id="st-btns"></div>
            </div>
          </div>

          <div class="st-col">
            <div class="st-block">
              <h3 class="st-h">Axis mapping <span class="st-sub">(batang kanan = nilai setelah deadband, exponential, gain)</span></h3>
              ${mapRows}
              <p class="st-warn" id="st-dup" hidden></p>
            </div>

            <div class="st-block">
              <h3 class="st-h">Advanced</h3>
              ${tuneRows}
              <canvas class="st-curve" id="st-curve" aria-label="Kurva respons"></canvas>
            </div>
          </div>

        </div>

        <footer class="st-foot">
          <span class="st-note">Monitor mengikuti sumber yang dipakai (Bridge atau Browser). Pengaturan ini dipakai kedua sumber.</span>
          <span class="st-dirty" id="st-dirty" hidden>Not saved</span>
          <button type="button" class="st-act" id="st-export" title="Simpan pengaturan ke file JSON"><i class="fa-solid fa-file-export"></i> Export</button>
          <button type="button" class="st-act" id="st-import" title="Muat pengaturan dari file JSON"><i class="fa-solid fa-file-import"></i> Import</button>
          <button type="button" class="st-act" id="st-reset"><i class="fa-solid fa-rotate-left"></i> Reset to default</button>
          <button type="button" class="st-act st-primary" id="st-save" disabled><i class="fa-solid fa-floppy-disk"></i> Save</button>
          <input type="file" id="st-file" accept="application/json,.json" hidden />
        </footer>
      </section>

      <!-- ===== TAB THRUSTER (thruster.js) dan BUTTON ASSIGNMENT (buttons.js) ===== -->
      <section class="st-pane" data-pane="thruster" id="st-thruster" hidden></section>
      <section class="st-pane" data-pane="buttons" id="st-buttons" hidden></section>
    </div>`;
}


// ==================== Bantuan tampilan ====================
const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

// Batang dua arah dari tengah: nilai -1..1
function setBar(barEl, v) {
  const fill = barEl.firstElementChild;
  const c = clamp(v, -1, 1);
  fill.style.left = `${c < 0 ? 50 + c * 50 : 50}%`;
  fill.style.width = `${Math.abs(c) * 50}%`;
}

// Nama joystick dari browser biasanya panjang ("... (STANDARD GAMEPAD Vendor: 046d ...)")
const shortName = (id) => id.split(" (")[0] || id;

/**
 * Snapshot joystick dari SUMBER yang dipakai:
 *   Bridge tersambung -> data dari Bridge (nomor tombol sudah nomor QGC, sumbu urutan SDL)
 *   selain itu        -> Gamepad API browser
 * Bentuknya sama dengan readSnapshot() supaya sisa kode tidak perlu tahu bedanya.
 */
function pickSnapshot(cfg) {
  const b = getBridge();
  if (b) {
    const mask = (b.recent ?? b.buttons) | 0;   // "recent": tap singkat tetap terlihat
    return {
      connected: true,
      source: "bridge",
      id: `${b.name || "controller"} (Bridge)`,
      index: 0,
      mapping: "qgc",   // bukan "standard": nomor tombol dipakai apa adanya
      rawAxes: Array.from({ length: 6 }, (_, i) => Number(b.raw?.[i]) || 0),
      buttons: Array.from({ length: 16 }, (_, i) => (mask & (1 << i)) !== 0),
      devices: [],
      rate: b.rate_hz,
    };
  }
  return { ...readSnapshot(cfg), source: "browser" };
}

function selectTab(name) {
  modal.querySelectorAll(".st-tab").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  modal.querySelectorAll(".st-pane").forEach((p) => { p.hidden = p.dataset.pane !== name; });
}

function markDirty() {
  dirty = true;
  ui.dirty.hidden = false;
  ui.save.disabled = false;
  checkDuplicates();
}

function checkDuplicates() {
  const used = {};
  for (const { key, label } of JOY_AXES) {
    const a = draft.axes[key].axis;
    if (a < 0) continue;
    (used[a] ||= []).push(label);
  }
  const dup = Object.entries(used).find(([, names]) => names.length > 1);
  ui.dup.hidden = !dup;
  if (dup) ui.dup.textContent = `Axis ${dup[0]} dipakai oleh: ${dup[1].join(", ")}.`;
}

function updateTuneLabels() {
  TUNES.forEach((t) => {
    setText(modal.querySelector(`[data-tune-val="${t.key}"]`), t.fmt(draft[t.key]));
  });
}

// Isi ulang kontrol (slider, centang) dari draft.
function syncControls() {
  modal.querySelectorAll("[data-inv]").forEach((c) => { c.checked = draft.axes[c.dataset.inv].invert; });
  modal.querySelectorAll("[data-tune]").forEach((r) => { r.value = String(draft[r.dataset.tune]); });
  updateTuneLabels();
  checkDuplicates();
  deviceSig = "";   // paksa daftar axis & pilihan axis dibangun ulang di frame berikutnya
}

// Bangun ulang bagian yang jumlahnya tergantung joystick (axis, tombol, pilihan perangkat).
function ensureDeviceUi(snap) {
  const sig = [snap.connected, snap.source, snap.id, snap.rawAxes.length, snap.buttons.length,
    snap.devices.map((d) => d.id).join("|")].join("#");
  if (sig === deviceSig) return;
  deviceSig = sig;

  // Pilihan perangkat (hanya tampil kalau ada lebih dari satu joystick di browser)
  ui.device.hidden = snap.devices.length < 2;
  ui.device.replaceChildren(...snap.devices.map((d) => {
    const o = document.createElement("option");
    o.value = d.id;
    o.textContent = shortName(d.id);
    return o;
  }));
  ui.device.value = snap.id;

  // Bar axis mentah. Sumber Bridge: beri nama (LX, LY, RX, RY, LT, RT).
  const n = snap.rawAxes.length;
  const axisName = (i) => (snap.source === "bridge" ? BRIDGE_AXIS_NAMES[i] || `S${i}` : `S${i}`);
  ui.axes.innerHTML = n
    ? snap.rawAxes.map((_, i) => `
        <div class="st-axis">
          <span title="Axis ${i}">${axisName(i)}</span>
          <div class="st-bar" data-axis="${i}"><i></i></div>
          <b class="st-val" data-axis-val="${i}">0.00</b>
        </div>`).join("")
    : `<p class="st-sub">Tidak ada axis terdeteksi.</p>`;
  ui.axisBars = [...ui.axes.querySelectorAll("[data-axis]")];
  ui.axisVals = [...ui.axes.querySelectorAll("[data-axis-val]")];

  // Kotak tombol (nomor QGC)
  ui.btns.innerHTML = QGC_BUTTON_LABELS.map((l, i) =>
    `<span class="st-btn" data-btn="${i}" title="${i}: ${l}">${i}</span>`).join("");
  ui.btnEls = [...ui.btns.querySelectorAll("[data-btn]")];

  // Pilihan axis di mapping. Nilai tersimpan di luar jangkauan tetap ditampilkan supaya pengaturan tidak hilang diam-diam.
  modal.querySelectorAll("[data-map]").forEach((sel) => {
    const cur = draft.axes[sel.dataset.map].axis;
    const count = Math.max(n || 6, cur + 1);
    const opts = [`<option value="-1">—</option>`];
    for (let i = 0; i < count; i++) {
      const nm = snap.source === "bridge" && BRIDGE_AXIS_NAMES[i] ? ` ${BRIDGE_AXIS_NAMES[i]}` : "";
      opts.push(`<option value="${i}">Axis ${i}${nm}${n && i >= n ? " (tidak ada)" : ""}</option>`);
    }
    sel.innerHTML = opts.join("");
    sel.value = String(cur);
  });
}


// ==================== Kurva respons ====================
function drawCurve(liveInput) {
  const c = ui.curve;
  const w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return;
  const dpr = devicePixelRatio || 1;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const px = (x) => (x + 1) / 2 * (w - 12) + 6;
  const py = (y) => h / 2 - y * (h / 2 - 6);

  ctx.strokeStyle = "rgba(34,211,238,0.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(-1), py(0)); ctx.lineTo(px(1), py(0));
  ctx.moveTo(px(0), py(-1)); ctx.lineTo(px(0), py(1));
  ctx.stroke();

  // Garis lurus = tanpa pengolahan, sebagai pembanding
  ctx.strokeStyle = "rgba(148,163,184,0.25)";
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(px(-1), py(-1)); ctx.lineTo(px(1), py(1));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) {
    const x = -1 + (i / 80) * 2;
    const y = applyCurve(x, draft);
    if (i === 0) ctx.moveTo(px(x), py(y)); else ctx.lineTo(px(x), py(y));
  }
  ctx.stroke();

  // Titik posisi stick sekarang (dari gerakan yang paling jauh digerakkan)
  if (liveInput !== null) {
    ctx.fillStyle = "#22c55e";
    ctx.beginPath();
    ctx.arc(px(liveInput), py(applyCurve(liveInput, draft)), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}


// ==================== Update tiap frame ====================
function tick() {
  rafId = requestAnimationFrame(tick);
  if (!modal) return;

  const snap = pickSnapshot(draft);
  ensureDeviceUi(snap);

  // Status + sumber
  const problem = snap.source === "browser" ? getGamepadProblem() : null;
  let text, state;
  if (problem) {
    text = problem; state = "error";
  } else if (!snap.connected) {
    text = "Joystick belum terdeteksi. Jalankan Joystick Bridge (disarankan), atau gerakkan stick agar browser mengenalinya.";
    state = "off";
  } else if (snap.source === "bridge") {
    text = `${shortName(snap.id)} · Bridge · ${snap.rawAxes.length} axis · 15 tombol · ${snap.rate} Hz`;
    state = "ok";
  } else {
    text = `${shortName(snap.id)} · Browser · ${snap.rawAxes.length} axis · ${snap.buttons.length} tombol`;
    state = "ok";
  }
  setText(ui.statusText, text);
  setText(ui.source, snap.connected ? `(sumber: ${snap.source === "bridge" ? "Bridge" : "Browser"})` : "");
  ui.statusText.title = snap.id;
  ui.status.dataset.state = state;
  ui.dot.dataset.state = state === "ok" ? "ok" : state === "error" ? "offline" : "warn";

  // Axis & tombol mentah
  ui.axisBars.forEach((bar, i) => {
    const v = snap.rawAxes[i] || 0;
    setBar(bar, v);
    setText(ui.axisVals[i], v.toFixed(2));
  });
  const bmask = buttonMaskQgc(snap);
  ui.btnEls.forEach((el, i) => el.classList.toggle("on", (bmask & (1 << i)) !== 0));

  // Keluaran setelah diolah (memakai draft, jadi efek slider langsung kelihatan)
  const out = processAxes(snap.rawAxes, draft);
  let live = null, liveAbs = 0.02;
  for (const { key } of JOY_AXES) {
    setBar(modal.querySelector(`[data-out-bar="${key}"]`), out[key]);
    setText(modal.querySelector(`[data-out-val="${key}"]`), out[key].toFixed(2));

    const m = draft.axes[key];
    const raw = m.axis >= 0 ? snap.rawAxes[m.axis] : 0;
    const v = Number.isFinite(raw) ? (m.invert ? -raw : raw) : 0;
    if (Math.abs(v) > liveAbs) { liveAbs = Math.abs(v); live = v; }
  }
  drawCurve(live);
}


// ==================== Buka / tutup ====================
function onKey(e) {
  if (e.key === "Escape") closeSettings();
}

function onInput(e) {
  const t = e.target;
  if (t.dataset.map) {
    draft.axes[t.dataset.map].axis = Number(t.value);
    markDirty();
  } else if (t.dataset.inv) {
    draft.axes[t.dataset.inv].invert = t.checked;
    markDirty();
  } else if (t.dataset.tune) {
    draft[t.dataset.tune] = Number(t.value);
    updateTuneLabels();
    markDirty();
  } else if (t.id === "st-device") {
    draft.deviceId = t.value;
    deviceSig = "";
    markDirty();
  }
}

function bindFooter() {
  ui.save.addEventListener("click", () => {
    draft = clone(saveConfig(draft));
    dirty = false;
    ui.dirty.hidden = true;
    ui.save.disabled = true;
    appendLog("[JOY] Pengaturan joystick disimpan.");
  });

  ui.reset.addEventListener("click", () => {
    const keepDevice = draft.deviceId;
    draft = defaultConfig();
    draft.deviceId = keepDevice;
    syncControls();
    markDirty();
  });

  ui.exportBtn.addEventListener("click", () => {
    downloadBlob(new Blob([exportConfigText(draft)], { type: "application/json" }), "ROV_joystick_config.json");
    appendLog("[JOY] Pengaturan di-export: ROV_joystick_config.json");
  });

  ui.importBtn.addEventListener("click", () => ui.file.click());
  ui.file.addEventListener("change", async () => {
    const file = ui.file.files[0];
    ui.file.value = "";
    if (!file) return;
    try {
      draft = parseConfigText(await file.text());
      syncControls();
      markDirty();
      appendLog(`[JOY] Pengaturan dimuat dari ${file.name} (tekan Save untuk menetapkan).`);
    } catch (err) {
      appendLog(`[JOY] Gagal import: ${err.message}`, "error");
    }
  });
}

export function openSettings(tab = "joystick") {
  if (modal) return;
  lastFocus = document.activeElement;
  draft = clone(getConfig());
  dirty = false;
  deviceSig = "";

  modal = document.createElement("div");
  modal.id = "settings-modal";
  modal.innerHTML = template();
  document.body.appendChild(modal);

  ui = {
    status:     $("st-status"),
    statusText: $("st-status-text"),
    source:     $("st-source"),
    dot:        $("st-dot"),
    device:     $("st-device"),
    axes:       $("st-axes"),
    btns:       $("st-btns"),
    dup:        $("st-dup"),
    curve:      $("st-curve"),
    dirty:      $("st-dirty"),
    save:       $("st-save"),
    reset:      $("st-reset"),
    exportBtn:  $("st-export"),
    importBtn:  $("st-import"),
    file:       $("st-file"),
    axisBars: [], axisVals: [], btnEls: [],
  };

  modal.querySelectorAll(".st-tab").forEach((b) =>
    b.addEventListener("click", () => selectTab(b.dataset.tab)));
  $("st-close").addEventListener("click", closeSettings);
  $("st-overlay").addEventListener("click", closeSettings);
  modal.addEventListener("input", onInput);
  modal.addEventListener("change", onInput);
  bindFooter();
  document.addEventListener("keydown", onKey);

  unwatchBridge = watchBridge();
  thruster = mountThrusterTab($("st-thruster"));
  buttonsTab = mountButtonsTab($("st-buttons"));

  selectTab(tab);
  syncControls();
  tick();
  modal.querySelector(".st-tab.active")?.focus();
}

export function closeSettings() {
  if (!modal) return;
  cancelAnimationFrame(rafId);
  document.removeEventListener("keydown", onKey);
  unwatchBridge?.();
  unwatchBridge = null;
  thruster?.destroy();
  thruster = null;
  buttonsTab?.destroy();
  buttonsTab = null;
  modal.remove();
  modal = null;
  ui = null;
  if (dirty) appendLog("[JOY] Perubahan yang belum disimpan dibuang.", "warn");
  lastFocus?.focus?.();
}

export function initSettings() {
  $("settingBtn")?.addEventListener("click", () => openSettings());
}