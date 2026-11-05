//  ./frontend/js/buttons.js
//  buttons.js - Tab "Button Assignment" pada Settings: menentukan fungsi tiap tombol joystick.

//  NOTE:
//  Fungsi tombol TIDAK disimpan di dashboard. Sumber kebenarannya adalah Pixhawk (parameter BTNn_FUNCTION dan BTNn_SFUNCTION), sama seperti halaman Joystick pada QGroundControl. 
//  Modul ini membaca dan menulis parameter tersebut melalui backend (/buttons/*); setiap perubahan dibaca ulang oleh backend dan hasilnya dilaporkan pada field `verified`. 
//  Pada DEV mode (tanpa vehicle) yang diubah adalah tabel simulasi di backend.
//
//  Nomor tombol mengikuti QGC / SDL GameController. Baris tabel menyala saat tombolnya ditekan, sehingga nomor suatu tombol dapat dicari dengan menekannya.
//
//  Pengeditan DIKUNCI jika: Pixhawk belum terhubung, kontrol dimatikan di backend (ROV_ENABLE_CONTROL), vehicle sedang ARMED, atau Drive Control sedang ON. 
//  Tujuannya mencegah fungsi tombol berubah saat vehicle dikendalikan.


import { BACKEND_URL } from "./config.js";
import { appendLog } from "./logger.js";
import { QGC_BUTTON_LABELS, buttonMaskQgc, getConfig, readSnapshot } from "./joystick.js";

const TOKEN_KEY = "rov.controlToken";
const LIVE_MS = 250;   // interval polling status (kunci edit + highlight tombol)

async function api(path, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "text/plain";   // "simple request": tanpa preflight CORS
  let token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch (_) { /* storage diblokir */ }
  if (token) headers["X-ROV-Token"] = token;
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* respons bukan JSON */ }
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


/** Pasang tab ke elemen `root`. Mengembalikan { destroy } untuk membersihkan timer saat Settings ditutup. */
export function mountButtonsTab(root) {
  let rows = [];            // [{ n, f, s, error? }]  f = function, s = shift function
  let functions = [];       // [{ id, name }] daftar fungsi dari backend
  let isDev = false;
  let live = null;          // balasan terakhir /control/status
  let busy = false;
  let destroyed = false;
  let timer = 0;

  root.innerHTML = `
    <div class="bt-wrap">
      <p class="bt-intro st-block">Assign a function to each joystick button. Assignments are stored on the <b>Pixhawk</b>
      (parameters BTNn_FUNCTION / BTNn_SFUNCTION), the same as the QGroundControl Joystick page.
      Press a button on the joystick to highlight its row.
      Editing requires the vehicle to be <b>DISARMED</b> and Drive Control <b>OFF</b>.</p>
      <div class="bt-table st-block">
        <div class="bt-head"><span>#</span><span>Button</span><span>Function</span><span>Shift function</span></div>
        <div class="bt-list" id="bt-list"></div>
      </div>
    </div>
    <footer class="st-foot">
      <span class="st-note bt-msg" id="bt-msg"></span>
      <button type="button" class="st-act st-primary" id="bt-read" title="Reload all button functions from the Pixhawk"><i class="fa-solid fa-rotate"></i> Read from Pixhawk</button>
    </footer>`;

  const $q = (sel) => root.querySelector(sel);
  const listEl = $q("#bt-list");
  const msgEl = $q("#bt-msg");
  const say = (text, level = "") => { msgEl.textContent = text; msgEl.dataset.level = level; };

  const nameOf = (id) => functions.find((f) => f.id === id)?.name;

  function optionsFor(current) {
    const opts = functions.map((f) => `<option value="${f.id}">${f.name} (${f.id})</option>`);
    if (current != null && !nameOf(current)) {
      opts.push(`<option value="${current}">function #${current}</option>`);
    }
    opts.push(`<option value="custom">Other number…</option>`);
    return opts.join("");
  }

  /** Alasan pengeditan terkunci, atau string kosong jika boleh diedit. */
  function lockReason() {
    if (!live) return "Backend unreachable";
    if (!live.available) return "Control is disabled on the backend (ROV_ENABLE_CONTROL=1)";
    if (!live.connected) return "Pixhawk is not connected";
    if (live.active) return "Turn Drive Control OFF first";
    if (live.armed) return "Disarm the vehicle first";
    if (busy) return "Waiting for the previous operation";
    return "";
  }

  function build() {
    listEl.innerHTML = rows.map((r) => `
      <div class="bt-row" data-row="${r.n}">
        <span class="bt-num">${r.n}</span>
        <span class="bt-lbl">${QGC_BUTTON_LABELS[r.n] || ""}</span>
        <select class="bt-sel" data-n="${r.n}" data-kind="f" aria-label="Function of button ${r.n}">${optionsFor(r.f)}</select>
        <select class="bt-sel" data-n="${r.n}" data-kind="s" aria-label="Shift function of button ${r.n}">${optionsFor(r.s)}</select>
      </div>`).join("");
    refresh();
  }

  /** Sinkronkan nilai dropdown dan status kunci (dipanggil sering, ringan). */
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

  /** Sorot baris tombol yang sedang ditekan (dari Bridge jika aktif, selain itu dari browser). */
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
      build();
      const failed = rows.filter((r) => r.error);
      if (failed.length) {
        say(`Some buttons could not be read (${shorten(failed[0].error, 60)}).`, "error");
      } else if (!quiet) {
        say(isDev ? "Button functions loaded (DEV simulation table)." : "Button functions loaded from the Pixhawk.", "ok");
        appendLog("[BUTTON] Fungsi tombol dibaca" + (isDev ? " (tabel simulasi DEV)" : " dari Pixhawk"));
      }
    } catch (e) {
      console.error("[BUTTON] Gagal membaca:", e.message, e.data ?? "", e);
      say(`Read failed: ${shorten(e.message)}`, "error");
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
      const line = `Button ${n}${shifted ? " (shift)" : ""}: ${nameOf(oldId) ?? oldId} → ${nameOf(r.new) ?? r.new}`;
      if (r.verified) {
        say(`${line}. Verified by read-back.`, "ok");
        appendLog(`[BUTTON] ${line} (terverifikasi)`);
      } else {
        say(`${line}: read-back does not match the requested value. Check the Pixhawk.`, "error");
        appendLog(`[BUTTON] ${line} — verifikasi GAGAL`, "error");
      }
    } catch (e) {
      console.error("[BUTTON] Gagal mengubah:", e.message, e.data ?? "", e);
      say(`Button ${n}: ${shorten(e.message)}`, "error");
      appendLog(`[BUTTON] Tombol ${n}: ${shorten(e.message)}`, "error");
    }
    busy = false;
    if (!destroyed) build();
  }

  listEl.addEventListener("change", (e) => {
    const sel = e.target.closest("select");
    if (!sel || sel.disabled) return;
    const n = Number(sel.dataset.n);
    const shifted = sel.dataset.kind === "s";
    let fid;
    if (sel.value === "custom") {
      const v = prompt("Function number (0-255).\nSee the BTNn_FUNCTION table in the ArduSub documentation, or parameter BTN0_FUNCTION in QGroundControl.");
      fid = v == null || v.trim() === "" ? NaN : Number(v);
      if (!Number.isInteger(fid) || fid < 0 || fid > 255) {
        say("Invalid function number (must be an integer between 0 and 255).", "error");
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