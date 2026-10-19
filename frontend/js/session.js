//  ./frontend/js/session.js
//  session.js - ID sesi untuk penamaan file

//  NOTE:
//  Semua file sesi memakai prefix:  ROV_<SESSION_ID>__*
//  Contoh:
//    ROV_2026-10-16-10-26-05__video_CAM1.webm
//    ROV_2026-10-16-10-26-05__telemetry.csv
//    ROV_2026-10-16-10-26-05__trajectory.png
//    ROV_2026-10-16-10-26-05__log.txt
//    ROV_2026-10-16-10-26-05__snap_CAM1_10-26-18.jpg


import { stamp } from "./util.js";

let sessionId = stamp();

export const getSessionId = () => sessionId;
export const sesPrefix    = () => `ROV_${sessionId}`;

export function newSession() {
  sessionId = stamp();
  return sessionId;
}
