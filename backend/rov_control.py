"""
./backend/rov_control.py
rov_control.py - Kontrol ROV dari GCS (Tahap 2): joystick -> MANUAL_CONTROL, heartbeat GCS, arm/disarm, ganti mode.

Dipakai oleh gcs_server.py:
    import rov_control
    rov_control.init(app, ...)      # daftarkan route /control/*
    rov_control.start()             # nyalakan thread pengirim + heartbeat

ALUR:
  Browser (Gamepad API, 20 Hz)  --POST /control/axes-->  backend menyimpan nilai TERBARU (sumbu + tombol)
  Thread pengirim (20 Hz tetap) --MANUAL_CONTROL-->      mavlink-routerd (UDP 14560) --> Pixhawk
  Thread heartbeat (1 Hz)       --HEARTBEAT (type GCS)-> Pixhawk (supaya failsafe GCS tidak aktif)

TOMBOL JOYSTICK:
  Fungsi tombol (arm, disarm, mode_*, shift, gain_inc, ...) tersimpan di PIXHAWK (BTNn_FUNCTION / BTNn_SFUNCTION),
  yang sama dengan yang diatur QGC. Backend hanya meneruskan bitmask tombol yang sedang ditekan di field
  `buttons` MANUAL_CONTROL (16 bit, tombol 0..15). Shift dan semua fungsi diproses firmware.
  Bitmask dinolkan saat control OFF / watchdog basi / STOP, supaya tombol tidak "nyangkut" ditekan.

PENGAMAN (jangan dilepas):
  1. Default MATI: butuh ROV_ENABLE_CONTROL=1, lalu operator harus menekan ENABLE CONTROL di UI.
  2. Watchdog di BACKEND: kalau tidak ada paket joystick > WATCHDOG_S, yang dikirim netral (tombol dilepas).
  3. Netral saat: STOP ditekan, Pixhawk terputus, joystick/tab/jaringan putus (watchdog).
  4. Enable hanya diterima kalau semua stick netral dan tidak ada tombol ditekan (robot tidak "melompat").
  5. Nilai dari browser dibatasi -1..1 lalu dikali LIMIT (ROV_CONTROL_LIMIT) di sini, bukan percaya browser.
  6. Satu sumber kontrol: ArduSub hanya menerima MANUAL_CONTROL dari system id = SYSID_MYGCS (bawaan 255).
     Backend memakai id yang sama dengan QGC, jadi QGC (joystick-nya) HARUS dimatikan saat GCS web dipakai nyetir.

SATUAN MANUAL_CONTROL (ArduSub):
  x (maju +), y (kanan +), r (yaw searah jarum jam +) : -1000..1000
  z (naik +)                                          : 0..1000, netral = 500
  buttons                                             : bitmask 16 bit
  -> VERIFIKASI di bangku (baling-baling dilepas) sebelum masuk air.

CATATAN GAIN: firmware ArduSub juga punya "pilot gain" sendiri (tombol gain_inc / gain_dec, JS_GAIN_*) yang
mengalikan input ini. Jadi kekuatan akhir = gain di popup Settings x LIMIT x gain firmware.
"""

import math
import os
import threading
import time
from types import SimpleNamespace

from flask import jsonify, request

# ==================== KONFIGURASI ====================
SEND_HZ = 20                 # laju kirim MANUAL_CONTROL ke Pixhawk (tetap, tidak ikut browser)
WATCHDOG_S = float(os.environ.get("ROV_CONTROL_WATCHDOG", "0.4"))   # detik tanpa paket joystick -> netral
HEARTBEAT_S = 1.0            # interval heartbeat GCS
CMD_TIMEOUT = 2.0            # detik menunggu ACK Pixhawk (arm / mode)
NEUTRAL_BURST = 10           # berapa frame netral dikirim setelah control dimatikan (10 x 50 ms)
START_NEUTRAL_TOL = 0.05     # stick dianggap netral kalau |nilai| <= ini saat ENABLE
BUTTON_MASK = 0xFFFF         # field `buttons` MANUAL_CONTROL = 16 bit (tombol 0..15)
# Batas kekuatan di sisi backend (0.05 - 1.0). Untuk tes pertama di air, pakai mis. ROV_CONTROL_LIMIT=0.5
LIMIT = max(0.05, min(1.0, float(os.environ.get("ROV_CONTROL_LIMIT", "1.0"))))
# Token sederhana (opsional). Kalau diisi, endpoint kontrol butuh header X-ROV-Token yang sama.
TOKEN = os.environ.get("ROV_CONTROL_TOKEN", "")

AXES = ("surge", "sway", "heave", "yaw")

# Nomor mode ArduSub (custom_mode)
ARDUSUB_MODES = {
  0: "STABILIZE", 1: "ACRO", 2: "DEPTH HOLD", 3: "AUTO", 4: "GUIDED",
  7: "CIRCLE", 9: "SURFACE", 16: "POSHOLD", 19: "MANUAL",
}
UI_MODES = {"manual": 19, "stabilize": 0, "depth_hold": 2}


# ==================== STATE ====================
_ctx = None
_lock = threading.Lock()
_active = False                       # operator sudah menekan ENABLE CONTROL
_reason = ""                          # alasan control terakhir dimatikan
_axes = dict.fromkeys(AXES, 0.0)      # nilai terbaru dari browser (-1..1)
_buttons = 0                          # bitmask tombol terbaru dari browser
_axes_t = 0.0                         # waktu paket joystick terakhir
_last = {"x": 0, "y": 0, "z": 500, "r": 0, "b": 0}   # paket terakhir yang dikirim
_sent = 0
_stale = False
_burst = 0
_started = False


class ControlError(Exception):
  def __init__(self, message, code=409, **extra):
    super().__init__(message)
    self.code = code
    self.extra = extra


def _log(msg):
  print(f"[CTRL] {msg}")


def _err(message, code, **extra):
  return jsonify({"ok": False, "error": message, **extra}), code


def mode_name(custom_mode):
  if custom_mode is None:
    return "--"
  return ARDUSUB_MODES.get(int(custom_mode), f"MODE {int(custom_mode)}")


def is_active():
  return _active


# ==================== UTILITAS ====================
def _num(v):
  try:
    v = float(v)
  except (TypeError, ValueError):
    return 0.0
  return v if math.isfinite(v) else 0.0


def _clean_axes(d):
  d = d if isinstance(d, dict) else {}
  return {k: max(-1.0, min(1.0, _num(d.get(k)))) for k in AXES}


def _clean_buttons(v):
  """Bitmask tombol dari browser -> int 0..0xFFFF. Nilai aneh dianggap 'tidak ada tombol'."""
  try:
    n = int(v)
  except (TypeError, ValueError):
    return 0
  return n & BUTTON_MASK if n > 0 else 0


def _packet(axes):
  """Nilai -1..1 -> (x, y, z, r) untuk MANUAL_CONTROL, sudah dikali LIMIT dan dibatasi."""
  x = round(axes["surge"] * LIMIT * 1000)
  y = round(axes["sway"] * LIMIT * 1000)
  r = round(axes["yaw"] * LIMIT * 1000)
  z = round(500 + axes["heave"] * LIMIT * 500)
  return int(x), int(y), int(max(0, min(1000, z))), int(r)


def _connected():
  if _ctx.dev_mode:
    return True
  return bool(_ctx.state.get("mavlink_connected")) and _ctx.get_master() is not None


def _need_master():
  if _ctx.mavutil is None:
    raise ControlError("pymavlink tidak terpasang di backend", 503)
  master = _ctx.get_master()
  if master is None:
    raise ControlError("Pixhawk belum terhubung", 409)
  return master


def _wait_for(cond_fn, timeout):
  deadline = time.time() + timeout
  while time.time() < deadline:
    if cond_fn():
      return True
    time.sleep(0.1)
  return cond_fn()


def _command_long(cmd, p1=0, p2=0, p3=0, p4=0, p5=0, p6=0, p7=0, timeout=CMD_TIMEOUT):
  """
  Kirim COMMAND_LONG, tunggu COMMAND_ACK. Mengembalikan (result, result_text, pixhawk_text).
  pixhawk_text = STATUSTEXT yang muncul setelah perintah dikirim (alasan penolakan dari Pixhawk).
  """
  master = _need_master()
  t_sent = time.time()
  with _ctx.send_lock:
    master.mav.command_long_send(
      master.target_system, master.target_component, cmd, 0,
      p1, p2, p3, p4, p5, p6, p7,
    )
  deadline = t_sent + timeout
  with _ctx.cond:
    while True:
      ack = _ctx.last_ack.get(int(cmd))
      if ack and ack["t"] >= t_sent:
        break
      remaining = deadline - time.time()
      if remaining <= 0:
        raise ControlError("Pixhawk tidak membalas perintah", 502)
      _ctx.cond.wait(remaining)
  try:
    text = _ctx.mavutil.mavlink.enums["MAV_RESULT"][ack["result"]].name
  except Exception:
    text = str(ack["result"])
  if ack["result"] != 0:
    time.sleep(0.4)   # STATUSTEXT penjelasan sering tiba sesaat setelah ACK
  return ack["result"], text, _ctx.statustext_since(t_sent)


# ==================== ON / OFF ====================
def deactivate(reason=""):
  """Matikan control. Frame netral (tombol dilepas) tetap dikirim beberapa saat supaya robot pasti berhenti."""
  global _active, _reason, _burst, _buttons
  with _lock:
    was = _active
    _active = False
    _reason = reason
    _axes.update(dict.fromkeys(AXES, 0.0))
    _buttons = 0
    _burst = NEUTRAL_BURST if was else 0
  if was:
    _log(f"Control OFF ({reason})")


# ==================== THREAD ====================
def _tick():
  global _burst, _last, _sent, _stale
  with _lock:
    active = _active
    burst = _burst
    axes = dict(_axes)
    buttons = _buttons
    age = time.time() - _axes_t
  if not active and burst <= 0:
    return

  master = None
  if not _ctx.dev_mode:
    master = _ctx.get_master()
    if master is None:
      if active:
        deactivate("Pixhawk terputus")
      return

  # WATCHDOG: paket joystick terlalu lama tidak datang -> netral, semua tombol dilepas
  stale = active and age > WATCHDOG_S
  if not active or stale:
    axes = dict.fromkeys(AXES, 0.0)
    buttons = 0

  x, y, z, r = _packet(axes)
  if master is not None:
    try:
      with _ctx.send_lock:
        master.mav.manual_control_send(master.target_system, x, y, z, r, buttons)
    except Exception as e:
      _log(f"Gagal kirim MANUAL_CONTROL: {e}")
      return

  with _lock:
    _last = {"x": x, "y": y, "z": z, "r": r, "b": buttons}
    _sent += 1
    _stale = stale
    if not _active and _burst > 0:
      _burst -= 1


def _sender_loop():
  period = 1.0 / SEND_HZ
  while True:
    t0 = time.time()
    try:
      _tick()
    except Exception as e:
      _log(f"Error di pengirim: {e}")
    sleep_left = period - (time.time() - t0)
    if sleep_left > 0:
      time.sleep(sleep_left)


def _heartbeat_loop():
  """HEARTBEAT GCS 1 Hz. Tanpa ini, failsafe GCS ArduSub (FS_GCS_ENABLE) bisa aktif saat QGC tidak ada."""
  while True:
    time.sleep(HEARTBEAT_S)
    if not _ctx.enabled or _ctx.dev_mode or _ctx.mavutil is None:
      continue
    master = _ctx.get_master()
    if master is None:
      continue
    mav = _ctx.mavutil.mavlink
    try:
      with _ctx.send_lock:
        master.mav.heartbeat_send(
          mav.MAV_TYPE_GCS, mav.MAV_AUTOPILOT_INVALID, 0, 0, mav.MAV_STATE_ACTIVE
        )
    except Exception as e:
      _log(f"Gagal kirim heartbeat: {e}")


# ==================== ROUTE ====================
def _guard():
  if TOKEN and request.headers.get("X-ROV-Token", "") != TOKEN:
    return _err("Token kontrol salah atau belum diisi", 401)
  if not _ctx.enabled:
    return _err("Kontrol dimatikan di backend. Jalankan backend dengan ROV_ENABLE_CONTROL=1.", 403)
  return None


def _status_dict():
  st = _ctx.state
  with _lock:
    age_ms = int((time.time() - _axes_t) * 1000) if _axes_t else None
    data = {
      "active": _active,
      "reason": _reason,
      "stale": _stale and _active,
      "age_ms": age_ms,
      "last": dict(_last),
      "sent": _sent,
    }
  cm = st.get("custom_mode")
  data.update({
    "ok": True,
    "available": bool(_ctx.enabled),
    "dev": bool(_ctx.dev_mode),
    "connected": _connected(),
    "armed": bool(st.get("armed")),
    "mode": mode_name(cm),
    "mode_id": cm,
    "limit": LIMIT,
    "watchdog_ms": int(WATCHDOG_S * 1000),
    "token_required": bool(TOKEN),
  })
  return data


def control_status():
  return jsonify(_status_dict())


def control_enable():
  global _active, _reason, _axes_t, _buttons
  g = _guard()
  if g:
    return g
  body = request.get_json(force=True, silent=True) or {}

  if not body.get("enabled"):
    deactivate("dimatikan operator")
    return jsonify(_status_dict())

  if not _connected():
    return _err("Pixhawk belum terhubung", 409)
  axes = _clean_axes(body.get("axes"))
  if any(abs(v) > START_NEUTRAL_TOL for v in axes.values()):
    return _err("Stick belum netral. Lepas semua stick, lalu coba lagi.", 409)
  if _clean_buttons(body.get("buttons")) != 0:
    return _err("Ada tombol joystick yang masih ditekan. Lepas dulu, lalu coba lagi.", 409)

  with _lock:
    _active = True
    _reason = ""
    _axes.update(dict.fromkeys(AXES, 0.0))
    _buttons = 0
    _axes_t = 0.0        # dianggap basi sampai paket joystick pertama tiba -> netral
  _log(f"Control ON (limit {int(LIMIT * 100)}%, watchdog {int(WATCHDOG_S * 1000)} ms)")
  return jsonify(_status_dict())


def control_axes():
  """Dipanggil browser ~20 Hz. Hanya menyimpan nilai terbaru; pengiriman ke Pixhawk dilakukan thread pengirim."""
  global _axes_t, _buttons
  g = _guard()
  if g:
    return g
  body = request.get_json(force=True, silent=True)
  axes = _clean_axes(body)
  buttons = _clean_buttons(body.get("buttons") if isinstance(body, dict) else 0)
  with _lock:
    if not _active:
      return jsonify({"ok": True, "active": False, "reason": _reason})
    _axes.update(axes)
    _buttons = buttons
    _axes_t = time.time()
  return jsonify({"ok": True, "active": True})


def control_stop():
  """STOP: selalu boleh (tanpa token / tanpa ENABLE), karena menghentikan itu selalu aman."""
  deactivate("STOP operator")
  return jsonify(_status_dict())


def control_arm():
  g = _guard()
  if g:
    return g
  body = request.get_json(force=True, silent=True) or {}
  want = bool(body.get("arm"))
  label = "ARM" if want else "DISARM"
  try:
    if _ctx.dev_mode:
      time.sleep(0.2)
      _ctx.state["armed"] = want
    else:
      mav = _ctx.mavutil.mavlink if _ctx.mavutil else None
      if mav is None:
        raise ControlError("pymavlink tidak terpasang di backend", 503)
      result, text, px = _command_long(mav.MAV_CMD_COMPONENT_ARM_DISARM, 1 if want else 0)
      if result != 0:
        _log(f"{label} ditolak: {text} | {px}")
        return _err(f"Pixhawk menolak {label} ({text})", 409, pixhawk_text=px)
    # status armed datang lewat HEARTBEAT (1 Hz): tunggu sampai berubah
    verified = _wait_for(lambda: bool(_ctx.state.get("armed")) == want, 3.0)
  except ControlError as e:
    return _err(str(e), e.code, **e.extra)
  _log(f"{label}: {'terbukti' if verified else 'BELUM terbukti'} dari heartbeat")
  return jsonify({"ok": True, "armed": bool(_ctx.state.get("armed")), "verified": verified})


def control_mode():
  g = _guard()
  if g:
    return g
  body = request.get_json(force=True, silent=True) or {}
  cid = UI_MODES.get(body.get("mode"))
  if cid is None:
    return _err(f"Mode harus salah satu dari: {', '.join(UI_MODES)}", 400)
  try:
    if _ctx.dev_mode:
      time.sleep(0.2)
      _ctx.state["custom_mode"] = cid
    else:
      mav = _ctx.mavutil.mavlink if _ctx.mavutil else None
      if mav is None:
        raise ControlError("pymavlink tidak terpasang di backend", 503)
      # p1 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED (1), p2 = nomor mode ArduSub
      result, text, px = _command_long(mav.MAV_CMD_DO_SET_MODE, 1, cid)
      if result != 0:
        _log(f"Ganti mode ditolak: {text} | {px}")
        return _err(f"Pixhawk menolak ganti mode ({text})", 409, pixhawk_text=px)
    verified = _wait_for(lambda: _ctx.state.get("custom_mode") == cid, 3.0)
  except ControlError as e:
    return _err(str(e), e.code, **e.extra)
  _log(f"Mode -> {mode_name(cid)}: {'terbukti' if verified else 'BELUM terbukti'} dari heartbeat")
  return jsonify({"ok": True, "mode": mode_name(_ctx.state.get("custom_mode")), "verified": verified})


# ==================== INIT / START ====================
def init(app, *, get_master, send_lock, cmd_lock, cond, last_ack, state,
         statustext_since, enabled, dev_mode, mavutil, sysid):
  """
  Dipanggil sekali dari gcs_server.py setelah semua yang dibutuhkan terdefinisi.
    get_master       : fungsi tanpa argumen -> objek koneksi pymavlink (atau None)
    send_lock        : lock untuk SEMUA pengiriman ke Pixhawk (dibagi dengan gcs_server)
    cond / last_ack  : Condition + dict ACK terakhir yang diisi handler COMMAND_ACK gcs_server
    state            : dict state global (armed, custom_mode, mavlink_connected)
    statustext_since : fungsi(waktu) -> teks STATUSTEXT sejak waktu itu
  """
  global _ctx
  _ctx = SimpleNamespace(
    get_master=get_master, send_lock=send_lock, cmd_lock=cmd_lock, cond=cond,
    last_ack=last_ack, state=state, statustext_since=statustext_since,
    enabled=enabled, dev_mode=dev_mode, mavutil=mavutil, sysid=sysid,
  )
  if dev_mode:
    state.setdefault("custom_mode", 19)

  app.add_url_rule("/control/status", "control_status", control_status)
  app.add_url_rule("/control/enable", "control_enable", control_enable, methods=["POST"])
  app.add_url_rule("/control/axes", "control_axes", control_axes, methods=["POST"])
  app.add_url_rule("/control/stop", "control_stop", control_stop, methods=["POST"])
  app.add_url_rule("/control/arm", "control_arm", control_arm, methods=["POST"])
  app.add_url_rule("/control/mode", "control_mode", control_mode, methods=["POST"])


def start():
  global _started
  if _started:
    return
  _started = True
  threading.Thread(target=_sender_loop, daemon=True).start()
  threading.Thread(target=_heartbeat_loop, daemon=True).start()
  _log(
    f"Siap. Kontrol {'AKTIF (boleh dinyalakan operator)' if _ctx.enabled else 'MATI (set ROV_ENABLE_CONTROL=1)'}, "
    f"limit {int(LIMIT * 100)}%, watchdog {int(WATCHDOG_S * 1000)} ms, system id {_ctx.sysid}."
  )
  if _ctx.enabled and not _ctx.dev_mode and _ctx.sysid != 255:
    _log("PERINGATAN: system id bukan 255. ArduSub (SYSID_MYGCS bawaan 255) akan MENGABAIKAN MANUAL_CONTROL dari id ini.")