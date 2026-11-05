"""
./backend/rov_control.py
rov_control.py - Modul kontrol vehicle: joystick -> MANUAL_CONTROL, heartbeat GCS, ARM/DISARM, mode, dan Button Assignment.

Modul ini diimpor oleh gcs_server.py:
    import rov_control
    rov_control.init(app, ...)   # mendaftarkan route /control/* dan /buttons/*
    rov_control.start()          # menjalankan thread pengirim MANUAL_CONTROL dan thread heartbeat

ARSITEKTUR
  Input source --> backend (menyimpan nilai TERBARU: axes + buttons)
  Sender thread (20 Hz tetap) --MANUAL_CONTROL--> mavlink-routerd (UDP 14560) --> Pixhawk
  Heartbeat thread (1 Hz)     --HEARTBEAT (type GCS)--> Pixhawk (mencegah GCS failsafe)

INPUT SOURCE (dipilih saat Enable Control)
  "bridge"  : tools/joystick_bridge.py membaca joystick di laptop operator dan mengirim nilai MENTAH ke /control/raw. Mapping, deadband, expo, dan gain diterapkan di backend. Tidak terpengaruh fokus / tab browser (disarankan).
  "browser" : dashboard membaca joystick lewat Gamepad API dan mengirim nilai SUDAH DIOLAH ke /control/axes. Hanya berfungsi selama tab tampil dan fokus (batasan browser).

KONFIGURASI JOYSTICK
  Axis mapping, invert, deadband, exponential, dan gain diatur di dashboard (Settings > Joystick), dikirim ke /control/config, lalu disimpan di backend/joystick_config.json (dibuat otomatis). Dipakai oleh sumber "bridge".

BUTTON FUNCTIONS
  Fungsi tiap tombol (arm, disarm, mode_*, shift, gain_inc, ...) disimpan di PIXHAWK sebagai parameter BTNn_FUNCTION / BTNn_SFUNCTION, sama seperti QGroundControl. 
  Backend hanya meneruskan bitmask tombol yang sedang ditekan melalui field `buttons` pada MANUAL_CONTROL (16 bit). 
  Nomor tombol mengikuti urutan SDL GameController (sama dengan QGC).
  - Vehicle nyata : fungsi dijalankan firmware, hanya selama Enable Control aktif (MANUAL_CONTROL baru dikirim saat itu).
  - DEV mode      : backend meniru fungsi dasar firmware (arm, disarm, mode, gain) dengan tabel simulasi di memori.
                    Fungsi lain (servo, lampu, camera tilt) hanya dicatat di log.
  - Tabel fungsi dapat diubah dari Settings > Button Assignment (menulis parameter di Pixhawk, atau tabel simulasi di DEV mode).

SAFETY (jangan dilepas)
  1. Default MATI: butuh ROV_ENABLE_CONTROL=1, lalu operator menekan Enable Control di UI.
  2. Watchdog di backend: tidak ada data joystick > WATCHDOG_S -> kirim netral dan lepas semua tombol.
  3. Tidak ada data > STALE_OFF_S -> control dimatikan; operator harus Enable ulang (mencegah lonjakan saat data pulih).
  4. Enable hanya diterima jika semua stick netral dan tidak ada tombol ditekan.
  5. Nilai dibatasi -1..1 lalu dikali LIMIT (ROV_CONTROL_LIMIT) di backend; input dari klien tidak dipercaya begitu saja.
  6. Satu sumber kontrol: ArduSub hanya menerima MANUAL_CONTROL dari system id = SYSID_MYGCS (default 255).
     Backend memakai id yang sama dengan QGC, sehingga joystick QGC HARUS dinonaktifkan saat mengemudi dari sini.
  7. Bridge berhenti / joystick dicabut -> control dimatikan otomatis.
  8. STOP selalu diizinkan tanpa token, karena menghentikan vehicle tidak pernah berbahaya.

UNIT MANUAL_CONTROL (ArduSub)
  x (maju +), y (kanan +), r (yaw searah jarum jam +) : -1000..1000
  z (naik +)                                          : 0..1000, netral = 500
  buttons                                             : bitmask 16 bit

CATATAN GAIN
  Firmware ArduSub memiliki "pilot gain" sendiri (fungsi tombol gain_inc / gain_dec, parameter JS_GAIN_*).
  Output akhir = gain (Settings) x LIMIT x pilot gain firmware, sama seperti pada QGC.

ENVIRONMENT VARIABLES
  ROV_ENABLE_CONTROL=1       mengaktifkan fitur yang menulis ke vehicle (otomatis aktif di DEV mode)
  ROV_CONTROL_LIMIT=0.05-1   batas kekuatan output (default 1.0)
  ROV_CONTROL_WATCHDOG=<s>   batas waktu tanpa data sebelum output dinetralkan (default 0.4)
  ROV_CONTROL_TOKEN=<token>  opsional; endpoint kontrol mewajibkan header X-ROV-Token yang sama
"""

import collections
import copy
import json
import math
import os
import threading
import time
from pathlib import Path
from types import SimpleNamespace

from flask import jsonify, request

# ==================== KONFIGURASI ====================
SEND_HZ = 20                 # frekuensi tetap pengiriman MANUAL_CONTROL ke Pixhawk (independen dari laju input)
WATCHDOG_S = float(os.environ.get("ROV_CONTROL_WATCHDOG", "0.4"))   # tanpa data selama ini -> output dinetralkan
STALE_OFF_S = 2.0            # tanpa data selama ini -> control dimatikan (perlu Enable ulang)
BRIDGE_FRESH_S = 1.0         # Bridge dianggap terhubung jika paket terakhir lebih baru dari ini
BTN_LATCH_S = 0.6            # tombol yang baru ditekan tetap tampil di UI selama ini, agar tap singkat tidak terlewat oleh polling
HEARTBEAT_S = 1.0            # interval heartbeat GCS
CMD_TIMEOUT = 2.0            # batas tunggu COMMAND_ACK dari Pixhawk (ARM / mode)
NEUTRAL_BURST = 10           # jumlah frame netral yang dikirim setelah control dimatikan (10 x 50 ms)
START_NEUTRAL_TOL = 0.05     # stick dianggap netral jika |nilai| <= ini saat Enable
BUTTON_MASK = 0xFFFF         # field `buttons` pada MANUAL_CONTROL berukuran 16 bit (tombol 0..15)
# Batas kekuatan output di backend (0.05 - 1.0). Gunakan nilai kecil (mis. 0.5) untuk uji pertama di air.
LIMIT = max(0.05, min(1.0, float(os.environ.get("ROV_CONTROL_LIMIT", "1.0"))))
# Token sederhana (opsional). Jika diisi, endpoint kontrol mewajibkan header X-ROV-Token yang sama.
TOKEN = os.environ.get("ROV_CONTROL_TOKEN", "")
CONFIG_FILE = Path(__file__).resolve().parent / "joystick_config.json"

AXES = ("surge", "sway", "heave", "yaw")

# Nomor mode ArduSub (custom_mode)
ARDUSUB_MODES = {
  0: "STABILIZE", 1: "ACRO", 2: "DEPTH HOLD", 3: "AUTO", 4: "GUIDED",
  7: "CIRCLE", 9: "SURFACE", 16: "POSHOLD", 19: "MANUAL",
}
UI_MODES = {"manual": 19, "stabilize": 0, "depth_hold": 2}

# ==== Fungsi tombol joystick (parameter BTNn_FUNCTION / BTNn_SFUNCTION pada ArduSub) ====
# Nomor fungsi = nilai parameter. Daftar ini hanya memuat fungsi yang umum dipakai; fungsi lain (servo / actuator,
# relay, roll_pitch_toggle, trim, dst.) tetap dapat dipasang lewat opsi "Other number..." di UI.
# Catatan: nomor 6 (mode_stabilize) dan 31 (lights1_cycle) diturunkan dari urutan pada dokumentasi ArduSub;
# verifikasi terhadap versi firmware yang dipakai (mis. lewat halaman Joystick di QGC).
BTN_COUNT = 15               # tombol 0..14 (urutan QGC / SDL GameController)
BTN_FUNCTIONS = [
  (0, "disabled"), (1, "shift"), (2, "arm_toggle"), (3, "arm"), (4, "disarm"),
  (5, "mode_manual"), (6, "mode_stabilize"), (7, "mode_depth_hold"),
  (21, "mount_center"), (22, "mount_tilt_up"), (23, "mount_tilt_down"),
  (31, "lights1_cycle"), (32, "lights1_brighter"), (33, "lights1_dimmer"),
  (41, "gain_toggle"), (42, "gain_inc"), (43, "gain_dec"),
]
BTN_NAME = {i: n for i, n in BTN_FUNCTIONS}

# Tabel simulasi (DEV mode). Default meniru layout QGroundControl yang umum dipakai pada ROV; hanya memuat fungsi
# dari daftar di atas. Berada di memori, sehingga kembali ke default setiap backend di-restart.
# Format: nomor tombol: (fungsi, fungsi saat shift)
_DEV_BTN_DEFAULT = {
  0: (21, 0), 1: (5, 0), 2: (7, 0), 3: (6, 0), 4: (4, 0), 5: (1, 0), 6: (3, 0),
  11: (42, 0), 12: (43, 0),
}
# Pilot gain ArduSub (JS_GAIN_*): default 0.5, naik/turun dalam JS_GAIN_STEPS langkah antara min dan max.
JS_GAIN_MIN, JS_GAIN_MAX, JS_GAIN_STEPS, JS_GAIN_DEFAULT = 0.25, 1.0, 4, 0.5

# Default joystick configuration (layout "Mode 4", sama dengan defaultConfig() di frontend/js/joystick.js):
#   stick kiri  : horizontal = Yaw,     vertikal = Forward  (atas = maju)
#   stick kanan : horizontal = Lateral, vertikal = Throttle (atas = naik)
# Indeks axis mengikuti urutan SDL / Gamepad "standard": 0 Left X, 1 Left Y, 2 Right X, 3 Right Y.
JOY_DEFAULT = {
  "axes": {
    "surge": {"axis": 1, "invert": True},
    "sway":  {"axis": 2, "invert": False},
    "heave": {"axis": 3, "invert": True},
    "yaw":   {"axis": 0, "invert": False},
  },
  "deadzone": 0.05,
  "expo": 0.0,
  "gain": 1.0,
}


# ==================== STATE ====================
_ctx = None
_lock = threading.Lock()
_active = False                       # True selama Enable Control aktif
_source = ""                          # "bridge" | "browser": sumber yang sedang menyetir
_reason = ""                          # alasan control terakhir dimatikan
_axes = dict.fromkeys(AXES, 0.0)      # nilai terbaru yang SUDAH diolah (-1..1)
_buttons = 0                          # bitmask tombol terbaru
_axes_t = 0.0                         # waktu data joystick terakhir dari source yang aktif
_last = {"x": 0, "y": 0, "z": 500, "r": 0, "b": 0}   # paket terakhir yang dikirim
_sent = 0
_stale = False
_burst = 0
_started = False
_bridge = {"t": 0.0, "connected": False, "name": "", "processed": dict.fromkeys(AXES, 0.0), "buttons": 0, "raw": []}
_bridge_prev = 0                      # bitmask tombol pada paket Bridge sebelumnya (untuk mendeteksi tombol yang BARU ditekan)
_bridge_rx = 0                        # jumlah paket yang diterima dari bridge
_rx_times = collections.deque(maxlen=40)          # waktu paket terakhir (hitung laju Hz)
_btn_seen = {}                        # nomor tombol -> waktu terakhir terlihat ditekan
_btn_events = collections.deque(maxlen=8)         # (waktu, nomor) tombol yang BARU ditekan
_dev_btn = {n: list(_DEV_BTN_DEFAULT.get(n, (0, 0))) for n in range(BTN_COUNT)}   # tabel fungsi simulasi (DEV mode)
_dev_gain = JS_GAIN_DEFAULT
_prev_btn = 0                         # bitmask tombol pada tick sebelumnya (emulator DEV mode)


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


# ==================== PENGATURAN JOYSTICK ====================
def _sanitize_cfg(raw):
  """Validasi dan bersihkan konfigurasi joystick dari browser / file sebelum dipakai."""
  src = raw if isinstance(raw, dict) else {}
  out = copy.deepcopy(JOY_DEFAULT)

  def clampf(v, lo, hi, default):
    try:
      v = float(v)
    except (TypeError, ValueError):
      return default
    return min(hi, max(lo, v)) if math.isfinite(v) else default

  out["deadzone"] = clampf(src.get("deadzone"), 0.0, 0.5, out["deadzone"])
  out["expo"] = clampf(src.get("expo"), 0.0, 1.0, out["expo"])
  out["gain"] = clampf(src.get("gain"), 0.1, 1.0, out["gain"])
  axes = src.get("axes") if isinstance(src.get("axes"), dict) else {}
  for k in AXES:
    m = axes.get(k) if isinstance(axes.get(k), dict) else {}
    a = m.get("axis")
    if isinstance(a, int) and not isinstance(a, bool) and -1 <= a < 32:
      out["axes"][k]["axis"] = a
    inv = m.get("invert")
    if isinstance(inv, bool):
      out["axes"][k]["invert"] = inv
  return out


def _load_cfg():
  try:
    return _sanitize_cfg(json.loads(CONFIG_FILE.read_text(encoding="utf-8")))
  except Exception:   # noqa: BLE001
    return copy.deepcopy(JOY_DEFAULT) if not CONFIG_FILE.exists() else _sanitize_cfg(None)


_cfg = _load_cfg()


def _curve(v, cfg):
  """Sama persis dengan applyCurve() di joystick.js."""
  a = abs(v)
  if a <= cfg["deadzone"]:
    return 0.0
  n = (a - cfg["deadzone"]) / (1.0 - cfg["deadzone"])
  shaped = (1.0 - cfg["expo"]) * n + cfg["expo"] * n ** 3
  return math.copysign(min(1.0, shaped * cfg["gain"]), v)


def _process(raw, cfg):
  """Sumbu mentah (urutan SDL) -> {surge, sway, heave, yaw} setelah mapping, invert, deadband, expo, gain."""
  out = {}
  for k in AXES:
    m = cfg["axes"][k]
    i = m["axis"]
    v = raw[i] if 0 <= i < len(raw) else 0.0
    out[k] = _curve(-v if m["invert"] else v, cfg)
  return out


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
  """Bitmask tombol -> int 0..0xFFFF. Nilai aneh dianggap 'tidak ada tombol'."""
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
    raise ControlError("pymavlink is not installed on the backend", 503)
  master = _ctx.get_master()
  if master is None:
    raise ControlError("Pixhawk is not connected", 409)
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
        raise ControlError("No response from Pixhawk", 502)
      _ctx.cond.wait(remaining)
  try:
    text = _ctx.mavutil.mavlink.enums["MAV_RESULT"][ack["result"]].name
  except Exception:   # noqa: BLE001
    text = str(ack["result"])
  if ack["result"] != 0:
    time.sleep(0.4)   # STATUSTEXT yang menjelaskan penolakan biasanya tiba sesaat setelah ACK
  return ack["result"], text, _ctx.statustext_since(t_sent)


# ==================== ON / OFF ====================
def deactivate(reason=""):
  """Matikan control. Beberapa frame netral (semua tombol dilepas) tetap dikirim agar vehicle pasti berhenti."""
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


# ==================== EMULATOR TOMBOL (hanya mode DEV) ====================
def _dev_run(n, fid, shifted):
  """Jalankan SATU fungsi tombol seperti firmware ArduSub (hanya fungsi yang dapat ditiru tanpa vehicle)."""
  global _dev_gain
  st = _ctx.state
  name = BTN_NAME.get(fid, f"#{fid}")
  tag = f"[DEV-BTN] tombol {n}{' (shift)' if shifted else ''} -> {name}"
  if fid in (0, 1):                      # disabled / shift: tidak ada aksi
    return
  if fid == 3:
    st["armed"] = True
  elif fid == 4:
    st["armed"] = False
  elif fid == 2:
    st["armed"] = not st.get("armed")
  elif fid in (5, 6, 7):
    st["custom_mode"] = {5: 19, 6: 0, 7: 2}[fid]
  elif fid in (41, 42, 43):
    step = (JS_GAIN_MAX - JS_GAIN_MIN) / JS_GAIN_STEPS
    if fid == 42:
      _dev_gain = min(JS_GAIN_MAX, _dev_gain + step)
    elif fid == 43:
      _dev_gain = max(JS_GAIN_MIN, _dev_gain - step)
    else:                                # gain_toggle: antara 50% dan 100%
      _dev_gain = JS_GAIN_MAX if _dev_gain < JS_GAIN_MAX else JS_GAIN_DEFAULT
    _log(f"{tag}: pilot gain {int(round(_dev_gain * 100))}%")
    return
  else:
    _log(f"{tag} (fungsi ini hanya dijalankan robot sungguhan)")
    return
  _log(f"{tag}: armed={'YA' if st.get('armed') else 'tidak'}, mode={mode_name(st.get('custom_mode'))}")


def _dev_buttons(mask):
  """DEV mode: jalankan fungsi tombol yang BARU ditekan (jika tombol shift ditahan, pakai fungsi shift-nya)."""
  global _prev_btn
  fresh = mask & ~_prev_btn
  _prev_btn = mask
  if not fresh:
    return
  shift = any((mask >> n) & 1 and _dev_btn[n][0] == 1 for n in range(BTN_COUNT))
  for n in range(BTN_COUNT):
    if (fresh >> n) & 1:
      _dev_run(n, _dev_btn[n][1] if shift else _dev_btn[n][0], shift)


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

  # Data joystick hilang cukup lama: matikan control (frame netral dikirim lewat NEUTRAL_BURST pada tick berikutnya)
  if active and age > STALE_OFF_S:
    deactivate("No joystick data for over 2 s (Bridge stopped or tab hidden)")
    return

  master = None
  if not _ctx.dev_mode:
    master = _ctx.get_master()
    if master is None:
      if active:
        deactivate("Pixhawk disconnected")
      return

  # WATCHDOG: data joystick terlambat -> kirim netral dan lepas semua tombol
  stale = active and age > WATCHDOG_S
  if not active or stale:
    axes = dict.fromkeys(AXES, 0.0)
    buttons = 0

  if _ctx.dev_mode:
    _dev_buttons(buttons)    # DEV mode (tanpa vehicle): tiru fungsi tombol firmware
  x, y, z, r = _packet(axes)
  if master is not None:
    try:
      with _ctx.send_lock:
        master.mav.manual_control_send(master.target_system, x, y, z, r, buttons)
    except Exception as e:   # noqa: BLE001
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
    except Exception as e:   # noqa: BLE001
      _log(f"Error di pengirim: {e}")
    sleep_left = period - (time.time() - t0)
    if sleep_left > 0:
      time.sleep(sleep_left)


def _heartbeat_loop():
  """HEARTBEAT GCS 1 Hz. Tanpa ini, GCS failsafe ArduSub (FS_GCS_ENABLE) dapat aktif saat QGC tidak berjalan."""
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
    except Exception as e:   # noqa: BLE001
      _log(f"Gagal kirim heartbeat: {e}")


# ==================== ROUTE ====================
def _guard():
  if TOKEN and request.headers.get("X-ROV-Token", "") != TOKEN:
    return _err("Invalid or missing control token", 401)
  if not _ctx.enabled:
    return _err("Control is disabled on the backend. Start it with ROV_ENABLE_CONTROL=1.", 403)
  return None


def _bridge_view(now):
  """Ringkasan data Bridge untuk UI: axis mentah/olahan, tombol (termasuk yang baru dilepas), laju paket, dan event terakhir."""
  with _lock:
    b = dict(_bridge)
    seen = dict(_btn_seen)
    events = list(_btn_events)
    rx = _bridge_rx
    times = list(_rx_times)
  fresh = b["connected"] and (now - b["t"]) < BRIDGE_FRESH_S
  rate = 0.0
  if len(times) >= 2 and now - times[-1] < 1.5 and times[-1] > times[0]:
    rate = (len(times) - 1) / (times[-1] - times[0])
  recent = 0
  for n, t in seen.items():
    if now - t < BTN_LATCH_S:
      recent |= 1 << n
  return {
    "connected": bool(fresh),
    "age_ms": int((now - b["t"]) * 1000) if b["t"] else None,
    "name": b["name"] if fresh else "",
    "raw": b["raw"] if fresh else [],
    "axes": b["processed"] if fresh else dict.fromkeys(AXES, 0.0),
    "buttons": b["buttons"] if fresh else 0,
    "recent": recent if fresh else 0,
    "events": [{"n": n, "age_ms": int((now - t) * 1000)} for (t, n) in reversed(events[-5:])] if fresh else [],
    "rate_hz": round(rate, 1),
    "rx": rx,
  }


def control_bridge():
  """Endpoint ringan yang hanya berisi data Bridge. Di-poll sering oleh Settings untuk menampilkan input dari Bridge."""
  return jsonify({"ok": True, "bridge": _bridge_view(time.time())})


def _status_dict():
  st = _ctx.state
  now = time.time()
  with _lock:
    age_ms = int((now - _axes_t) * 1000) if _axes_t else None
    b = dict(_bridge)
    data = {
      "active": _active,
      "source": _source if _active else "",
      "reason": _reason,
      "stale": _stale and _active,
      "age_ms": age_ms,
      "last": dict(_last),
      "sent": _sent,
    }
  bridge_fresh = b["connected"] and (now - b["t"]) < BRIDGE_FRESH_S
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
    "dev_gain": round(_dev_gain, 2) if _ctx.dev_mode else None,
    "bridge": _bridge_view(now),
  })
  return data


def control_status():
  return jsonify(_status_dict())


def control_config_get():
  return jsonify({"ok": True, "config": _cfg})


def control_config_set():
  """Menerima pengaturan joystick dari dashboard (Settings > Joystick) dan menyimpannya ke joystick_config.json."""
  global _cfg
  g = _guard()
  if g:
    return g
  body = request.get_json(force=True, silent=True)
  if not isinstance(body, dict) or not isinstance(body.get("axes"), dict):
    return _err("Invalid joystick configuration", 400)
  new = _sanitize_cfg(body)
  _cfg = new
  try:
    CONFIG_FILE.write_text(json.dumps(new, indent=2), encoding="utf-8")
  except OSError as e:
    _log(f"Gagal menyimpan {CONFIG_FILE.name}: {e}")
  _log(
    "Pengaturan joystick diperbarui: "
    + ", ".join(f"{k}=axis{new['axes'][k]['axis']}{'(inv)' if new['axes'][k]['invert'] else ''}" for k in AXES)
    + f", deadband {new['deadzone']:.2f}, expo {new['expo']:.2f}, gain {new['gain']:.2f}"
  )
  return jsonify({"ok": True, "config": new})


def control_enable():
  global _active, _reason, _axes_t, _buttons, _source
  g = _guard()
  if g:
    return g
  body = request.get_json(force=True, silent=True) or {}

  if not body.get("enabled"):
    deactivate("disabled by operator")
    return jsonify(_status_dict())

  if not _connected():
    return _err("Pixhawk is not connected", 409)

  source = body.get("source") or "browser"
  if source not in ("bridge", "browser"):
    return _err("source must be 'bridge' or 'browser'", 400)

  if source == "bridge":
    with _lock:
      b = dict(_bridge)
    if not (b["connected"] and (time.time() - b["t"]) < BRIDGE_FRESH_S):
      return _err("Joystick Bridge is not connected. Start tools/joystick_bridge.py on the operator laptop.", 409)
    axes = dict(b["processed"])
    buttons = b["buttons"]
  else:
    axes = _clean_axes(body.get("axes"))
    buttons = _clean_buttons(body.get("buttons"))

  if any(abs(v) > START_NEUTRAL_TOL for v in axes.values()):
    return _err("Sticks are not centered. Release all sticks and try again.", 409)
  if buttons != 0:
    return _err("A joystick button is still pressed. Release it and try again.", 409)

  with _lock:
    _active = True
    _source = source
    _reason = ""
    _axes.update(dict.fromkeys(AXES, 0.0))
    _buttons = 0
    _axes_t = time.time()   # watchdog mulai menghitung dari sini
  _log(f"Control ON via {source} (limit {int(LIMIT * 100)}%, watchdog {int(WATCHDOG_S * 1000)} ms)")
  return jsonify(_status_dict())


def control_axes():
  """Source BROWSER, ~20 Hz: nilai sudah diolah di browser. Endpoint ini hanya menyimpan; pengiriman dilakukan sender thread."""
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
    if _source != "browser":
      return jsonify({"ok": True, "active": True, "ignored": True})   # sumber lain yang menyetir
    _axes.update(axes)
    _buttons = buttons
    _axes_t = time.time()
  return jsonify({"ok": True, "active": True})


def control_raw():
  """Source BRIDGE, ~20 Hz: axis MENTAH (urutan SDL) + bitmask tombol (nomor QGC). Pengolahan dilakukan di backend."""
  global _axes_t, _buttons
  g = _guard()
  if g:
    return g
  body = request.get_json(force=True, silent=True)
  body = body if isinstance(body, dict) else {}
  connected = bool(body.get("connected"))
  raw = body.get("axes")
  raw = [max(-1.0, min(1.0, _num(v))) for v in raw[:8]] if isinstance(raw, list) else []
  buttons = _clean_buttons(body.get("buttons")) if connected else 0
  now = time.time()
  cfg = _cfg
  processed = _process(raw, cfg) if connected else dict.fromkeys(AXES, 0.0)

  global _bridge_prev, _bridge_rx
  lost = False
  with _lock:
    _bridge.update(t=now, connected=connected, name=str(body.get("name") or "")[:60],
                   processed=processed, buttons=buttons, raw=[round(v, 3) for v in raw])
    _bridge_rx += 1
    _rx_times.append(now)
    if connected:
      for n in range(16):
        if (buttons >> n) & 1:
          _btn_seen[n] = now
          if not (_bridge_prev >> n) & 1:
            _btn_events.append((now, n))
      _bridge_prev = buttons
    else:
      _bridge_prev = 0
    driving = _active and _source == "bridge"
    if driving:
      if connected:
        _axes.update(processed)
        _buttons = buttons
        _axes_t = now
      else:
        lost = True
    active, source = _active, _source
  if lost:
    deactivate("Joystick disconnected / Bridge stopped")
    active = False
  return jsonify({"ok": True, "active": active, "source": source if active else ""})


def control_stop():
  """STOP selalu diizinkan (tanpa token / tanpa Enable), karena menghentikan vehicle tidak pernah berbahaya."""
  deactivate("STOP by operator")
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
        raise ControlError("pymavlink is not installed on the backend", 503)
      result, text, px = _command_long(mav.MAV_CMD_COMPONENT_ARM_DISARM, 1 if want else 0)
      if result != 0:
        _log(f"{label} ditolak: {text} | {px}")
        return _err(f"Pixhawk rejected {label} ({text})", 409, pixhawk_text=px)
    # status armed diterima lewat HEARTBEAT (1 Hz): tunggu sampai berubah
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
    return _err(f"Mode must be one of: {', '.join(UI_MODES)}", 400)
  try:
    if _ctx.dev_mode:
      time.sleep(0.2)
      _ctx.state["custom_mode"] = cid
    else:
      mav = _ctx.mavutil.mavlink if _ctx.mavutil else None
      if mav is None:
        raise ControlError("pymavlink is not installed on the backend", 503)
      # p1 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED (1), p2 = nomor mode ArduSub
      result, text, px = _command_long(mav.MAV_CMD_DO_SET_MODE, 1, cid)
      if result != 0:
        _log(f"Ganti mode ditolak: {text} | {px}")
        return _err(f"Pixhawk rejected the mode change ({text})", 409, pixhawk_text=px)
    verified = _wait_for(lambda: _ctx.state.get("custom_mode") == cid, 3.0)
  except ControlError as e:
    return _err(str(e), e.code, **e.extra)
  _log(f"Mode -> {mode_name(cid)}: {'terbukti' if verified else 'BELUM terbukti'} dari heartbeat")
  return jsonify({"ok": True, "mode": mode_name(_ctx.state.get("custom_mode")), "verified": verified})


# ==================== FUNGSI TOMBOL (Button Assignment) ====================
def buttons_get():
  """Baca fungsi tiap tombol (BTNn_FUNCTION dan BTNn_SFUNCTION) dari Pixhawk; DEV mode memakai tabel simulasi."""
  rows = []
  if _ctx.dev_mode:
    rows = [{"n": n, "f": _dev_btn[n][0], "s": _dev_btn[n][1]} for n in range(BTN_COUNT)]
  elif _ctx.param_read is None:
    return _err("Parameter reader is not available on the backend", 503)
  else:
    with _ctx.cmd_lock:
      for n in range(BTN_COUNT):
        row = {"n": n, "f": None, "s": None}
        try:
          row["f"] = int(round(_ctx.param_read(f"BTN{n}_FUNCTION")["value"]))
          row["s"] = int(round(_ctx.param_read(f"BTN{n}_SFUNCTION")["value"]))
        except _ctx.param_error as e:
          row["error"] = str(e)
        rows.append(row)
        if "error" in row and not _connected():
          break          # Pixhawk tidak terhubung: hentikan lebih awal, jangan menunggu timeout 30 kali
  return jsonify({
    "ok": True,
    "dev": bool(_ctx.dev_mode),
    "buttons": rows,
    "functions": [{"id": i, "name": nm} for i, nm in BTN_FUNCTIONS],
  })


def buttons_set(n):
  """Ubah fungsi SATU tombol (atau fungsi shift-nya), lalu baca ulang dari Pixhawk untuk verifikasi."""
  g = _guard()
  if g:
    return g
  if not 0 <= n < BTN_COUNT:
    return _err(f"Unknown button {n}", 404)
  body = request.get_json(force=True, silent=True)
  body = body if isinstance(body, dict) else {}
  fid = body.get("function")
  shifted = bool(body.get("shifted"))
  if not isinstance(fid, int) or isinstance(fid, bool) or not 0 <= fid <= 255:
    return _err("function must be an integer between 0 and 255", 400)
  if _active:
    return _err("Turn Drive Control OFF before changing button functions.", 409)
  if _ctx.state.get("armed"):
    return _err("Vehicle is ARMED. Disarm before changing button functions.", 409)

  name = f"BTN{n}_{'S' if shifted else ''}FUNCTION"
  idx = 1 if shifted else 0
  try:
    if _ctx.dev_mode:
      old, new = _dev_btn[n][idx], fid
      _dev_btn[n][idx] = fid
    else:
      if _ctx.param_write is None:
        return _err("Parameter writer is not available on the backend", 503)
      with _ctx.cmd_lock:
        old, new = _ctx.param_write(name, fid)
  except _ctx.param_error as e:
    return _err(str(e), 502)
  verified = int(round(new)) == fid
  _log(f"{name}: {BTN_NAME.get(int(round(old)), int(round(old)))} -> {BTN_NAME.get(int(round(new)), int(round(new)))} "
       f"({'TERBUKTI' if verified else 'GAGAL'})")
  return jsonify({"ok": True, "n": n, "shifted": shifted, "param": name,
                  "old": int(round(old)), "new": int(round(new)), "verified": verified})


# ==================== INIT / START ====================
def init(app, *, get_master, send_lock, cmd_lock, cond, last_ack, state,
         statustext_since, enabled, dev_mode, mavutil, sysid,
         param_read=None, param_write=None, param_error=Exception):
  """
  Dipanggil sekali dari gcs_server.py setelah semua yang dibutuhkan terdefinisi.
    get_master       : fungsi tanpa argumen -> objek koneksi pymavlink (atau None)
    send_lock        : lock untuk SEMUA pengiriman ke Pixhawk (dibagi dengan gcs_server)
    cond / last_ack  : Condition + dict ACK terakhir yang diisi handler COMMAND_ACK gcs_server
    state            : dict state global (armed, custom_mode, mavlink_connected)
    statustext_since : fungsi(waktu) -> teks STATUSTEXT sejak waktu itu
    param_read/write : mav_param_read / mav_param_write milik gcs_server (untuk Button Assignment)
    param_error      : kelas exception yang dilempar keduanya (MavCommandError)
  """
  global _ctx
  _ctx = SimpleNamespace(
    get_master=get_master, send_lock=send_lock, cmd_lock=cmd_lock, cond=cond,
    last_ack=last_ack, state=state, statustext_since=statustext_since,
    enabled=enabled, dev_mode=dev_mode, mavutil=mavutil, sysid=sysid,
    param_read=param_read, param_write=param_write, param_error=param_error,
  )
  if dev_mode:
    state.setdefault("custom_mode", 19)

  app.add_url_rule("/control/status", "control_status", control_status)
  app.add_url_rule("/control/bridge", "control_bridge", control_bridge)
  app.add_url_rule("/control/config", "control_config_get", control_config_get)
  app.add_url_rule("/control/config", "control_config_set", control_config_set, methods=["POST"])
  app.add_url_rule("/control/enable", "control_enable", control_enable, methods=["POST"])
  app.add_url_rule("/control/axes", "control_axes", control_axes, methods=["POST"])
  app.add_url_rule("/control/raw", "control_raw", control_raw, methods=["POST"])
  app.add_url_rule("/control/stop", "control_stop", control_stop, methods=["POST"])
  app.add_url_rule("/control/arm", "control_arm", control_arm, methods=["POST"])
  app.add_url_rule("/control/mode", "control_mode", control_mode, methods=["POST"])
  app.add_url_rule("/buttons/functions", "buttons_get", buttons_get)
  app.add_url_rule("/buttons/<int:n>/function", "buttons_set", buttons_set, methods=["POST"])


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