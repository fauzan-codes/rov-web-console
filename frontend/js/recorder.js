//  ./frontend/js/recorder.js
//  recorder.js - rekam video (MediaRecorder), telemetri CSV, dan siapkan data untuk replay. Semua file disimpan di LAPTOP.

//  NOTE:
//  Alur: START -> kumpulkan frame video + baris CSV STOP  -> simpan video & CSV, lalu isi replayData
//  replayData dipakai replay.js (modal REPLAY).


import { CAMERAS, REC } from "./config.js";
import { appendLog, getLogSince } from "./logger.js";
import { downloadBlob } from "./storage.js";
import { sesPrefix, getSessionId } from "./session.js";
import { getStreamImg } from "./camera.js";
import { getTrajPoints, getTrajectoryBlob } from "./trajectory.js";
import { fmtMs, $ } from "./util.js";

export const CSV_HEADER = [
  "timestamp", "roll", "pitch", "yaw", "depth", "depth_pressure",
  "ned_x", "ned_y", "ned_z", "dr_x", "dr_y",
];

let recording    = false;
let recorders    = []; 
let csvRows      = [];
let recStartTime = null;
let replayData   = null;
let resetGen     = 0; 
let onReplayReady = () => {};

const btnRecord = $("btnRecord");

export const isRecording   = () => recording;
export const getReplayData = () => replayData;

// Daftarkan callback(ready:boolean) - dipakai main.js untuk menyalakan tombol REPLAY.
export function setReplayReadyHandler(cb) {
  onReplayReady = cb;
}

// Dipanggil telemetry.js tiap siklus; diabaikan kalau tidak sedang merekam.
export function pushCsvRow(d) {
  if (!recording) return;
  const f = (v) => (v || 0).toFixed(4);
  csvRows.push([
    new Date().toISOString(),
    f(d.roll), f(d.pitch), f(d.yaw),
    f(d.depth), f(d.depth_pressure),
    f(d.x), f(d.y), f(d.z),
    f(d.dr_x), f(d.dr_y),
  ]);
}

function setRecordButton(active) {
  if (!btnRecord) return;
  btnRecord.innerHTML = active
    ? `<i class="fa-solid fa-stop"></i> STOP RECORD`
    : `<i class="fa-solid fa-circle"></i> START RECORD`;
  btnRecord.classList.toggle("recording-active", active);
}

// ===== Rekam video dari <img> MJPEG lewat canvas =====
function canvasRecorderFor(img) {
  const canvas = document.createElement("canvas");
  // Ikuti rasio asli stream (dulu dipaksa 640x480 -> gambar 16:9 gepeng)
  canvas.width  = img.naturalWidth  || REC.FALLBACK_W;
  canvas.height = img.naturalHeight || REC.FALLBACK_H;
  const ctx = canvas.getContext("2d");

  let running = true;
  const draw = () => {
    if (!running) return;
    try { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); } catch (_) { /* frame belum siap */ }
    requestAnimationFrame(draw);
  };
  draw();

  const stream = canvas.captureStream(REC.FPS);
  const options = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? { mimeType: "video/webm;codecs=vp9" }
    : MediaRecorder.isTypeSupported("video/webm")
      ? { mimeType: "video/webm" }
      : {};

  const rec = new MediaRecorder(stream, options);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  return { rec, chunks, stopDraw: () => { running = false; } };
}

export function startRecording() {
  if (recording) return;

  recorders = [];
  csvRows = [CSV_HEADER.slice()];
  recStartTime = new Date();

  CAMERAS.forEach((cam, index) => {
    const img = getStreamImg(cam.id);
    if (!img) {
      appendLog(`[REC] Stream ${cam.label} tidak aktif, dilewati.`, "warn");
      return;
    }
    const r = canvasRecorderFor(img);
    r.label = cam.label;
    r.index = index;
    r.rec.start(1000); // kumpulkan chunk tiap 1 detik
    recorders.push(r);
  });

  if (recorders.length === 0) {
    appendLog("[REC] ⚠ Tidak ada kamera aktif — hanya merekam telemetry & trajectory.", "warn");
  }

  recording = true;
  setRecordButton(true);
  appendLog(`[REC] ● Rekaman dimulai — ${recorders.length} kamera aktif`);
}

async function finalizeReplayData(videoBlobs, gen, startMs) {
  const trajBlob = await getTrajectoryBlob();
  if (gen !== resetGen) return;

  replayData = {
    sessionId:   getSessionId(), 
    videoBlobs,
    csvRows:     csvRows.slice(),
    trajSnapBlob: trajBlob,
    trajPoints:  getTrajPoints(),
    recStartMs:  startMs,
    logs:        getLogSince(startMs), 
    duration:    Date.now() - startMs,
  };
  appendLog(`[REC] ✓ Replay data siap — durasi ${fmtMs(replayData.duration)}`);
  onReplayReady(true);
}

export function stopRecording() {
  if (!recording) return;
  recording = false;

  const prefix  = sesPrefix();
  const gen     = resetGen;
  const startMs = recStartTime ? recStartTime.getTime() : Date.now();
  const videoBlobs = CAMERAS.map(() => null);
  let pending = recorders.length;

  const tryFinalize = () => {
    if (pending > 0) return;
    finalizeReplayData(videoBlobs, gen, startMs);
  };

  recorders.forEach((r) => {
    r.rec.onstop = () => {
      r.stopDraw();
      const mime = r.rec.mimeType || "video/webm";
      const blob = new Blob(r.chunks, { type: mime });
      const ext  = mime.includes("mp4") ? "mp4" : "webm";
      const fname = `${prefix}__video_${r.label}.${ext}`;
      downloadBlob(blob, fname);
      appendLog(`[REC] Tersimpan: ${fname} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
      videoBlobs[r.index] = blob;
      pending--;
      tryFinalize();
    };
    try { r.rec.stop(); } catch (_) { r.rec.onstop(); }
  });

  if (csvRows.length > 1) {
    const csv = csvRows.map((row) => row.join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), `${prefix}__telemetry.csv`);
    appendLog(`[REC] Tersimpan: ${prefix}__telemetry.csv (${csvRows.length - 1} baris)`);
  }

  recorders = [];
  setRecordButton(false);
  appendLog("[REC] ■ Rekaman selesai.");

  tryFinalize();
}

export function toggleRecord() {
  recording ? stopRecording() : startRecording();
}

// Dipanggil saat RESET SESSION.
export function resetRecorderData() {
  resetGen++;
  csvRows = [];
  replayData = null;
  onReplayReady(false);
}
