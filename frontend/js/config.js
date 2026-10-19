//  ./frontend/js/config.js
//  config.js - SEMUA pengaturan frontend ada di sini

//  NOTE:
//  File lain tidak boleh punya angka/URL sendiri; import dari sini.
// 
//  Alamat backend
//  Urutan prioritas:
//    1. ?backend=http://localhost:8080 di URL halaman (disimpan otomatis ke localStorage, jadi cukup sekali)
//    2. nilai yang tersimpan di localStorage
//    3. DEFAULT_BACKEND_URL di bawah (IP Jetson di jaringan lokal)
// Untuk kembali ke default:  buka halaman dengan ?backend=reset
const DEFAULT_BACKEND_URL = "http://192.168.1.10:8080";
const BACKEND_STORAGE_KEY = "rov.backendUrl";

function resolveBackendUrl() {
  const query = new URLSearchParams(location.search).get("backend");
  try {
    if (query === "reset") {
      localStorage.removeItem(BACKEND_STORAGE_KEY);
    } else if (query) {
      localStorage.setItem(BACKEND_STORAGE_KEY, query.replace(/\/+$/, ""));
    }
    const saved = localStorage.getItem(BACKEND_STORAGE_KEY);
    if (saved) return saved;
  } catch (_) {
    // localStorage diblokir -> pakai query langsung kalau ada
    if (query && query !== "reset") return query.replace(/\/+$/, "");
  }
  return DEFAULT_BACKEND_URL;
}

export const BACKEND_URL = resolveBackendUrl();

// rov3d.js & rovTopIcon.js (script terpisah) membaca alamat ini dari window.
// main.js di-load lebih dulu di index.html, jadi nilainya sudah terisi.
window.ROV_BACKEND_URL = BACKEND_URL;

// ===== Kamera =====
// id harus sama dengan CAM_MAPPING di backend, dan data-cam-id di index.html
export const CAMERAS = [
  { id: 0, label: "CAM1" },
  { id: 1, label: "CAM2" },
];
export const STREAM_RETRY_MS = 3000;

// Set true kalau rekaman video hasilnya hitam (canvas "tainted").
// Backend sudah pakai CORS, jadi ini seharusnya aman - tapi TES dulu, kalau preview kamera jadi kosong setelah diubah, kembalikan ke false.
export const STREAM_CROSS_ORIGIN = false;

// ===== Polling =====
export const TELEMETRY_POLL_MS    = 100;    // seberapa sering minta /telemetry
export const TELEMETRY_TIMEOUT_MS = 2000;   // batas tunggu satu request
export const STATUS_POLL_MS       = 2000;   // seberapa sering minta /status

// ===== Waktu header =====
export const TIMEZONE       = "Asia/Jakarta";
export const TIMEZONE_LABEL = "WIB";

// ===== Log =====
export const LOG_TELEMETRY_EVERY_MS = 1000;  // 1 baris telemetri / detik
export const LOG_MAX_DOM_LINES      = 120;   // baris yang tampil di panel
export const LOG_HISTORY_MAX        = 5000;  // baris yang disimpan untuk replay/export

// ===== Kedalaman & trajectory =====
export const DEPTH_WARN_M = 2.5;   // batas peringatan kedalaman (meter)
export const TRAJ = {
  MAX_POINTS:       5000,
  TAIL:             80,      // jumlah titik terakhir yang digambar tebal
  MIN_MOVE_NED:     0.05,    // meter, sumber Pixhawk (NED)
  MIN_MOVE_DR:      0.015,   // meter, dead reckoning (gerak pelan di kolam)
  WAYPOINT_SPACING: 1.0,     // meter antar penanda waypoint bernomor
};

// ===== Rekaman =====
export const REC = {
  FPS: 25,
  FALLBACK_W: 640, // dipakai kalau ukuran stream belum diketahui
  FALLBACK_H: 480,
};
