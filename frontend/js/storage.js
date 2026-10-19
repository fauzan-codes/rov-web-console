//  ./frontend/js/storage.js
//  storage.js - simpan file ke laptop

//  NOTE:
//  Pakai File System Access API (Chrome/Edge): pengguna memilih satu
//  folder, lalu semua file berikutnya langsung tertulis ke sana.
//  Kalau folder belum dipilih / browser tidak mendukung (Firefox),
//  fallback ke download biasa (folder Downloads).


import { appendLog } from "./logger.js";

let rootDirHandle = null;
const fsaSupported = "showDirectoryPicker" in window;
const listeners = [];

export const isFolderPickerSupported = () => fsaSupported;
export const getFolderName = () => (rootDirHandle ? rootDirHandle.name : null);

export function onFolderChange(cb) {
  listeners.push(cb);
}

function notifyFolderChange() {
  listeners.forEach((cb) => cb(getFolderName()));
}

export async function pickSaveFolder() {
  if (!fsaSupported) {
    appendLog("[FOLDER] Browser tidak support File System Access API. Pakai Downloads biasa.", "warn");
    return false;
  }
  try {
    rootDirHandle = await window.showDirectoryPicker({
      id: "rov-replay",
      mode: "readwrite",
      startIn: "documents",
    });
    appendLog(`[FOLDER] ✓ Folder dipilih: "${rootDirHandle.name}" — semua file akan disimpan di sini.`);
    notifyFolderChange();
    return true;
  } catch (e) {
    if (e.name !== "AbortError") appendLog(`[FOLDER] ✖ Gagal pilih folder: ${e.message}`, "error");
    else appendLog("[FOLDER] Dialog dibatalkan — pakai folder Downloads biasa.");
    return false;
  }
}

/** Simpan Blob ke folder terpilih, atau fallback ke <a download>. */
export async function downloadBlob(blob, filename) {
  if (rootDirHandle) {
    try {
      const perm = await rootDirHandle.queryPermission({ mode: "readwrite" });
      if (perm !== "granted") await rootDirHandle.requestPermission({ mode: "readwrite" });

      const fileHandle = await rootDirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      appendLog(`[FOLDER] ✖ Gagal tulis ke folder: ${e.message} — fallback ke Downloads.`, "error");
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
