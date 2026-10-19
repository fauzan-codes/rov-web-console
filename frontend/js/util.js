//  ./frontend/js/util.js
//  util.js - fungsi kecil yang dipakai banyak modul


export const $ = (id) => document.getElementById(id);

const pad = (n) => String(n).padStart(2, "0");

/** Cap waktu lokal untuk nama file: 2026-10-21-03-20-11 */
export function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
    `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** Jam saja untuk nama file snapshot: 03-46-27 */
export function timeTag(d = new Date()) {
  return `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** Milidetik: "mm:ss" */
export function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
