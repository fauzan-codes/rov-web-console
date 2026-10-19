
import { BACKEND_URL } from "./config.js";
import { appendLog, clearLog } from "./logger.js";
import { startClock } from "./clock.js";
import { initCameras, takeAllSnapshots } from "./camera.js";
import { initTrajectory, clearTrajectory } from "./trajectory.js";
import { startTelemetry, setDepthAlarmArmed } from "./telemetry.js";
import { startStatusPolling } from "./status.js";
import {
  isRecording, toggleRecord, stopRecording,
  resetRecorderData, setReplayReadyHandler,
} from "./recorder.js";
import { openReplayModal } from "./replay.js";
import { newSession, getSessionId } from "./session.js";
import { pickSaveFolder, onFolderChange, getFolderName, isFolderPickerSupported } from "./storage.js";
import { $ } from "./util.js";

function resetSession() {
  if (isRecording()) stopRecording();
  newSession();
  clearTrajectory();
  resetRecorderData();
  clearLog();
  const folder = getFolderName();
  appendLog(`[SYS] Sesi baru: ROV_${getSessionId()}__*  →  ${folder ? `"${folder}"` : "Downloads"}`);
}

function bindControls() {
  $("btnRecord")?.addEventListener("click", toggleRecord);
  $("btnSnapshot")?.addEventListener("click", takeAllSnapshots);
  $("btnReplay")?.addEventListener("click", openReplayModal);
  $("btnReset")?.addEventListener("click", resetSession);

  const btnFolder = $("btnFolder");
  const folderLabel = $("folderLabel");
  const renderFolder = (name) => {
    if (folderLabel) folderLabel.textContent = name ? name : "Downloads";
    btnFolder?.classList.toggle("folder-set", !!name);
  };
  renderFolder(getFolderName());
  onFolderChange(renderFolder);
  btnFolder?.addEventListener("click", () => {
    if (!isFolderPickerSupported()) {
      appendLog("[FOLDER] Browser ini tidak mendukung pilih folder (pakai Chrome/Edge). File disimpan ke Downloads.", "warn");
      return;
    }
    pickSaveFolder();
  });

  const btnReplay = $("btnReplay");
  setReplayReadyHandler((ready) => {
    btnReplay?.classList.toggle("ready", ready);
    if (btnReplay) btnReplay.title = ready ? "Putar replay sesi terakhir" : "";
  });

  const btnDepth = $("btnDepthAlert");
  btnDepth?.addEventListener("click", () => {
    const armed = !btnDepth.classList.contains("armed");
    btnDepth.classList.toggle("armed", armed);
    btnDepth.setAttribute("aria-pressed", String(armed));
    setDepthAlarmArmed(armed);
    appendLog(`[ALERT] Alarm kedalaman ${armed ? "AKTIF" : "NONAKTIF"}`);
  });

  const modeButtons = document.querySelectorAll(".mode-toggle .mode");
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeButtons.forEach((b) => b.classList.toggle("active", b === btn));
      appendLog(`[MODE] ${btn.textContent.trim()} dipilih (tampilan saja — belum dikirim ke backend)`, "warn");
    });
  });

  $("menuBtn")?.addEventListener("click", () => {
    appendLog("[MENU] Belum ada menu.", "warn");
  });
}

startClock();
initCameras();
initTrajectory();
bindControls();
startStatusPolling();
startTelemetry();

appendLog(`GCS online — backend: ${BACKEND_URL}`);
appendLog(`Sesi: ROV_${getSessionId()}__*`);
