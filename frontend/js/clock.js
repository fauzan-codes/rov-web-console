//  ./frontend/js/clock.js
//  clock.js - tanggal & jam di header Memakai zona waktu tetap (config.js), jadi tidak salah kalau laptop disetel ke zona waktu lain.


import { TIMEZONE, TIMEZONE_LABEL } from "./config.js";
import { $ } from "./util.js";

const dayFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIMEZONE, weekday: "long", day: "2-digit", month: "long", year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

export function startClock() {
  const dayEl  = $("currentDay");
  const timeEl = $("currentTime");

  const update = () => {
    const now = new Date();
    if (dayEl)  dayEl.textContent  = dayFmt.format(now).toUpperCase();
    if (timeEl) timeEl.textContent = `${timeFmt.format(now)} ${TIMEZONE_LABEL}`;
  };

  update();
  setInterval(update, 1000);
}
