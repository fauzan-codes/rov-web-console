//  ./frontend/js/thruster.js
//  thruster.js - isi tab THRUSTER di popup Settings: arah putar 6 motor (Reverse), Motor Test, backup, history.

//  NOTE:
//  Sumber kebenaran arah putar = PIXHAWK (parameter MOT_n_DIRECTION). 
//  Modul ini tidak menyimpan "arah" sendiri: selalu membaca dari backend, dan setiap perubahan DIBACA ULANG oleh backend dari Pixhawk (field `verified`). 
//  Yang disimpan di browser hanya history perubahan.
//
//  Jalur: browser -> backend (/motors/...) -> mavlink-routerd (UDP 14560) -> Pixhawk.
//
//  ATURAN KUNCI TOMBOL (dua kelompok, kebalikan satu sama lain):
//    - Tulis parameter (Reverse, Undo, Restore)  : hanya saat DISARMED. Saat ARMED -> disable.
//    - Motor Test (memutar baling-baling)        : hanya saat ARMED.    Saat DISARMED -> disable.
//      Alasan: Pixhawk menolak motor test kalau robot belum armed (MAV_RESULT_FAILED).
//      CATATAN FIRMWARE ArduSub: setelah test selesai Pixhawk DISARM sendiri dan menolak test baru selama 10 detik. Jadi setelah Test: arm ulang, tunggu cooldown (tombol Test dikunci sementara).
//  Keduanya juga mati kalau: Pixhawk belum terhubung, kontrol dimatikan di backend (ROV_ENABLE_CONTROL), atau ada operasi yang sedang berjalan.
//
//  PESAN ERROR: log di panel DATA LOG dipotong (LOG_MAX_CHARS); pesan lengkap dari Pixhawk selalu dicetak ke Console browser (F12).


import { BACKEND_URL } from "./config.js";
import { appendLog } from "./logger.js";
import { downloadBlob } from "./storage.js";
import { getLastTelemetry } from "./telemetry.js";
import { stamp } from "./util.js";

const MOTORS = [1, 2, 3, 4, 5, 6];
const HISTORY_KEY = "rov.motor.history";
const HISTORY_MAX = 30;
const LOG_MAX_CHARS = 90;   // panjang maksimal pesan error di log / baris status
const dirText = (v) => (v === 1 ? "Normal" : v === -1 ? "Reverse" : "?");

// Potong teks panjang supaya muat di log. Versi lengkap tetap dicetak ke console.
function shorten(text, max = LOG_MAX_CHARS) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Ambil pesan paling informatif dari respons backend.
// Urutan: teks STATUSTEXT dari Pixhawk (kalau backend menyertakan) > field error > HTTP status.
// Nama field yang dicoba: pixhawk_text, statustext, pixhawk_messages, detail.
function describeError(data, status) {
  const pick = (v) => (Array.isArray(v) ? v.filter(Boolean).join(" | ") : v);
  const fromPixhawk = pick(data.pixhawk_text) || pick(data.statustext) ||
    pick(data.pixhawk_messages) || pick(data.detail);
  const base = data.error || data.result_text || (status ? `HTTP ${status}` : "gagal");
  return fromPixhawk ? `${fromPixhawk} [${base}]` : String(base);
}

// ===== Panggilan ke backend =====
async function api(path, { method = "GET", body, timeoutMs = 8000 } = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* bukan JSON */ }
  if (!res.ok || data.ok === false) {
    const err = new Error(describeError(data, res.status));
    err.data = data;       // respons mentah, dicetak ke console
    err.path = path;
    throw err;
  }
  return data;
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch (_) { return []; }
}
function saveHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_MAX))); } catch (_) { /* diblokir */ }
}


export function mountThrusterTab(root) {
  // ===== State =====
  let dirs = {};
  let control = { enabled: false };
  let backup = null;
  let history = loadHistory();
  let busy = false;
  let timer = 0;
  let destroyed = false;

  const cards = MOTORS.map((n) => `
    <div class="th-card" data-card="${n}">
      <div class="th-card-top">
        <b>Motor ${n}</b>
        <span class="th-pwm">PWM <b data-pwm="${n}">----</b></span>
      </div>
      <div class="th-dir" data-dir="${n}">?</div>
      <div class="th-diff" data-diff="${n}" hidden></div>
      <div class="th-card-btns">
        <button type="button" class="st-act" data-flip="${n}"><i class="fa-solid fa-arrows-rotate"></i> Reverse</button>
        <button type="button" class="st-act th-test" data-test="${n}"><i class="fa-solid fa-fan"></i> Test</button>
      </div>
    </div>`).join("");

  root.innerHTML = `
    <div class="th-wrap">
      <div class="th-banner" role="alert">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span><b>Test</b> memutar baling-baling dan hanya bisa saat robot <b>ARMED</b>. <b>Reverse</b> hanya bisa saat <b>DISARMED</b>. Lakukan di luar air dan pastikan motor bebas, tidak menyentuh apa pun.</span>
      </div>

      <div class="th-statusrow">
        <span class="th-pill" data-s="link">Pixhawk: --</span>
        <span class="th-pill" data-s="armed">Armed: --</span>
        <span class="th-pill" data-s="ctrl">Control: --</span>
        <label class="th-opt">Power
          <select class="st-select" id="th-pct"><option>5</option><option selected>10</option><option>15</option><option>20</option><option>30</option></select> %
        </label>
        <label class="th-opt">Duration
          <select class="st-select" id="th-sec"><option>1</option><option selected>2</option><option>3</option></select> s
        </label>
        <button type="button" class="st-act" id="th-read"><i class="fa-solid fa-rotate"></i> Read from Pixhawk</button>
      </div>

      <div class="th-grid">${cards}</div>

      <div class="th-bottom">
        <div class="th-hist-box">
          <span class="st-h">History</span>
          <div class="th-hist" id="th-hist"></div>
        </div>
        <div class="th-actions">
          <button type="button" class="st-act" id="th-undo"><i class="fa-solid fa-rotate-left"></i> Undo last change</button>
          <button type="button" class="st-act" id="th-backup"><i class="fa-solid fa-file-export"></i> Backup to file</button>
          <button type="button" class="st-act" id="th-compare"><i class="fa-solid fa-code-compare"></i> Compare with file</button>
          <button type="button" class="st-act st-primary" id="th-apply" hidden><i class="fa-solid fa-check"></i> Restore backup</button>
          <input type="file" id="th-file" accept="application/json,.json" hidden />
        </div>
      </div>
      <p class="st-note th-msg" id="th-msg"></p>
    </div>`;

  const $q = (sel) => root.querySelector(sel);
  const msgEl = $q("#th-msg");
  const say = (text, level = "") => {
    msgEl.textContent = text;
    msgEl.dataset.level = level;
  };

  // ===== Kunci tombol =====
  // Syarat umum (dipakai dua kelompok tombol).
  function baseLock() {
    const t = getLastTelemetry();
    if (!t || !t.mavlink_connected) return "Pixhawk belum terhubung";
    if (!control.enabled) return "Control dimatikan di backend (ROV_ENABLE_CONTROL=1)";
    if (busy) return "Menunggu operasi sebelumnya";
    return "";
  }

  // Tulis parameter (Reverse / Undo / Restore): harus DISARMED.
  function writeLock() {
    const base = baseLock();
    if (base) return base;
    if (getLastTelemetry().armed) return "Disarm dulu — arah motor tidak boleh diubah saat ARMED";
    return "";
  }

  let testCooldownUntil = 0;   // ms epoch; cooldown 10 detik firmware setelah test

  function testLock() {
    const base = baseLock();
    if (base) return base;
    const left = Math.ceil((testCooldownUntil - Date.now()) / 1000);
    if (left > 0) return `Cooldown firmware: tunggu ${left} dtk, lalu arm ulang`;
    const t = getLastTelemetry();
    if (t.armed === undefined) return "Status armed belum diketahui dari telemetri";
    if (!t.armed) return "Arm robot dulu — motor test hanya jalan saat ARMED";
    return "";
  }

  function mismatches() {
    if (!backup) return [];
    return MOTORS.filter((n) => dirs[n] != null && backup[n] != null && dirs[n] !== backup[n]);
  }

  function render() {
    const t = getLastTelemetry();
    const linked = !!t?.mavlink_connected;
    const armed = !!t?.armed;

    const pill = (key, text, state) => {
      const el = $q(`[data-s="${key}"]`);
      el.textContent = text;
      el.dataset.state = state;
    };
    pill("link", `Pixhawk: ${linked ? "Connected" : "Disconnected"}`, linked ? "ok" : "bad");
    pill("armed", `Armed: ${t ? (armed ? "YES" : "NO") : "--"}`, armed ? "bad" : "ok");
    pill("ctrl", `Control: ${control.enabled ? "Enabled" : "Disabled"}`, control.enabled ? "ok" : "warn");

    const wLock = writeLock();
    const tLock = testLock();
    const diffs = mismatches();

    MOTORS.forEach((n) => {
      const v = dirs[n];
      const dirEl = $q(`[data-dir="${n}"]`);
      dirEl.textContent = dirText(v);
      dirEl.dataset.state = v === 1 ? "normal" : v === -1 ? "rev" : "unknown";

      const pwm = t?.pwm?.[`PWM${n}`];
      $q(`[data-pwm="${n}"]`).textContent = Number.isFinite(pwm) ? Math.round(pwm) : "----";

      const diffEl = $q(`[data-diff="${n}"]`);
      const differs = diffs.includes(n);
      diffEl.hidden = !differs;
      if (differs) diffEl.textContent = `Differs from backup (backup: ${dirText(backup[n])})`;
      $q(`[data-card="${n}"]`).classList.toggle("differs", differs);

      const flip = $q(`[data-flip="${n}"]`);
      flip.disabled = !!wLock || (v !== 1 && v !== -1);
      flip.title = wLock || (v == null ? "Read from Pixhawk dulu" : "");
      const test = $q(`[data-test="${n}"]`);
      test.disabled = !!tLock;
      test.title = tLock;
    });

    $q("#th-read").disabled = !linked || busy;
    $q("#th-undo").disabled = !!wLock || history.length === 0;
    $q("#th-undo").title = wLock || (history.length ? "" : "Belum ada perubahan");
    const apply = $q("#th-apply");
    apply.hidden = diffs.length === 0;
    apply.disabled = !!wLock;
    apply.title = wLock;
    $q("#th-compare").disabled = false;
    $q("#th-backup").disabled = MOTORS.some((n) => dirs[n] == null);
    $q("#th-backup").title = $q("#th-backup").disabled ? "Read from Pixhawk dulu" : "";

    const hist = $q("#th-hist");
    const rows = history.slice(-4).reverse().map((h) => {
      const time = new Date(h.t).toLocaleTimeString("en-GB", { hour12: false });
      return `<div>${time} · Motor ${h.n}: ${dirText(h.old)} → ${dirText(h.new)} <i>(${h.src})</i></div>`;
    });
    const html = rows.join("") || `<div class="st-sub">Belum ada perubahan.</div>`;
    if (hist.innerHTML !== html) hist.innerHTML = html;
  }

  // ===== Operasi =====
  // Error ditampilkan versi pendek (status + log), versi lengkap ke console.
  function reportError(prefix, e) {
    console.error(`[MOTOR] ${prefix}: ${e.message}`, e.data ?? "", e);
    const short = shorten(e.message);
    const hinted = short.length < e.message.length ? `${short} (detail di Console)` : short;
    say(`${prefix}: ${hinted}`, "error");
    appendLog(`[MOTOR] ${prefix}: ${short}`, "error");
  }

  async function guarded(fn, label = "Gagal") {
    if (busy) return;
    busy = true;
    render();
    try { await fn(); } catch (e) { reportError(label, e); }
    busy = false;
    if (!destroyed) render();
  }

  async function readAll(quiet = false) {
    const data = await api("/motors/directions", { timeoutMs: 20000 });
    control.enabled = !!data.control_enabled;
    const failed = [];
    data.motors.forEach((m) => {
      dirs[m.n] = m.value === 1 || m.value === -1 ? m.value : null;
      if (m.value == null) failed.push(`${m.n} (${m.error || "gagal"})`);
    });
    if (failed.length) {
      console.warn("[MOTOR] Motor tidak terbaca:", failed.join(", "), data);
      say(`Motor ${shorten(failed.join(", "), 60)} tidak terbaca. Cek nama parameter di firmware.`, "error");
    } else if (!quiet) {
      say("Arah putar dibaca dari Pixhawk.", "ok");
      appendLog("[MOTOR] Arah putar dibaca: " + MOTORS.map((n) => `${n}=${dirText(dirs[n])}`).join(" "));
    }
  }

  async function setDirection(n, direction, src) {
    const old = dirs[n];
    const r = await api(`/motors/${n}/direction`, { method: "POST", body: { direction } });
    dirs[n] = r.new === 1 || r.new === -1 ? r.new : null;
    history.push({ t: Date.now(), n, old: r.old, new: r.new, src });
    saveHistory(history);
    const line = `Motor ${n}: ${dirText(r.old)} → ${dirText(r.new)}`;
    if (r.verified) {
      say(`${line}. Verified: dibaca ulang dari Pixhawk.`, "ok");
      appendLog(`[MOTOR] ${line} (verified, ${src})`);
    } else {
      say(`${line} TIDAK sesuai permintaan (diminta ${dirText(direction)}). Periksa Pixhawk.`, "error");
      appendLog(`[MOTOR] ${line} — GAGAL verify (diminta ${dirText(direction)}, sebelumnya ${dirText(old)})`, "error");
    }
    return r.verified;
  }

  // ===== Event =====
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;

    if (btn.dataset.flip) {
      const n = Number(btn.dataset.flip);
      guarded(() => setDirection(n, -dirs[n], "manual"), `Reverse motor ${n} gagal`);

    } else if (btn.dataset.test) {
      const n = Number(btn.dataset.test);
      const pct = Number($q("#th-pct").value), sec = Number($q("#th-sec").value);
      if (!confirm(`Robot ARMED. Motor ${n} akan berputar ${pct}% selama ${sec} detik.\nBaling-baling aman / sudah dilepas?`)) return;
      guarded(async () => {
        const r = await api(`/motors/${n}/test`, { method: "POST", body: { percent: pct, seconds: sec } });
        testCooldownUntil = Date.now() + (Number(r.cooldown) || 10) * 1000;
        setTimeout(render, ((Number(r.cooldown) || 10) * 1000) + 100);
        render();
        say(`Test motor ${n}: ${r.result_text} (${r.percent}%, ${r.seconds} s). Pixhawk akan DISARM sendiri setelah test (normal). Arm ulang setelah 10 dtk.`, "ok");
        appendLog(`[MOTOR] Test motor ${n}: ${r.percent}% ${r.seconds}s → ${r.result_text}`);
      }, `Test motor ${n} ditolak`);

    } else if (btn.id === "th-read") {
      guarded(() => readAll(), "Read gagal");

    } else if (btn.id === "th-undo") {
      const last = history[history.length - 1];
      if (!last || !confirm(`Kembalikan Motor ${last.n} ke ${dirText(last.old)}?`)) return;
      guarded(() => setDirection(last.n, last.old, "undo"), "Undo gagal");

    } else if (btn.id === "th-backup") {
      const out = { version: 1, saved: new Date().toISOString(),
        directions: Object.fromEntries(MOTORS.map((n) => [String(n), dirs[n]])) };
      const name = `ROV_motor_backup_${stamp()}.json`;
      downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), name);
      say(`Backup disimpan: ${name}`, "ok");
      appendLog(`[MOTOR] Backup arah putar disimpan: ${name}`);

    } else if (btn.id === "th-compare") {
      $q("#th-file").click();

    } else if (btn.id === "th-apply") {
      const diffs = mismatches();
      const list = diffs.map((n) => `Motor ${n}: ${dirText(dirs[n])} → ${dirText(backup[n])}`).join("\n");
      if (!confirm(`Restore backup ke Pixhawk?\n\n${list}`)) return;
      guarded(async () => {
        let okCount = 0;
        for (const n of diffs) if (await setDirection(n, backup[n], "restore")) okCount++;
        say(`Backup diterapkan: ${okCount} dari ${diffs.length} motor verified sesuai.`, okCount === diffs.length ? "ok" : "error");
      }, "Restore gagal");
    }
  });

  $q("#th-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      const d = j.directions;
      if (!d || typeof d !== "object") throw new Error("bukan file backup motor");
      backup = {};
      MOTORS.forEach((n) => { backup[n] = d[String(n)] === 1 || d[String(n)] === -1 ? d[String(n)] : null; });
      const diffs = mismatches();
      say(diffs.length
        ? `${diffs.length} motor berbeda dari backup (motor ${diffs.join(", ")}).`
        : "Semua motor SAMA dengan backup.", diffs.length ? "error" : "ok");
      appendLog(`[MOTOR] Compare dengan ${file.name}: ${diffs.length ? `beda di motor ${diffs.join(", ")}` : "sama semua"}`);
      render();
    } catch (err) {
      console.error("[MOTOR] Gagal membaca backup:", err);
      say(`Gagal membaca backup: ${shorten(err.message, 60)}`, "error");
    }
  });

  // PWM, status armed, dan terhubung ikut telemetri yang sudah di-poll telemetry.js
  timer = setInterval(render, 250);
  render();
  if (getLastTelemetry()?.mavlink_connected) guarded(() => readAll(true), "Read gagal");

  return {
    destroy() {
      destroyed = true;
      clearInterval(timer);
    },
  };
}