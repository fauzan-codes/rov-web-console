//  ./frontend/js/thruster.js
//  thruster.js - isi tab THRUSTER di popup Pengaturan: arah putar 6 motor, Test motor, cadangan, riwayat.

//  NOTE:
//  Sumber kebenaran arah putar = PIXHAWK (parameter MOT_n_DIRECTION). Modul ini tidak menyimpan
//  "arah" sendiri: selalu membaca dari backend, dan setiap perubahan DIBACA ULANG oleh backend
//  dari Pixhawk (field `verified`). Yang disimpan di browser hanya riwayat perubahan.
//
//  Jalur: browser -> backend (/motors/...) -> mavlink-routerd (UDP 14560) -> Pixhawk.
//  Tombol yang menulis ke robot mati kalau: Pixhawk belum terhubung, robot ARMED, kontrol
//  dimatikan di backend (ROV_ENABLE_CONTROL), atau ada operasi yang sedang berjalan.


import { BACKEND_URL } from "./config.js";
import { appendLog } from "./logger.js";
import { downloadBlob } from "./storage.js";
import { getLastTelemetry } from "./telemetry.js";
import { stamp } from "./util.js";

const MOTORS = [1, 2, 3, 4, 5, 6];
const HISTORY_KEY = "rov.motor.history";
const HISTORY_MAX = 30;
const dirText = (v) => (v === 1 ? "Normal" : v === -1 ? "Reverse" : "?");

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
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
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
        <button type="button" class="st-act" data-flip="${n}"><i class="fa-solid fa-arrows-rotate"></i> Balik arah</button>
        <button type="button" class="st-act th-test" data-test="${n}"><i class="fa-solid fa-fan"></i> Test</button>
      </div>
    </div>`).join("");

  root.innerHTML = `
    <div class="th-wrap">
      <div class="th-banner" role="alert">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>Tombol <b>Test</b> memutar baling-baling. Lakukan saat robot berada di luar air dan motor bebas atau motor tidak menyentuh apapun.</span>
      </div>

      <div class="th-statusrow">
        <span class="th-pill" data-s="link">Pixhawk: --</span>
        <span class="th-pill" data-s="armed">Armed: --</span>
        <span class="th-pill" data-s="ctrl">Kontrol: --</span>
        <label class="th-opt">Power
          <select class="st-select" id="th-pct"><option>5</option><option selected>10</option><option>15</option><option>20</option><option>30</option></select> %
        </label>
        <label class="th-opt">Durasi
          <select class="st-select" id="th-sec"><option>1</option><option selected>2</option><option>3</option></select> dtk
        </label>
        <button type="button" class="st-act" id="th-read"><i class="fa-solid fa-rotate"></i> Baca dari Pixhawk</button>
      </div>

      <div class="th-grid">${cards}</div>

      <div class="th-bottom">
        <div class="th-hist-box">
          <span class="st-h">Riwayat perubahan</span>
          <div class="th-hist" id="th-hist"></div>
        </div>
        <div class="th-actions">
          <button type="button" class="st-act" id="th-undo"><i class="fa-solid fa-rotate-left"></i> Batalkan perubahan terakhir</button>
          <button type="button" class="st-act" id="th-backup"><i class="fa-solid fa-file-export"></i> Cadangkan ke file</button>
          <button type="button" class="st-act" id="th-compare"><i class="fa-solid fa-code-compare"></i> Bandingkan dengan file</button>
          <button type="button" class="st-act st-primary" id="th-apply" hidden><i class="fa-solid fa-check"></i> Terapkan cadangan</button>
          <input type="file" id="th-file" accept="application/json,.json" hidden />
        </div>
      </div>
      <p class="st-note th-msg" id="th-msg"></p>
    </div>`;

  const $q = (sel) => root.querySelector(sel);
  const $all = (sel) => [...root.querySelectorAll(sel)];
  const msgEl = $q("#th-msg");
  const say = (text, level = "") => {
    msgEl.textContent = text;
    msgEl.dataset.level = level;
  };

  // ===== Tampilan =====
  function whyLocked() {
    const t = getLastTelemetry();
    if (!t || !t.mavlink_connected) return "Pixhawk belum terhubung";
    if (t.armed) return "Robot sedang ARMED";
    if (!control.enabled) return "Kontrol dimatikan di backend (ROV_ENABLE_CONTROL=1)";
    if (busy) return "Menunggu operasi sebelumnya";
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
    pill("link", `Pixhawk: ${linked ? "terhubung" : "tidak terhubung"}`, linked ? "ok" : "bad");
    pill("armed", `Armed: ${t ? (armed ? "YA" : "tidak") : "--"}`, armed ? "bad" : "ok");
    pill("ctrl", `Kontrol: ${control.enabled ? "aktif" : "dimatikan"}`, control.enabled ? "ok" : "warn");

    const lock = whyLocked();
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
      if (differs) diffEl.textContent = `Beda dari cadangan (cadangan: ${dirText(backup[n])})`;
      $q(`[data-card="${n}"]`).classList.toggle("differs", differs);

      const flip = $q(`[data-flip="${n}"]`);
      flip.disabled = !!lock || (v !== 1 && v !== -1);
      flip.title = lock || (v == null ? "Baca dari Pixhawk dulu" : "");
      const test = $q(`[data-test="${n}"]`);
      test.disabled = !!lock;
      test.title = lock;
    });

    $q("#th-read").disabled = !linked || busy;
    $q("#th-undo").disabled = !!lock || history.length === 0;
    $q("#th-undo").title = lock || (history.length ? "" : "Belum ada perubahan");
    const apply = $q("#th-apply");
    apply.hidden = diffs.length === 0;
    apply.disabled = !!lock;
    apply.title = lock;
    $q("#th-compare").disabled = false;
    $q("#th-backup").disabled = MOTORS.some((n) => dirs[n] == null);
    $q("#th-backup").title = $q("#th-backup").disabled ? "Baca dari Pixhawk dulu" : "";

    const hist = $q("#th-hist");
    const rows = history.slice(-4).reverse().map((h) => {
      const time = new Date(h.t).toLocaleTimeString("en-GB", { hour12: false });
      return `<div>${time} · Motor ${h.n}: ${dirText(h.old)} → ${dirText(h.new)} <i>(${h.src})</i></div>`;
    });
    const html = rows.join("") || `<div class="st-sub">Belum ada perubahan.</div>`;
    if (hist.innerHTML !== html) hist.innerHTML = html;
  }

  // ===== Operasi =====
  async function guarded(fn) {
    if (busy) return;
    busy = true;
    render();
    try { await fn(); } catch (e) { say(e.message, "error"); appendLog(`[MOTOR] Gagal: ${e.message}`, "error"); }
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
      say(`Motor ${failed.join(", ")} tidak terbaca. Cek nama parameter di firmware.`, "error");
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
      say(`${line}. Terbukti: dibaca ulang dari Pixhawk.`, "ok");
      appendLog(`[MOTOR] ${line} (terbukti dibaca ulang, ${src})`);
    } else {
      say(`${line} TIDAK sesuai permintaan (diminta ${dirText(direction)}). Periksa Pixhawk.`, "error");
      appendLog(`[MOTOR] ${line} — GAGAL terverifikasi (diminta ${dirText(direction)}, sebelumnya ${dirText(old)})`, "error");
    }
    return r.verified;
  }

  // ===== Event =====
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || btn.disabled) return;

    if (btn.dataset.flip) {
      const n = Number(btn.dataset.flip);
      guarded(() => setDirection(n, -dirs[n], "manual"));

    } else if (btn.dataset.test) {
      const n = Number(btn.dataset.test);
      const pct = Number($q("#th-pct").value), sec = Number($q("#th-sec").value);
      if (!confirm(`Motor ${n} akan berputar ${pct}% selama ${sec} detik.\nBaling-baling aman / sudah dilepas?`)) return;
      guarded(async () => {
        const r = await api(`/motors/${n}/test`, { method: "POST", body: { percent: pct, seconds: sec } });
        say(`Test motor ${n}: ${r.result_text} (${r.percent}%, ${r.seconds} dtk). Perhatikan PWM dan arah putar.`, "ok");
        appendLog(`[MOTOR] Test motor ${n}: ${r.percent}% ${r.seconds}s → ${r.result_text}`);
      });

    } else if (btn.id === "th-read") {
      guarded(() => readAll());

    } else if (btn.id === "th-undo") {
      const last = history[history.length - 1];
      if (!last || !confirm(`Kembalikan Motor ${last.n} ke ${dirText(last.old)}?`)) return;
      guarded(() => setDirection(last.n, last.old, "dibatalkan"));

    } else if (btn.id === "th-backup") {
      const out = { version: 1, saved: new Date().toISOString(),
        directions: Object.fromEntries(MOTORS.map((n) => [String(n), dirs[n]])) };
      const name = `ROV_motor_backup_${stamp()}.json`;
      downloadBlob(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), name);
      say(`Cadangan disimpan: ${name}`, "ok");
      appendLog(`[MOTOR] Cadangan arah putar disimpan: ${name}`);

    } else if (btn.id === "th-compare") {
      $q("#th-file").click();

    } else if (btn.id === "th-apply") {
      const diffs = mismatches();
      const list = diffs.map((n) => `Motor ${n}: ${dirText(dirs[n])} → ${dirText(backup[n])}`).join("\n");
      if (!confirm(`Terapkan cadangan ke Pixhawk?\n\n${list}`)) return;
      guarded(async () => {
        let okCount = 0;
        for (const n of diffs) if (await setDirection(n, backup[n], "cadangan")) okCount++;
        say(`Cadangan diterapkan: ${okCount} dari ${diffs.length} motor terbukti sesuai.`, okCount === diffs.length ? "ok" : "error");
      });
    }
  });

  $q("#th-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      const d = j.directions;
      if (!d || typeof d !== "object") throw new Error("bukan file cadangan motor");
      backup = {};
      MOTORS.forEach((n) => { backup[n] = d[String(n)] === 1 || d[String(n)] === -1 ? d[String(n)] : null; });
      const diffs = mismatches();
      say(diffs.length
        ? `${diffs.length} motor berbeda dari cadangan (motor ${diffs.join(", ")}).`
        : "Semua motor SAMA dengan cadangan.", diffs.length ? "error" : "ok");
      appendLog(`[MOTOR] Dibandingkan dengan ${file.name}: ${diffs.length ? `beda di motor ${diffs.join(", ")}` : "sama semua"}`);
      render();
    } catch (err) {
      say(`Gagal membaca cadangan: ${err.message}`, "error");
    }
  });

  // PWM, status armed, dan terhubung ikut telemetri yang sudah di-poll telemetry.js
  timer = setInterval(render, 250);
  render();
  if (getLastTelemetry()?.mavlink_connected) guarded(() => readAll(true));

  return {
    destroy() {
      destroyed = true;
      clearInterval(timer);
    },
  };
}