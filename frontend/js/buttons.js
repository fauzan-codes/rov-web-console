//  ./frontend/js/buttons.js
//  buttons.js - isi tab BUTTON ASSIGNMENT di popup Settings: pilih fungsi tiap tombol joystick (seperti halaman Joystick QGC).

//  NOTE:
//  Fungsi tombol TIDAK disimpan di web. Sumber kebenarannya = PIXHAWK (parameter BTNn_FUNCTION dan BTNn_SFUNCTION),
//  sama persis dengan yang diatur QGC. Modul ini membaca dan menulis parameter itu lewat backend, dan setiap
//  perubahan DIBACA ULANG oleh backend (field `verified`).
//  Di mode DEV (tanpa robot) yang diubah adalah tabel simulasi di backend, jadi bisa dites di laptop.
//
//  Nomor tombol = nomor di QGC (urutan SDL GameController). Baris menyala saat tombolnya ditekan, jadi
//  cara cari nomor tombol: tekan tombolnya dan lihat baris mana yang menyala.
//
//  Terkunci kalau: Pixhawk belum terhubung, kontrol dimatikan di backend (ROV_ENABLE_CONTROL), robot ARMED,
//  atau Drive Control sedang ON (supaya tombol tidak berubah fungsi saat robot dikendalikan).


import { BACKEND_URL } from "./config.js";
import { appendLog } from "./logger.js";
import { QGC_BUTTON_LABELS, buttonMaskQgc, getConfig, readSnapshot } from "./joystick.js";

const TOKEN_KEY = "rov.controlToken";
const LIVE_MS = 250;

async function api(path, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "text/plain";   // simple request, tanpa preflight
  let token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { /* diblokir */ }
  if (token) headers["X-ROV-Token"] = token;
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* bukan JSON */ }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

const shorten = (t, max = 90) => {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};


export function mountButtonsTab(root) {
  let rows = [];            // [{n, f, s, error?}]
  let functions = [];       // [{id, name}]
  let isDev = false;
  let live = null;          // balasan terakhir /control/status
  let busy = false;
  let destroyed = false;
  let loaded = false;
  let timer = 0;

  root.innerHTML = `
    <div class="bt-wrap">
      <p class="bt-intro st-block">Atur fungsi tiap tombol joystick. Tersimpan di <b>Pixhawk</b> (sama dengan halaman Joystick di QGC).
      Tekan tombol di joystick: barisnya menyala, jadi gampang cari nomornya.
      Hanya bisa diubah saat robot <b>DISARMED</b> dan Drive Control <b>OFF</b>.</p>
      <div class="bt-table st-block">
        <div class="bt-head"><span>#</span><span>Button</span><span>Function</span><span>Shift function</span></div>
        <div class="bt-list" id="bt-list"></div>
      </div>
    </div>
    <footer class="st-foot">
      <span class="st-note bt-msg" id="bt-msg"></span>
      <button type="button" class="st-act st-primary" id="bt-read"><i class="fa-solid fa-rotate"></i> Read from Pixhawk</button>
    </footer>`;

  const $q = (sel) => root.querySelector(sel);
  const listEl = $q("#bt-list");
  const msgEl = $q("#bt-msg");
  const say = (text, level = "") => { msgEl.textContent = text; msgEl.dataset.level = level; };

  const nameOf = (id) => functions.find((f) => f.id === id)?.name;

  function optionsFor(current) {
    const opts = functions.map((f) => `<option value="${f.id}">${f.name} (${f.id})</option>`);
    if (current != null && !nameOf(current)) {
      opts.push(`<option value="${current}">fungsi nomor ${current}</option>`);
    }
    opts.push(`<option value="custom">Nomor lain…</option>`);
    return opts.join("");
  }

  function lockReason() {
    if (!live) return "Backend tidak terjangkau";
    if (!live.available) return "Kontrol dimatikan di backend (ROV_ENABLE_CONTROL=1)";
    if (!live.connected) return "Pixhawk belum terhubung";
    if (live.active) return "Matikan Drive Control dulu";
    if (live.armed) return "Disarm dulu";
    if (busy) return "Menunggu operasi sebelumnya";
    return "";
  }

  function build() {
    listEl.innerHTML = rows.map((r) => `
      <div class="bt-row" data-row="${r.n}">
        <span class="bt-num">${r.n}</span>
        <span class="bt-lbl">${QGC_BUTTON_LABELS[r.n] || ""}</span>
        <select class="bt-sel" data-n="${r.n}" data-kind="f" aria-label="Fungsi tombol ${r.n}">${optionsFor(r.f)}</select>
        <select class="bt-sel" data-n="${r.n}" data-kind="s" aria-label="Fungsi shift tombol ${r.n}">${optionsFor(r.s)}</select>
      </div>`).join("");
    refresh();
  }

  // Sinkronkan nilai pilihan + status kunci (dipanggil sering, ringan)
  function refresh() {
    const lock = lockReason();
    rows.forEach((r) => {
      const f = listEl.querySelector(`select[data-n="${r.n}"][data-kind="f"]`);
      const s = listEl.querySelector(`select[data-n="${r.n}"][data-kind="s"]`);
      if (!f || !s) return;
      if (document.activeElement !== f && r.f != null) f.value = String(r.f);
      if (document.activeElement !== s && r.s != null) s.value = String(r.s);
      f.disabled = s.disabled = !!lock || r.f == null;
      f.title = s.title = lock || (r.error ? r.error : "");
    });
    $q("#bt-read").disabled = !live || busy;
  }

  function highlight() {
    let mask = 0;
    if (live?.bridge?.connected) mask = (live.bridge.recent ?? live.bridge.buttons) | 0;
    else {
      const snap = readSnapshot(getConfig());
      if (snap.connected) mask = buttonMaskQgc(snap);
    }
    listEl.querySelectorAll(".bt-row").forEach((el) => {
      el.classList.toggle("on", (mask & (1 << Number(el.dataset.row))) !== 0);
    });
  }

  async function pollLive() {
    try {
      live = await api("/control/status", { timeoutMs: 1500 });
    } catch (_) {
      live = null;
    }
    if (destroyed) return;
    highlight();
    refresh();
  }

  async function readAll(quiet = false) {
    busy = true; refresh();
    try {
      const data = await api("/buttons/functions");
      rows = data.buttons;
      functions = data.functions;
      isDev = !!data.dev;
      loaded = true;
      build();
      const failed = rows.filter((r) => r.error);
      if (failed.length) {
        say(`Sebagian tombol tidak terbaca (${shorten(failed[0].error, 60)}).`, "error");
      } else if (!quiet) {
        say(isDev ? "Tabel fungsi tombol (simulasi DEV) dibaca." : "Fungsi tombol dibaca dari Pixhawk.", "ok");
        appendLog("[BUTTON] Fungsi tombol dibaca" + (isDev ? " (simulasi DEV)" : " dari Pixhawk"));
      }
    } catch (e) {
      console.error("[BUTTON] Gagal membaca:", e.message, e.data ?? "", e);
      say(`Gagal membaca: ${shorten(e.message)}`, "error");
    }
    busy = false;
    if (!destroyed) refresh();
  }

  async function setFunction(n, shifted, fid) {
    busy = true; refresh();
    const row = rows.find((r) => r.n === n);
    const oldId = shifted ? row.s : row.f;
    try {
      const r = await api(`/buttons/${n}/function`, { method: "POST", body: { function: fid, shifted }, timeoutMs: 15000 });
      if (shifted) row.s = r.new; else row.f = r.new;
      const line = `Tombol ${n}${shifted ? " (shift)" : ""}: ${nameOf(oldId) ?? oldId} → ${nameOf(r.new) ?? r.new}`;
      if (r.verified) {
        say(`${line}. Verified: dibaca ulang.`, "ok");
        appendLog(`[BUTTON] ${line} (verified)`);
      } else {
        say(`${line} TIDAK sesuai permintaan. Periksa Pixhawk.`, "error");
        appendLog(`[BUTTON] ${line} — GAGAL verify`, "error");
      }
    } catch (e) {
      console.error("[BUTTON] Gagal mengubah:", e.message, e.data ?? "", e);
      say(`Tombol ${n}: ${shorten(e.message)}`, "error");
      appendLog(`[BUTTON] Tombol ${n}: ${shorten(e.message)}`, "error");
    }
    busy = false;
    if (!destroyed) { build(); }
  }

  listEl.addEventListener("change", (e) => {
    const sel = e.target.closest("select");
    if (!sel || sel.disabled) return;
    const n = Number(sel.dataset.n);
    const shifted = sel.dataset.kind === "s";
    let fid;
    if (sel.value === "custom") {
      const v = prompt("Nomor fungsi (0-255).\nLihat tabel BTNn_FUNCTION di dokumentasi ArduSub, atau parameter BTN0_FUNCTION di QGC.");
      fid = v == null || v.trim() === "" ? NaN : Number(v);
      if (!Number.isInteger(fid) || fid < 0 || fid > 255) {
        say("Nomor fungsi tidak valid (harus bilangan bulat 0-255).", "error");
        build();
        return;
      }
    } else {
      fid = Number(sel.value);
    }
    setFunction(n, shifted, fid);
  });

  $q("#bt-read").addEventListener("click", () => readAll());

  timer = setInterval(pollLive, LIVE_MS);
  pollLive().then(() => readAll(true));

  return {
    destroy() {
      destroyed = true;
      clearInterval(timer);
    },
  };
}