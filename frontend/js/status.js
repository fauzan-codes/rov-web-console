//  ./frontend/js/status.js
//  status.js - polling GET /status (resolusi, FPS terukur, zoom, dan penanda mode DEV backend). Tidak kritis: kalau gagal, diam.


import { BACKEND_URL, STATUS_POLL_MS } from "./config.js";
import { applyStatus } from "./camera.js";
import { $ } from "./util.js";

export function startStatusPolling() {
  const devBadge = $("devBadge");

  const tick = async () => {
    try {
      const options = typeof AbortSignal.timeout === "function"
        ? { signal: AbortSignal.timeout(2000) }
        : {};
      const res = await fetch(`${BACKEND_URL}/status`, options);
      if (res.ok) {
        const status = await res.json();
        applyStatus(status);
        if (devBadge) devBadge.hidden = !status.dev_mode;
      }
    } catch (_) { /* backend belum nyala/putus */ }
    setTimeout(tick, STATUS_POLL_MS);
  };

  tick();
}
