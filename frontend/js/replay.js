
import { CAMERAS } from "./config.js";
import { appendLog } from "./logger.js";
import { downloadBlob, pickSaveFolder, getFolderName, onFolderChange } from "./storage.js";
import { getReplayData } from "./recorder.js";
import { fmtMs } from "./util.js";

const folderLabelHtml = () => {
  const name = getFolderName();
  return name ? `📁 ${name}` : "📁 Downloads (belum dipilih)";
};

export function openReplayModal() {
  document.getElementById("rov-replay-modal")?.remove();

  const data = getReplayData();
  const hasReplay = !!data;

  const dur       = hasReplay ? data.duration : 0;
  const durStr    = fmtMs(dur);
  const csvCount  = hasReplay ? Math.max(0, data.csvRows.length - 1) : 0;
  const ptCount   = hasReplay ? data.trajPoints.length : 0;
  const logs      = hasReplay ? data.logs.map((e) => ({ rel: e.t - data.recStartMs, text: e.text })) : [];

  const videoUrls = CAMERAS.map((_, i) =>
    hasReplay && data.videoBlobs[i] ? URL.createObjectURL(data.videoBlobs[i]) : null);
  const trajURL = hasReplay && data.trajSnapBlob ? URL.createObjectURL(data.trajSnapBlob) : null;

  const videoHtml = CAMERAS.map((cam, i) => videoUrls[i]
    ? `<div class="rp-vid-wrap"><span>CAM ${cam.id + 1}</span><video id="rv-cam-${i}" src="${videoUrls[i]}" preload="auto"></video></div>`
    : `<div class="rp-vid-wrap rp-no-cam"><i class="fa-solid fa-video-slash"></i><span>CAM ${cam.id + 1} tidak direkam</span></div>`
  ).join("");

  const modal = document.createElement("div");
  modal.id = "rov-replay-modal";
  modal.innerHTML = `
    <div class="rp-overlay" id="rp-overlay"></div>
    <div class="rp-box rp-wide">
      <div class="rp-header">
        <span><i class="fa-solid fa-video"></i> REPLAY — ${hasReplay ? data.sessionId : "—"}</span>
        <button id="rp-close" type="button"><i class="fa-solid fa-xmark"></i></button>
      </div>

      ${!hasReplay ? `
        <div class="rp-no-data">
          <i class="fa-solid fa-circle-info"></i>
          Belum ada sesi yang direkam.<br>
          Tekan <b>START RECORD</b> di panel Controls untuk mulai merekam.
        </div>
      ` : `
        <div class="rp-stat-row">
          <div class="rp-stat"><span>DURASI</span><b>${durStr}</b></div>
          <div class="rp-stat"><span>LOG LINES</span><b>${logs.length}</b></div>
          <div class="rp-stat"><span>TELEM ROWS</span><b>${csvCount}</b></div>
          <div class="rp-stat"><span>TRAJ PTS</span><b>${ptCount}</b></div>
        </div>

        <div class="rp-video-row">${videoHtml}</div>

        ${trajURL ? `
          <div class="rp-traj-row">
            <span class="rp-sect-lbl"><i class="fa-solid fa-map"></i> TRAJECTORY SNAPSHOT</span>
            <img id="rv-traj-img" src="${trajURL}" alt="Trajectory" />
          </div>` : ""}

        <div class="rp-log-section">
          <span class="rp-sect-lbl"><i class="fa-solid fa-terminal"></i> LOG REPLAY
            <em id="rv-log-idx" class="rp-log-idx">0 / ${logs.length}</em>
          </span>
          <div class="rp-log-console" id="rv-log-console"></div>
        </div>

        <div class="rp-ctrl-bar">
          <button id="rv-back"  type="button" title="Ke awal"><i class="fa-solid fa-backward-step"></i></button>
          <button id="rv-play"  type="button" class="rv-play-btn" title="Putar"><i class="fa-solid fa-play"></i></button>
          <button id="rv-pause" type="button" title="Jeda"><i class="fa-solid fa-pause"></i></button>
          <button id="rv-fwd"   type="button" title="Ke akhir"><i class="fa-solid fa-forward-step"></i></button>
          <span id="rv-time" class="rv-time">00:00 / ${durStr}</span>
        </div>

        <div class="rp-progress-row">
          <input type="range" id="rv-seek" min="0" max="${dur}" value="0" step="100" />
        </div>

        <div class="rp-export-row">
          <button id="rp-dl-csv"  type="button"><i class="fa-solid fa-table"></i> CSV Telemetry</button>
          <button id="rp-dl-log"  type="button"><i class="fa-solid fa-scroll"></i> Log TXT</button>
          <button id="rp-dl-traj" type="button"><i class="fa-solid fa-map"></i> Trajectory PNG</button>
        </div>
      `}

      <div class="rp-folder-row">
        <div class="rp-folder-info">
          <span class="rp-folder-label">FOLDER SIMPAN</span>
          <span id="rp-folder-name" class="${getFolderName() ? "" : "rp-folder-unset"}">${folderLabelHtml()}</span>
        </div>
        <button id="rp-pick-folder" type="button"><i class="fa-solid fa-folder-open"></i> ${getFolderName() ? "Ganti" : "Pilih Folder"}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  let anim = null;
  let paused = true;
  const videos = CAMERAS.map((_, i) => document.getElementById(`rv-cam-${i}`)).filter(Boolean);

  const close = () => {
    paused = true;
    if (anim) cancelAnimationFrame(anim);
    modal.remove();
    videoUrls.forEach((u) => u && URL.revokeObjectURL(u));
    if (trajURL) URL.revokeObjectURL(trajURL);
  };
  document.getElementById("rp-close").onclick   = close;
  document.getElementById("rp-overlay").onclick = close;

  document.getElementById("rp-pick-folder").onclick = async () => {
    await pickSaveFolder();
    close();
    openReplayModal();
  };

  if (!hasReplay) return;

  const sid = data.sessionId;
  document.getElementById("rp-dl-csv").onclick = () => {
    if (csvCount === 0) { appendLog("[CSV] Tidak ada data.", "warn"); return; }
    const csv = data.csvRows.map((r) => r.join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), `ROV_${sid}__telemetry.csv`);
    appendLog(`[CSV] Tersimpan: ROV_${sid}__telemetry.csv`);
  };
  document.getElementById("rp-dl-log").onclick = () => {
    downloadBlob(new Blob([logs.map((l) => l.text).join("\n")], { type: "text/plain" }), `ROV_${sid}__log.txt`);
    appendLog(`[LOG] Tersimpan: ROV_${sid}__log.txt`);
  };
  document.getElementById("rp-dl-traj").onclick = () => {
    if (!data.trajSnapBlob) { appendLog("[TRAJ] Tidak ada snapshot.", "warn"); return; }
    downloadBlob(data.trajSnapBlob, `ROV_${sid}__trajectory.png`);
    appendLog(`[TRAJ] Tersimpan: ROV_${sid}__trajectory.png`);
  };

  const seekEl     = document.getElementById("rv-seek");
  const timeEl     = document.getElementById("rv-time");
  const logConsole = document.getElementById("rv-log-console");
  const logIdxEl   = document.getElementById("rv-log-idx");
  const playBtn    = document.getElementById("rv-play");

  let elapsed = 0;   
  let startWall = 0;
  let shownLogs = 0;

  function syncUI(ms, seekVideo) {
    const t = Math.min(Math.max(ms, 0), dur);

    if (seekVideo) videos.forEach((v) => { v.currentTime = t / 1000; });
    if (seekEl) seekEl.value = t;
    if (timeEl) timeEl.textContent = `${fmtMs(t)} / ${durStr}`;

    let count = 0;
    while (count < logs.length && logs[count].rel <= t) count++;
    if (count !== shownLogs) {
      if (count < shownLogs) { logConsole.innerHTML = ""; shownLogs = 0; }
      for (let i = shownLogs; i < count; i++) {
        const line = document.createElement("div");
        line.textContent = logs[i].text;
        logConsole.appendChild(line);
      }
      shownLogs = count;
      logConsole.scrollTop = logConsole.scrollHeight;
      logIdxEl.textContent = `${count} / ${logs.length}`;
    }
  }

  function pause() {
    if (paused) return;
    paused = true;
    elapsed = performance.now() - startWall;
    if (anim) cancelAnimationFrame(anim);
    videos.forEach((v) => v.pause());
  }

  function finish() {
    paused = true;
    elapsed = 0;
    videos.forEach((v) => { v.pause(); v.currentTime = 0; });
    syncUI(0, true);
  }

  function play() {
    if (!paused || dur <= 0) return;
    paused = false;
    startWall = performance.now() - elapsed;
    videos.forEach((v) => { v.currentTime = elapsed / 1000; v.play().catch(() => {}); });

    const tick = () => {
      if (paused) return;
      const now = performance.now() - startWall;
      if (now >= dur) { finish(); return; }
      syncUI(now, false);
      anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  }

  playBtn.onclick = play;
  document.getElementById("rv-pause").onclick = pause;
  document.getElementById("rv-back").onclick = () => { pause(); elapsed = 0;   syncUI(0, true); };
  document.getElementById("rv-fwd").onclick  = () => { pause(); elapsed = dur; syncUI(dur, true); };

  seekEl.addEventListener("input", () => {
    pause();
    elapsed = Number(seekEl.value);
    syncUI(elapsed, true);
  });

  syncUI(0, true);
}


onFolderChange(() => {
  const badge = document.getElementById("rp-folder-name");
  if (badge) {
    badge.textContent = folderLabelHtml();
    badge.classList.toggle("rp-folder-unset", !getFolderName());
  }
});
