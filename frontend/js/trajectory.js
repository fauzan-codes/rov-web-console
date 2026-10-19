
import { DEPTH_WARN_M, TRAJ } from "./config.js";
import { appendLog } from "./logger.js";
import { downloadBlob } from "./storage.js";
import { sesPrefix } from "./session.js";
import { stamp, $ } from "./util.js";

const { MAX_POINTS, TAIL, MIN_MOVE_NED, MIN_MOVE_DR, WAYPOINT_SPACING } = TRAJ;

let points = [];         
let wpMarkers = [];      
let wpCumDist = 0;
let wpLastMarkerDist = 0;
let startX = null;
let startY = null;
let paused = false;
let posMode = "WAITING";
let liveYaw = 0;

let canvas = null;
let ctx = null;
let infoEl, distEl, maxDepthEl, ptsEl, pauseBtn;
let lastReadout = "";

export const getTrajPoints = () => points.slice();

export function recordTrajPoint(x, y, depth, yawDeg, mode) {
  if (paused) return;

  if (Number.isFinite(yawDeg)) liveYaw = yawDeg;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    posMode = "WAITING";
    return;
  }
  posMode = mode;

  const minMove = mode === "DR" ? MIN_MOVE_DR : MIN_MOVE_NED;

  if (startX === null) {
    startX = x;
    startY = y;
    points.push({ x: 0, y: 0, depth, yaw: yawDeg, t: Date.now() });
    wpMarkers = [{ x: 0, y: 0, depth, label: "H", home: true }];
    wpCumDist = 0;
    wpLastMarkerDist = 0;
    return;
  }

  const rx = x - startX;
  const ry = y - startY;
  const last = points[points.length - 1];

  if (last && Math.hypot(rx - last.x, ry - last.y) < minMove) return;

  if (last) {
    wpCumDist += Math.hypot(rx - last.x, ry - last.y);
    if (wpCumDist - wpLastMarkerDist >= WAYPOINT_SPACING) {
      wpLastMarkerDist = wpCumDist;
      const seq = wpMarkers.filter((m) => !m.home).length + 1;
      wpMarkers.push({ x: rx, y: ry, depth, label: String(seq) });
    }
  }

  points.push({ x: rx, y: ry, depth, yaw: yawDeg, t: Date.now() });
  if (points.length > MAX_POINTS) points.shift();
}

export function setWaiting(yawDeg) {
  if (Number.isFinite(yawDeg)) liveYaw = yawDeg;
  posMode = "WAITING";
}

export function setOffline() {
  posMode = "OFFLINE";
}

export function clearTrajectory() {
  points = [];
  wpMarkers = [];
  wpCumDist = 0;
  wpLastMarkerDist = 0;
  startX = null;
  startY = null;
  if (window.clearRov3DTrail) window.clearRov3DTrail();
  appendLog("Trajectory cleared.");
}

function togglePause() {
  paused = !paused;
  if (pauseBtn) {
    pauseBtn.textContent = paused ? "▶" : "⏸";
    pauseBtn.classList.toggle("active", paused);
  }
  appendLog(paused ? "Trajectory PAUSED." : "Trajectory RESUMED.");
}

export function getTrajectoryBlob() {
  return new Promise((resolve) => {
    if (!canvas) { resolve(null); return; }
    canvas.toBlob((b) => resolve(b), "image/png");
  });
}

export function saveTrajectoryImage(label) {
  const fname = `${sesPrefix()}__trajectory_${label || stamp()}.png`;
  getTrajectoryBlob().then((blob) => {
    if (!blob) return;
    downloadBlob(blob, fname);
    appendLog(`[TRAJ] Tersimpan: ${fname}`);
  });
}

function depthRGB(depth) {
  const dr = Math.min(depth / (DEPTH_WARN_M * 1.5), 1);
  return [
    Math.round(34  + (220 - 34)  * dr),
    Math.round(211 + (50  - 211) * dr),
    Math.round(238 + (80  - 238) * dr),
  ];
}

function drawGrid(W, H) {
  ctx.save();
  ctx.strokeStyle = "rgba(34,211,238,0.07)";
  ctx.lineWidth = 0.5;
  for (let gx = 0; gx <= W; gx += 36) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
  for (let gy = 0; gy <= H; gy += 36) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
  ctx.restore();
}

function drawCompass(W) {
  const yr = (liveYaw * Math.PI) / 180;
  const cx = W - 24, cy = 24, r = 16;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(1,8,18,0.75)"; ctx.fill();
  ctx.strokeStyle = "rgba(34,211,238,0.3)"; ctx.lineWidth = 0.8; ctx.stroke();

  ctx.font = "6px Consolas,monospace";
  ctx.fillStyle = "rgba(34,211,238,0.55)";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("N", cx, cy - r + 4); ctx.fillText("S", cx, cy + r - 4);
  ctx.fillText("E", cx + r - 4, cy); ctx.fillText("W", cx - r + 4, cy);

  const nl = r - 4, nx = Math.sin(yr), ny = -Math.cos(yr);
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + nx * nl, cy + ny * nl);
  ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 1.5; ctx.lineCap = "round"; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - nx * nl * 0.6, cy - ny * nl * 0.6);
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fillStyle = "#38bdf8"; ctx.fill();

  ctx.font = "7px Consolas,monospace"; ctx.fillStyle = "#22d3ee";
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillText(`${Math.round(((liveYaw % 360) + 360) % 360)}°`, cx, cy + r + 2);
  ctx.restore();
}

function drawWpMarker(x, y, label, isHome) {
  const r = isHome ? 7 : 6.5;
  const fill = isHome ? "#22c55e" : "#f59e0b";
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.shadowColor = fill; ctx.shadowBlur = 6; ctx.fill(); ctx.shadowBlur = 0;
  ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(6,16,31,0.9)"; ctx.stroke();
  ctx.font = "8px Consolas,monospace"; ctx.fillStyle = "#06101f";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 0.5);
  ctx.restore();
}

function drawEmptyMessage(W, H) {
  ctx.save();
  ctx.font = "10px Consolas,monospace";
  ctx.textAlign = "center";
  let msg;
  if (posMode === "OFFLINE") {
    ctx.fillStyle = "rgba(239,68,68,0.55)";
    msg = "BACKEND TIDAK TERHUBUNG — CEK ALAMAT BACKEND / JARINGAN";
  } else if (posMode === "WAITING") {
    ctx.fillStyle = "rgba(34,211,238,0.28)";
    msg = "WAITING FOR PIXHAWK IMU DATA…";
  } else {
    ctx.fillStyle = "rgba(34,211,238,0.28)";
    msg = `${posMode} MODE — MOVE ROV TO START TRACE`;
  }
  ctx.fillText(msg, W / 2, H / 2);
  ctx.restore();
}


function computeView(W, H) {
  const PAD = 28;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const rX = Math.max(maxX - minX, 0.5);
  const rY = Math.max(maxY - minY, 0.5);
  const sc = Math.min((W - PAD * 2) / rX, (H - PAD * 2) / rY);
  const ox = PAD + (W - PAD * 2 - rX * sc) / 2 - minX * sc;
  const oy = PAD + (H - PAD * 2 - rY * sc) / 2 - minY * sc;
  return (p) => [ox + p.x * sc, oy + p.y * sc];
}

function drawTrail(s2c) {
  const tailStart = Math.max(0, points.length - TAIL);


  if (tailStart > 1) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(34,211,238,0.13)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    const [sx, sy] = s2c(points[0]);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < tailStart; i++) {
      const [px, py] = s2c(points[i]);
      ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }


  const tail = points.slice(tailStart);
  for (let i = 1; i < tail.length; i++) {
    const p0 = tail[i - 1], p1 = tail[i];
    const alpha = 0.35 + 0.65 * (i / tail.length);
    const [r, g, b] = depthRGB(p1.depth);
    const [x0, y0] = s2c(p0), [x1, y1] = s2c(p1);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
}


function drawRov(s2c, cur) {
  const [cx, cy] = s2c(cur);
  const ICON_DRAW = 30;

  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 280);
  ctx.beginPath(); ctx.arc(cx, cy, 9 + pulse * 3, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(56,189,248,${0.18 + pulse * 0.25})`;
  ctx.lineWidth = 1.2; ctx.stroke();

  const iconCanvas = window.getRovTopIconCanvas && window.getRovTopIconCanvas();

  if (iconCanvas) {
    const offsetDeg = (window.getRovIconForwardOffset && window.getRovIconForwardOffset()) || 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(((cur.yaw || 0) + offsetDeg) * Math.PI / 180);
    ctx.shadowColor = "#38bdf8"; ctx.shadowBlur = 10;
    ctx.drawImage(iconCanvas, -ICON_DRAW / 2, -ICON_DRAW / 2, ICON_DRAW, ICON_DRAW);
    ctx.restore();


    const bx = cx + ICON_DRAW * 0.34, by = cy + ICON_DRAW * 0.34;
    ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#f59e0b"; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "#06101f"; ctx.stroke();
    ctx.font = "7px Consolas,monospace"; ctx.fillStyle = "#06101f";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(wpMarkers.length), bx, by + 0.5);
  } else {
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#38bdf8"; ctx.shadowColor = "#38bdf8"; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;

    if (points.length >= 4) {
      const [px, py] = s2c(points[points.length - 4]);
      const dx = cx - px, dy = cy - py;
      if (Math.sqrt(dx * dx + dy * dy) > 3) {
        const ang = Math.atan2(dy, dx), hl = 8;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx - hl * Math.cos(ang - 0.45), cy - hl * Math.sin(ang - 0.45));
        ctx.lineTo(cx - hl * Math.cos(ang + 0.45), cy - hl * Math.sin(ang + 0.45));
        ctx.closePath(); ctx.fillStyle = "#38bdf8"; ctx.fill();
      }
    }
  }

  ctx.save();
  ctx.font = "8px Consolas,monospace"; ctx.fillStyle = "#38bdf8";
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText("ROV", cx + ICON_DRAW / 2 + 3, cy + 3);
  ctx.restore();
}

function drawFooter(W, H) {
  const deepCount = points.filter((p) => p.depth >= DEPTH_WARN_M).length;
  ctx.save();
  if (deepCount > 0) {
    ctx.font = "9px Consolas,monospace"; ctx.fillStyle = "#ef4444";
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(`⚠ ${deepCount} pts ≥ ${DEPTH_WARN_M}m`, 7, H - 7);
  }

  const modeColor = { PIXHAWK: "#22c55e", DR: "#f59e0b", WAITING: "#64748b", OFFLINE: "#ef4444" }[posMode] || "#22c55e";
  ctx.font = "9px Consolas,monospace"; ctx.fillStyle = modeColor;
  ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
  ctx.fillText(`● ${posMode}`, W - 7, H - 7);
  ctx.restore();
}


function updateReadouts(cur) {
  let total = 0, maxDepth = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i].depth > maxDepth) maxDepth = points[i].depth;
    if (i > 0) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }

  let info;
  if (cur) {
    info = `[${posMode}] X ${cur.x.toFixed(2)}m  Y ${cur.y.toFixed(2)}m  D ${cur.depth.toFixed(2)}m` + (paused ? "  ⏸" : "");
  } else if (posMode === "OFFLINE") {
    info = "BACKEND OFFLINE";
  } else if (posMode === "WAITING") {
    info = "WAITING FOR PIXHAWK…";
  } else {
    info = `[${posMode}] NO TRACE` + (paused ? "  ⏸" : "");
  }

  const dist = `${total.toFixed(2)} m`;
  const depth = `${maxDepth.toFixed(2)} m`;
  const pts = String(wpMarkers.length);

  const key = `${info}|${dist}|${depth}|${pts}`;
  if (key === lastReadout) return;
  lastReadout = key;

  if (infoEl) infoEl.textContent = info;
  if (distEl) distEl.textContent = dist;
  if (maxDepthEl) maxDepthEl.textContent = depth;
  if (ptsEl) ptsEl.textContent = pts;
}

function draw() {
  requestAnimationFrame(draw);
  if (!ctx || !canvas) return;

  const dpr = devicePixelRatio || 1;
  const W = canvas.width / dpr;
  const H = canvas.height / dpr;
  ctx.clearRect(0, 0, W, H);
  drawGrid(W, H);

  if (points.length < 2) {
    drawEmptyMessage(W, H);
    drawCompass(W);
    updateReadouts(null);
    return;
  }

  const s2c = computeView(W, H);
  const cur = points[points.length - 1];

  drawTrail(s2c);
  for (const m of wpMarkers) {
    const [mx, my] = s2c(m);
    drawWpMarker(mx, my, m.label, !!m.home);
  }
  drawRov(s2c, cur);
  drawFooter(W, H);
  drawCompass(W);
  updateReadouts(cur);
}


function resizeCanvas() {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width  = Math.max(1, Math.round(rect.width  * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function initTrajectory() {
  canvas = $("trajCanvas");
  if (!canvas) return;

  infoEl     = $("trajInfo");
  distEl     = $("trajDist");
  maxDepthEl = $("trajMaxDepth");
  ptsEl      = $("trajPts");
  pauseBtn   = $("trajPause");

  $("trajClear")?.addEventListener("click", clearTrajectory);
  pauseBtn?.addEventListener("click", togglePause);
  $("trajPng")?.addEventListener("click", () => saveTrajectoryImage(stamp()));

  new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
  resizeCanvas();
  requestAnimationFrame(draw);
}
