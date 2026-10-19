//  ./frontend/js/logger.js
//  logger.js - panel DATA LOG / SERIAL CONSOLE

//  NOTE:
//  Panel hanya menampilkan LOG_MAX_DOM_LINES baris terakhir, tapi semua baris (sampai LOG_HISTORY_MAX) disimpan di memori supaya replay & export log tidak ikut terpotong.


import { LOG_MAX_DOM_LINES, LOG_HISTORY_MAX } from "./config.js";
import { $ } from "./util.js";

const consoleEl = $("consoleLog");
const history = [];   // [{ t: epoch ms, text }]

const clockFmt = new Intl.DateTimeFormat("en-GB", {
  hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

// level: "" | "warn" | "error"
export function appendLog(msg, level = "") {
  const t = Date.now();
  const text = `[${clockFmt.format(t)}] ${msg}`;

  history.push({ t, text });
  if (history.length > LOG_HISTORY_MAX) history.splice(0, history.length - LOG_HISTORY_MAX);

  if (!consoleEl) return;
  const line = document.createElement("div");
  if (level) line.className = level;
  line.textContent = text;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
  while (consoleEl.children.length > LOG_MAX_DOM_LINES) {
    consoleEl.removeChild(consoleEl.firstChild);
  }
}

// Semua baris log sejak waktu tertentu (epoch ms).
export function getLogSince(epochMs) {
  return history.filter((e) => e.t >= epochMs);
}

export function clearLog() {
  history.length = 0;
  if (consoleEl) consoleEl.innerHTML = "";
}
