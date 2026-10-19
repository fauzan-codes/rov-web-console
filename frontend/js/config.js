
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
    if (query && query !== "reset") return query.replace(/\/+$/, "");
  }
  return DEFAULT_BACKEND_URL;
}

export const BACKEND_URL = resolveBackendUrl();

window.ROV_BACKEND_URL = BACKEND_URL;

export const CAMERAS = [
  { id: 0, label: "CAM1" },
  { id: 1, label: "CAM2" },
];
export const STREAM_RETRY_MS = 3000;

export const STREAM_CROSS_ORIGIN = false;

export const TELEMETRY_POLL_MS    = 100;  
export const TELEMETRY_TIMEOUT_MS = 2000; 
export const STATUS_POLL_MS       = 2000; 

export const TIMEZONE       = "Asia/Jakarta";
export const TIMEZONE_LABEL = "WIB";

export const LOG_TELEMETRY_EVERY_MS = 1000; 
export const LOG_MAX_DOM_LINES      = 120;   
export const LOG_HISTORY_MAX        = 5000;  

export const DEPTH_WARN_M = 2.5;  
export const TRAJ = {
  MAX_POINTS:       5000,
  TAIL:             80,    
  MIN_MOVE_NED:     0.05,  
  MIN_MOVE_DR:      0.015, 
  WAYPOINT_SPACING: 1.0,  
};

export const REC = {
  FPS: 25,
  FALLBACK_W: 640, 
  FALLBACK_H: 480,
};
