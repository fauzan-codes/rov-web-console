//  ./frontend/js/bridge.js
//  bridge.js - Client untuk memantau status Joystick Bridge melalui endpoint backend GET /control/bridge.

//  NOTE:
//  Joystick Bridge (tools/joystick_bridge.py) adalah proses terpisah di laptop operator yang membaca joystick dan mengirimkannya ke backend. 
//  Modul ini hanya MEMBACA status tersebut agar UI (mis. Settings) dapat menampilkan data dari sumber yang sebenarnya dipakai.
//
//  Penggunaan:
//    const stop = watchBridge();   // mulai polling (satu timer dipakai bersama oleh semua subscriber)
//    const b = getBridge();        // snapshot terbaru, atau null jika Bridge tidak aktif / datanya sudah basi
//    stop();                       // berhenti berlangganan
//
//  Polling hanya berjalan selama ada subscriber, sehingga tidak membebani backend saat tidak dibutuhkan.
//  Field penting pada snapshot: connected, name, raw (axis mentah), recent (bitmask tombol), rate_hz.


import { BACKEND_URL } from "./config.js";

const STALE_MS = 1500;   // snapshot dianggap basi jika lebih lama dari ini

let last = null;
let lastAt = 0;
let timer = 0;
let users = 0;
let inflight = false;

async function poll() {
  if (inflight) return;   // jangan menumpuk request saat jaringan lambat
  inflight = true;
  try {
    const res = await fetch(`${BACKEND_URL}/control/bridge`, { signal: AbortSignal.timeout(1200) });
    const data = await res.json();
    if (res.ok && data.ok) { last = data.bridge; lastAt = Date.now(); }
  } catch (_) {
    last = null;
  } finally {
    inflight = false;
  }
}

/** Mulai polling. Mengembalikan fungsi untuk berhenti berlangganan. */
export function watchBridge(ms = 100) {
  users++;
  if (users === 1) { poll(); timer = setInterval(poll, ms); }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    users = Math.max(0, users - 1);
    if (users === 0) { clearInterval(timer); timer = 0; last = null; }
  };
}

/** Snapshot Bridge terbaru jika terhubung dan masih segar; selain itu null. */
export function getBridge() {
  return last && last.connected && Date.now() - lastAt < STALE_MS ? last : null;
}