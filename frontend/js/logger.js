
import { LOG_MAX_DOM_LINES, LOG_HISTORY_MAX } from "./config.js";
import { $ } from "./util.js";

const consoleEl = $("consoleLog");
const history = [];

const clockFmt = new Intl.DateTimeFormat("en-GB", {
  hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

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

export function getLogSince(epochMs) {
  return history.filter((e) => e.t >= epochMs);
}

export function clearLog() {
  history.length = 0;
  if (consoleEl) consoleEl.innerHTML = "";
}
