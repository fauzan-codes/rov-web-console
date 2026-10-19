
import { stamp } from "./util.js";

let sessionId = stamp();

export const getSessionId = () => sessionId;
export const sesPrefix    = () => `ROV_${sessionId}`;

export function newSession() {
  sessionId = stamp();
  return sessionId;
}
