//  ./frontend/js/bridge.js
//  bridge.js - pemantau data Joystick Bridge (tools/joystick_bridge.py) lewat backend GET /control/bridge.

//  NOTE:
//  Dipakai popup Settings supaya tampilannya mengikuti SUMBER joystick yang sebenarnya dipakai:
//    - Bridge tersambung  -> Settings menampilkan data dari Bridge (sumbu mentah, tombol)
//    - Bridge tidak ada   -> Settings memakai Gamepad API browser
//  Polling hanya jalan selama ada yang berlangganan (watchBridge), jadi tidak membebani backend saat Settings tertutup.


import { BACKEND_URL } from "./config.js";

let last = null;
let lastAt = 0;
let timer = 0;
let users = 0;
let inflight = false;

async function poll() {
  if (inflight) return;
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

/** Mulai polling; mengembalikan fungsi untuk berhenti. */
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

/** Data Bridge terbaru kalau tersambung dan masih segar, selain itu null. */
export function getBridge() {
  return last && last.connected && Date.now() - lastAt < 1500 ? last : null;
}