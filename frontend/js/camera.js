
import { BACKEND_URL, CAMERAS, STREAM_RETRY_MS, STREAM_CROSS_ORIGIN } from "./config.js";
import { appendLog } from "./logger.js";
import { downloadBlob } from "./storage.js";
import { sesPrefix } from "./session.js";
import { timeTag } from "./util.js";

const cams = new Map();   

const SIGNAL_ICON = {
  off:        "fa-signal",
  connecting: "fa-circle",
  live:       "fa-signal",
  error:      "fa-triangle-exclamation",
};

function setSignal(cam, state) {
  cam.signal.dataset.state = state;
  cam.signal.innerHTML = `<i class="fa-solid ${SIGNAL_ICON[state] || SIGNAL_ICON.off}"></i>`;
}

async function startBackendCamera() {
  try {
    await fetch(`${BACKEND_URL}/start_cameras`, { method: "POST" });
  } catch (e) {
    appendLog(`[CAM] Gagal start kamera: ${e.message}`, "error");
  }
}

async function stopBackendCamera() {
  try {
    await fetch(`${BACKEND_URL}/stop_cameras`, { method: "POST" });
  } catch (_) {  }
}

function createStream(cam) {
  cam.img?.remove();
  clearTimeout(cam.retryTimer);
  clearTimeout(cam.liveFallbackTimer);

  const img = document.createElement("img");
  img.className = "video-stream";
  img.alt = `CAM ${cam.id + 1}`;
  if (STREAM_CROSS_ORIGIN) img.crossOrigin = "anonymous";

  img.onload = () => {
    if (!cam.active) return;
    setSignal(cam, "live");
  };

  img.onerror = () => {
    if (!cam.active) return;
    setSignal(cam, "error");
    appendLog(`[CAM${cam.id + 1}] ✖ Stream putus — reconnect dalam ${STREAM_RETRY_MS / 1000}s…`, "warn");
    cam.retryTimer = setTimeout(() => {
      if (cam.active) createStream(cam);
    }, STREAM_RETRY_MS);
  };

  img.src = `${BACKEND_URL}/video_feed/${cam.id}?t=${Date.now()}`;
  cam.box.prepend(img);
  cam.img = img;
  setSignal(cam, "connecting");

  cam.liveFallbackTimer = setTimeout(() => {
    if (cam.active && cam.signal.dataset.state === "connecting") setSignal(cam, "live");
  }, 2500);
}

async function turnOn(cam) {
  cam.active = true;
  await startBackendCamera();
  if (!cam.active) return;   
  createStream(cam);
  cam.box.classList.add("camera-on");
}

async function turnOff(cam) {
  cam.active = false;
  clearTimeout(cam.retryTimer);
  clearTimeout(cam.liveFallbackTimer);
  cam.img?.remove();
  cam.img = null;
  cam.box.classList.remove("camera-on");
  cam.fpsEl.textContent = "FPS --";
  setSignal(cam, "off");

  if (getActiveCameraCount() === 0) await stopBackendCamera();
}

export async function takeSnapshot(cam) {
  const fname = `${sesPrefix()}__snap_${cam.label}_${timeTag()}.jpg`;
  try {
    const res = await fetch(`${BACKEND_URL}/snapshot/${cam.id}`);
    if (!res.ok) {
      appendLog(`[SNAP] Kamera ${cam.label} tidak tersedia`, "warn");
      return;
    }
    await downloadBlob(await res.blob(), fname);
    appendLog(`[SNAP] Tersimpan: ${fname}`);
  } catch (_) {
  
    if (!cam.img) {
      appendLog(`[SNAP] Tidak ada stream ${cam.label}`, "warn");
      return;
    }
    try {
      const c = document.createElement("canvas");
      c.width  = cam.img.naturalWidth  || 640;
      c.height = cam.img.naturalHeight || 480;
      c.getContext("2d").drawImage(cam.img, 0, 0);
      c.toBlob((b) => b && downloadBlob(b, fname), "image/jpeg", 0.95);
      appendLog(`[SNAP] Canvas fallback → ${fname}`);
    } catch (e) {
      appendLog(`[SNAP] Gagal ambil snapshot ${cam.label}: ${e.message}`, "error");
    }
  }
}

export function takeAllSnapshots() {
  cams.forEach((cam) => takeSnapshot(cam));
}

async function setZoom(cam, direction) {
  try {
    const res = await fetch(`${BACKEND_URL}/zoom/${direction}/${cam.id}`, { method: "POST" });
    if (!res.ok) {
      appendLog(`[ZOOM] Kamera ${cam.id} gagal diubah (${res.status})`, "warn");
      return;
    }
    const data = await res.json();
    cam.zoomEl.textContent = `${data.zoom_level.toFixed(1)}x`;
    appendLog(`[ZOOM] ${cam.label} → ${data.zoom_level.toFixed(1)}x`);
  } catch (e) {
    appendLog(`[ZOOM] Gagal menghubungi backend: ${e.message}`, "error");
  }
}

function toggleFullscreen(box) {
  if (!document.fullscreenElement) box.requestFullscreen().catch(() => {});
  else document.exitFullscreen();
}

export function applyStatus(status) {
  const video = status.video || {};
  cams.forEach((cam) => {
    const key = String(cam.id);
    const res = video.resolution?.[key];
    const fps = video.fps?.[key];
    cam.resEl.textContent = res && fps ? `${res} • ${fps}fps` : "-- • --";

    const measured = video.measured_fps?.[key];
    cam.fpsEl.textContent = cam.active && measured != null ? `FPS ${Number(measured).toFixed(1)}` : "FPS --";

    const zoom = status.zoom_levels?.[key];
    if (zoom != null) cam.zoomEl.textContent = `${Number(zoom).toFixed(1)}x`;
  });
}

export const getActiveCameraCount = () => [...cams.values()].filter((c) => c.active).length;
export const getStreamImg         = (id) => cams.get(id)?.img || null;

export function initCameras() {
  CAMERAS.forEach(({ id, label }) => {
    const panel = document.querySelector(`.camera-panel[data-cam-id="${id}"]`);
    if (!panel) {
      console.warn(`[CAM] Panel kamera dengan data-cam-id="${id}" tidak ada di HTML.`);
      return;
    }

    const cam = {
      id, label, panel,
      box:      panel.querySelector(".video-box"),
      toggle:   panel.querySelector(".cam-toggle"),
      signal:   panel.querySelector(".signal"),
      resEl:    panel.querySelector(".cam-res"),
      fpsEl:    panel.querySelector(".cam-fps"),
      zoomEl:   panel.querySelector(".zoom-level"),
      img: null, active: false, retryTimer: null, liveFallbackTimer: null,
    };
    cams.set(id, cam);

    cam.toggle?.addEventListener("change", () =>
      cam.toggle.checked ? turnOn(cam) : turnOff(cam));
    panel.querySelector(".capture-btn")?.addEventListener("click", () => takeSnapshot(cam));
    panel.querySelector(".fullscreen-btn")?.addEventListener("click", () => toggleFullscreen(cam.box));
    panel.querySelector(".zoom-in-btn")?.addEventListener("click", () => setZoom(cam, "in"));
    panel.querySelector(".zoom-out-btn")?.addEventListener("click", () => setZoom(cam, "out"));
  });
}
