"""
./tools/joystick_bridge.py
joystick_bridge.py - Joystick Bridge: membaca joystick di laptop operator dan meneruskannya ke backend GCS.

LATAR BELAKANG
  Gamepad API milik browser hanya memberikan data ke tab yang sedang tampil dan fokus. 
  Bridge membaca joystick langsung dari sistem operasi, sehingga tetap berfungsi saat tab dipindah atau jendela lain sedang aktif (perilaku yang sama dengan QGroundControl). 
  Dashboard tetap dipakai untuk Enable Control, ARM, mode, dan monitoring.

ALUR DATA
  Joystick --> joystick_bridge.py --HTTP POST /control/raw (20 Hz)--> backend (rov_control.py) --MANUAL_CONTROL--> Pixhawk
  Backend menerapkan pengaturan dari Settings > Joystick (mapping, deadband, exponential, gain).
  Bridge hanya mengirim nilai MENTAH dan TIDAK menggerakkan vehicle sendiri: vehicle baru bergerak setelah operator menekan Enable Control di dashboard.

INPUT BACKEND (--input auto | xinput | sdl)
  xinput : Windows, tanpa dependensi tambahan. Mendukung controller XInput (Xbox, Logitech F310 mode X, dll.). Hot-plug dan operasi di latar belakang didukung penuh.
  sdl    : melalui pygame-ce (pip install pygame-ce), untuk controller non-XInput.
  auto   : mencoba xinput lebih dulu, lalu sdl.

NUMBERING (mengikuti QGroundControl / SDL GameController)
  Buttons : 0 A, 1 B, 2 X, 3 Y, 4 Back, 5 Guide, 6 Start, 7 L3, 8 R3, 9 LB, 10 RB, 11 D-pad Up, 12 Down, 13 Left, 14 Right
  Axes    : 0 Left X, 1 Left Y (atas = negatif), 2 Right X, 3 Right Y, 4 LT (0..1), 5 RT (0..1)
  LT dan RT adalah axis, bukan tombol.

SAFETY
  - Bridge berhenti atau joystick dicabut -> backend menetralkan output (watchdog) lalu mematikan control.
  - Ctrl+C menghentikan Bridge seketika dan memberi tahu backend.

PENGGUNAAN
  py tools\\joystick_bridge.py --backend http://127.0.0.1:8080       # DEV mode (backend di laptop)
  py tools\\joystick_bridge.py --backend http://192.168.1.10:8080    # vehicle (backend di Jetson)
  --list      tampilkan joystick yang terdeteksi lalu keluar (diagnosa)
  --verbose   cetak nilai axis tiap detik
  --token     token kontrol, jika backend memakai ROV_CONTROL_TOKEN
"""

import argparse
import ctypes
import json
import os
import signal
import sys
import time
import urllib.error
import urllib.request

# Hanya berpengaruh pada jalur SDL (pygame): menerima data joystick walau tidak ada jendela fokus, tanpa membuka jendela.
os.environ.setdefault("SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS", "1")
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")

BTN_NAMES = ["A", "B", "X", "Y", "Back", "Guide", "Start", "L3", "R3", "LB", "RB", "Up", "Down", "Left", "Right"]


def clamp(v, lo=-1.0, hi=1.0):
  return max(lo, min(hi, v))


# ==================== Pembaca 1: XInput (Windows) ====================
class XInputReader:
  """Membaca controller XInput melalui xinput1_4.dll. Tanpa pygame, tidak butuh fokus jendela, hot-plug otomatis."""

  src = "XInput"

  # (bit tombol XInput, nomor tombol SDL / QGC)
  MAP = [
    (0x1000, 0), (0x2000, 1), (0x4000, 2), (0x8000, 3),      # A B X Y
    (0x0020, 4), (0x0400, 5), (0x0010, 6),                   # Back, Guide, Start
    (0x0040, 7), (0x0080, 8), (0x0100, 9), (0x0200, 10),     # L3 R3 LB RB
    (0x0001, 11), (0x0002, 12), (0x0004, 13), (0x0008, 14),  # D-pad atas bawah kiri kanan
  ]

  def __init__(self):
    self.fns = []
    self.slot = None
    self.last_scan = 0.0
    if sys.platform != "win32":
      return
    from ctypes import wintypes

    class Gamepad(ctypes.Structure):
      _fields_ = [("wButtons", wintypes.WORD), ("bLeftTrigger", ctypes.c_ubyte), ("bRightTrigger", ctypes.c_ubyte),
                  ("sThumbLX", ctypes.c_short), ("sThumbLY", ctypes.c_short),
                  ("sThumbRX", ctypes.c_short), ("sThumbRY", ctypes.c_short)]

    class State(ctypes.Structure):
      _fields_ = [("dwPacketNumber", wintypes.DWORD), ("Gamepad", Gamepad)]

    self.State = State
    for dll_name in ("xinput1_4", "xinput1_3", "xinput9_1_0"):
      try:
        dll = ctypes.WinDLL(dll_name)
      except OSError:
        continue
      fns = []
      try:
        fns.append(dll[100])               # XInputGetStateEx (ordinal 100): menyertakan tombol Guide
      except Exception:   # noqa: BLE001
        pass
      try:
        fns.append(dll.XInputGetState)
      except Exception:   # noqa: BLE001
        pass
      for f in fns:
        f.argtypes = [wintypes.DWORD, ctypes.POINTER(State)]
        f.restype = wintypes.DWORD
      self.fns = fns
      break

  def _get(self, slot):
    st = self.State()
    for f in self.fns:
      rc = f(slot, ctypes.byref(st))
      if rc == 0:
        return st
      if rc == 1167:        # ERROR_DEVICE_NOT_CONNECTED
        return None
    return None

  def poll(self):
    if not self.fns:
      return None
    st = None
    if self.slot is not None:
      st = self._get(self.slot)
      if st is None:
        self.slot = None
    if self.slot is None:
      now = time.time()
      if now - self.last_scan < 1.0:        # memindai slot kosong relatif lambat: cukup 1x per detik
        return None
      self.last_scan = now
      for s in range(4):
        st = self._get(s)
        if st is not None:
          self.slot = s
          break
      if self.slot is None:
        return None
    g = st.Gamepad
    axes = [clamp(g.sThumbLX / 32768.0), clamp(-g.sThumbLY / 32768.0),    # Y dibalik: atas = negatif (seperti SDL)
            clamp(g.sThumbRX / 32768.0), clamp(-g.sThumbRY / 32768.0),
            g.bLeftTrigger / 255.0, g.bRightTrigger / 255.0]
    mask = 0
    for bit, n in self.MAP:
      if g.wButtons & bit:
        mask |= 1 << n
    return {"name": f"XInput controller {self.slot + 1}", "axes": axes, "mask": mask, "src": self.src}

  def describe(self):
    if not self.fns:
      return "XInput: tidak tersedia (bukan Windows?)"
    found = [s for s in range(4) if self._get(s) is not None]
    return f"XInput: slot terhubung = {found if found else 'tidak ada'}"


# ==================== Pembaca 2: SDL lewat pygame ====================
class SdlReader:
  """Fallback untuk controller non-XInput. pygame baru dimuat saat pertama kali dibutuhkan."""

  src = "SDL"

  def __init__(self, index=0):
    self.index = index
    self.ok = None            # None = belum dicoba
    self.ctrl = None
    self.last_rescan = 0.0
    self.pg = None
    self.controller = None

  def _init(self):
    try:
      import pygame
      from pygame._sdl2 import controller
    except Exception as e:   # noqa: BLE001
      print(f"[bridge] SDL/pygame tidak tersedia ({e}). Jalur SDL dilewati. (py -m pip install pygame-ce)")
      self.ok = False
      return
    self.pg, self.controller = pygame, controller
    pygame.display.init()
    pygame.joystick.init()
    controller.init()
    self.ok = True

  def _rescan(self):
    """Paksa SDL memindai ulang perangkat, karena hot-plug tidak selalu terdeteksi otomatis."""
    try:
      self.controller.quit()
      self.pg.joystick.quit()
      self.pg.joystick.init()
      self.controller.init()
    except Exception:   # noqa: BLE001
      pass

  def poll(self):
    if self.ok is None:
      self._init()
    if not self.ok:
      return None
    self.pg.event.pump()
    self.pg.event.clear()
    if self.ctrl is not None:
      try:
        if not self.ctrl.attached():
          self.ctrl.quit()
          self.ctrl = None
      except Exception:   # noqa: BLE001
        self.ctrl = None
    if self.ctrl is None:
      now = time.time()
      if now - self.last_rescan >= 1.0:
        self.last_rescan = now
        self._rescan()
        try:
          if self.controller.get_count() > self.index and self.controller.is_controller(self.index):
            self.ctrl = self.controller.Controller(self.index)
            try:
              self.label = self.controller.name_forindex(self.index) or self.ctrl.as_joystick().get_name()
            except Exception:   # noqa: BLE001
              self.label = ""
            self.label = self.label or "SDL controller"
        except Exception:   # noqa: BLE001
          self.ctrl = None
    if self.ctrl is None:
      return None
    c = self.ctrl
    axes = [clamp(c.get_axis(i) / 32768.0) for i in range(4)]
    axes += [clamp(c.get_axis(i) / 32767.0, 0.0, 1.0) for i in (4, 5)]
    mask = 0
    for b in range(15):
      if c.get_button(b):
        mask |= 1 << b
    return {"name": self.label, "axes": axes, "mask": mask, "src": self.src}

  def describe(self):
    if self.ok is None:
      self._init()
    if not self.ok:
      return "SDL: tidak tersedia"
    self.pg.event.pump()
    return f"SDL: {self.controller.get_count()} perangkat, joystick pygame: {self.pg.joystick.get_count()}"


def build_readers(args):
  readers = []
  if args.input in ("auto", "xinput"):
    readers.append(XInputReader())
  if args.input in ("auto", "sdl"):
    readers.append(SdlReader(args.index))
  return readers


# ==================== HTTP ====================
def post(url, body, token, timeout):
  req = urllib.request.Request(
    url,
    data=json.dumps(body).encode("utf-8"),
    method="POST",
    headers={"Content-Type": "text/plain"},   # text/plain: tidak perlu preflight CORS
  )
  if token:
    req.add_header("X-ROV-Token", token)
  with urllib.request.urlopen(req, timeout=timeout) as r:
    return json.loads(r.read().decode("utf-8") or "{}")


def main(argv=None):
  ap = argparse.ArgumentParser(description="Bridge joystick -> GCS ROV")
  ap.add_argument("--backend", default=os.environ.get("ROV_BACKEND", "http://192.168.1.10:8080"))
  ap.add_argument("--token", default=os.environ.get("ROV_CONTROL_TOKEN", ""))
  ap.add_argument("--input", choices=["auto", "xinput", "sdl"], default="auto", help="cara baca joystick (bawaan auto)")
  ap.add_argument("--index", type=int, default=0, help="nomor joystick untuk jalur SDL (mulai 0)")
  ap.add_argument("--hz", type=float, default=20.0, help="laju kirim (bawaan 20 Hz)")
  ap.add_argument("--list", action="store_true", help="tampilkan joystick yang terdeteksi lalu keluar")
  ap.add_argument("--verbose", action="store_true", help="cetak nilai sumbu tiap detik")
  args = ap.parse_args(argv)

  readers = build_readers(args)

  if args.list:
    for r in readers:
      print("[bridge]", r.describe())
    return

  url = args.backend.rstrip("/") + "/control/raw"
  period = 1.0 / max(5.0, min(50.0, args.hz))

  stop = {"now": False}

  def on_signal(_sig, _frm):
    stop["now"] = True

  signal.signal(signal.SIGINT, on_signal)
  try:
    signal.signal(signal.SIGTERM, on_signal)
  except (AttributeError, ValueError):
    pass

  print(f"[bridge] Backend: {url}")
  print(f"[bridge] Input: {args.input} ({' -> '.join(r.src for r in readers)}). Ctrl+C untuk berhenti. Menunggu joystick...")

  prev_mask = 0
  last_state = None
  last_verbose = 0.0
  backend_ok = None
  fails = 0
  err = ""
  active = None

  try:
    while not stop["now"]:
      t0 = time.time()

      pad = None
      for r in readers:
        pad = r.poll()
        if pad:
          break

      if pad:
        axes, mask = pad["axes"], pad["mask"]
        # Cetak tombol yang baru ditekan (membantu memverifikasi bahwa joystick terbaca di laptop)
        for b in range(15):
          if (mask >> b) & 1 and not (prev_mask >> b) & 1:
            print(f"[bridge] {time.strftime('%H:%M:%S')}  tombol {b} ({BTN_NAMES[b]}) ditekan")
        prev_mask = mask
        body = {"connected": True, "name": pad["name"], "axes": axes, "buttons": mask}
      else:
        axes, mask, prev_mask = [], 0, 0
        body = {"connected": False, "name": "", "axes": [], "buttons": 0}

      try:
        resp = post(url, body, args.token, timeout=0.5)
        fails = 0
        backend_ok = True
        active = bool(resp.get("active"))
        err = ""
      except urllib.error.HTTPError as e:
        fails += 1
        try:
          err = json.loads(e.read().decode("utf-8")).get("error", f"HTTP {e.code}")
        except Exception:   # noqa: BLE001
          err = f"HTTP {e.code}"
        backend_ok = False
      except Exception as e:   # noqa: BLE001
        fails += 1
        err = f"backend tidak terjangkau ({type(e).__name__})"
        if fails >= 3:          # 1-2 paket terlambat itu wajar; baru dilaporkan setelah 3 kali berturut-turut
          backend_ok = False

      state = (pad["name"] if pad else None, backend_ok, active if backend_ok else None, err if backend_ok is False else "")
      if state != last_state:
        last_state = state
        pad_txt = f"joystick '{pad['name']}' [{pad['src']}]" if pad else "joystick TIDAK ada"
        be_txt = "backend OK" if backend_ok else f"backend GAGAL: {err}"
        ctl_txt = "" if (active is None or not backend_ok) else (" | control ON" if active else " | control OFF")
        print(f"[bridge] {time.strftime('%H:%M:%S')}  {pad_txt}  |  {be_txt}{ctl_txt}")

      if args.verbose and pad and time.time() - last_verbose >= 1.0:
        last_verbose = time.time()
        print("[bridge] axes=" + " ".join(f"{v:+.2f}" for v in axes) + f"  buttons=0b{mask:015b}")

      sleep_left = period - (time.time() - t0)
      if sleep_left > 0:
        time.sleep(sleep_left)
  finally:
    # Beri tahu backend agar control langsung dimatikan (tanpa menunggu watchdog)
    try:
      post(url, {"connected": False, "name": "", "axes": [], "buttons": 0}, args.token, timeout=0.5)
    except Exception:   # noqa: BLE001
      pass
    print("[bridge] Berhenti.")


if __name__ == "__main__":
  main()