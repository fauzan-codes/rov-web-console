"""
./backend/gcs_server.py
gcs_server.py - Backend GCS ROV (Flask)

Dijalankan di Jetson (mode normal) ATAU di laptop (mode DEV, tanpa Jetson).
  Jetson : python gcs_server.py
  Laptop : python gcs_server.py --dev          (atau set ROV_DEV=1)

Opsi mode DEV (environment variable, semuanya opsional):
  ROV_DEV=1            sama dengan --dev
  ROV_DEV_WEBCAM=1     pakai webcam laptop (index = cam_id) kalau ada, kalau tidak ada otomatis jatuh ke kamera sintetis
  ROV_DEV_POS=ned      simulasi posisi dari "Pixhawk" (mode PIXHAWK di trajectory). Default "dr" (dead reckoning).
  ROV_PORT=8080        port HTTP

Daftar isi file ini:
  1. Import & deteksi mode
  2. Konfigurasi
  3. State global
  4. Utilitas kecil
  5. Kamera (grabber hardware Jetson & grabber DEV)
  6. MAVLink / telemetri (asli, fallback simulasi, simulasi DEV)
  7. Pemrosesan gambar (zoom, white balance, gamma)
  8. Deteksi QR
  9. Pipeline frame (processing_loop)
  10. RTSP server (hanya Jetson / GStreamer)
  11. Route HTTP Flask
  12. Main
"""

# ==================== 1. IMPORT & DETEKSI MODE ====================
import datetime
import math
import mimetypes
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

# Mode DEV = jalan di laptop tanpa Jetson (tanpa GStreamer/RTSP, kamera sintetis atau webcam laptop, telemetri simulasi).
DEV_MODE = ("--dev" in sys.argv) or (os.environ.get("ROV_DEV") == "1")
DEV_USE_WEBCAM = os.environ.get("ROV_DEV_WEBCAM") == "1"
DEV_POSITION_MODE = os.environ.get("ROV_DEV_POS", "dr").lower()  # "dr" | "ned"

# ===== GStreamer / gst-rtsp-server (hanya ada di Jetson) =====
# Kalau belum ada di Jetson:
#   sudo apt install python3-gi gir1.2-gst-rtsp-server-1.0 \ gstreamer1.0-plugins-{base,good,bad,ugly} gstreamer1.0-tools
Gst = GstRtspServer = GLib = None
RTSP_AVAILABLE = False
if not DEV_MODE:
  try:
    import gi

    gi.require_version("Gst", "1.0")
    gi.require_version("GstRtspServer", "1.0")
    from gi.repository import Gst, GstRtspServer, GLib

    Gst.init(None)
    RTSP_AVAILABLE = True
  except Exception as e:
    print(f"[WARN] GStreamer/RTSP tidak tersedia ({e}). RTSP dinonaktifkan.")

# Supaya file .glb (model 3D ROV) dikirim dengan Content-Type yang benar
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/gltf+json", ".gltf")

# pyzbar opsional
try:
  from pyzbar import pyzbar

  PYZBAR_AVAILABLE = True
except ImportError:
  PYZBAR_AVAILABLE = False
  print("[WARN] pyzbar tidak ditemukan. QR scan pakai cv2.QRCodeDetector saja.")

# cv2.QRCodeDetector selalu ada (bawaan OpenCV).
# Dipakai sebagai backend kedua/fallback kalau pyzbar tidak ada atau tidak menemukan apa-apa.
_cv2_qr_detector = cv2.QRCodeDetector()

# pymavlink opsional
try:
  from pymavlink import mavutil

  MAVLINK_AVAILABLE = True
except ImportError:
  MAVLINK_AVAILABLE = False
  print("[WARN] pymavlink tidak ditemukan. Mode dummy aktif.")

app = Flask(__name__)
CORS(app)


# ==================== 2. KONFIGURASI ====================
HTTP_PORT = int(os.environ.get("ROV_PORT", "8080"))

# ===== MAVLink =====
SERIAL_PORT = "udpin:0.0.0.0:14560"
BAUD_RATE = 115200

# ===== Pengaturan motor / thruster (tab Thruster di GCS) =====
# Jalurnya SAMA dengan telemetri: lewat mavlink-routerd (MAVProxy2.py) di endpoint UDP 14560,
# bukan langsung ke serial Pixhawk (serial hanya boleh dibuka satu proses: router).
MOTOR_COUNT        = 6
MOTOR_DIR_PARAM    = "MOT_{n}_DIRECTION"   # 1 = normal, -1 = terbalik. CEK nama ini di firmware ArduSub kalian.
# Fitur yang MENULIS ke robot (balik arah, uji motor) default MATI. Nyalakan sadar:
#   ROV_ENABLE_CONTROL=1 python3 gcs_server.py      (di mode DEV otomatis nyala karena hanya simulasi)
ENABLE_MOTOR_CONFIG    = DEV_MODE or os.environ.get("ROV_ENABLE_CONTROL") == "1"
MOTOR_TEST_MAX_PERCENT = 30     # batas atas daya uji motor, dipaksa di backend
MOTOR_TEST_MAX_SECONDS = 3      # batas atas durasi uji motor
MAV_REPLY_TIMEOUT      = 2.0    # detik menunggu balasan Pixhawk
# system id backend saat mengirim perintah. Sengaja BUKAN 255 supaya tidak bentrok dengan QGC
# selama QGC masih dipakai. (Kalau kelak mengirim heartbeat GCS / joystick, putuskan ulang:
# ArduSub memeriksa SYSID_MYGCS, bawaannya 255.)
MAV_SOURCE_SYSTEM      = 254

# ===== Model 3D ROV (.glb) =====
# Diserve lewat /models/<filename> untuk panel "ROV DESIGN".
ROOT = Path(__file__).resolve().parent
MODELS_DIR = ROOT / "models"

# ===== Kamera =====
# cam_id -> Linux video device
CAM_MAPPING = {
    0: "/dev/video0",  # Kamera depan (Logitech)
    1: "/dev/video1",  # Kamera bawah (Jete)
}

# Default/fallback global (dipakai kamera yang tidak ada di CAM_CONFIG dan untuk RTSP_IFRAME_INTERVAL).
CAM_W, CAM_H = 960, 540
CAM_FPS = 30

# Konfigurasi PER-KAMERA. Cek dulu mode yang BENAR-BENAR didukung kamera: v4l2-ctl --device=/dev/video1 --list-formats-ext
# "extra_controls": kontrol v4l2 opsional (mis. kunci exposure manual supaya kamera tidak "berburu" di kondisi gelap).
# Cek nama & rentang: v4l2-ctl --device=/dev/video1 -L
CAM_CONFIG = {
  0: {
    "width": 960,
    "height": 540,
    "fps": 30,
    "extra_controls": None,
  },
  1: {
    # 640x480@15 = contoh aman/rendah. Naikkan bertahap sambil pantau "measured_fps" di GET /status untuk tahu batas riil kameranya.
    "width": 640,
    "height": 480,
    "fps": 15,
    "extra_controls": {
      # 1 = manual exposure di kebanyakan driver UVC (BUKAN 0).
      # "exposure_auto": 1,
      # "exposure_absolute": 300,
    },
  },
}


def cam_cfg(camera_id):
  """Config kamera; fallback ke default global kalau belum terdaftar."""
  return CAM_CONFIG.get(
    camera_id,
    {
      "width": CAM_W,
      "height": CAM_H,
      "fps": CAM_FPS,
      "extra_controls": None,
    },
  )


# ===== Pemrosesan frame =====
QR_SCAN_EVERY_N_FRAMES  = 2       # scan tiap N frame (kecil = lebih responsif)
ENHANCE_EVERY_FRAME     = False   # white-balance/gamma (saat ini nonaktif)
QR_SCAN_DOWNSCALE       = 0.5     # QR didecode di resolusi diperkecil (1.0 = asli)
QR_BOX_TTL              = 1.5     # detik bounding box QR terakhir tetap digambar

# ===== RTSP / NVENC =====
RTSP_PORT             = "8554"
RTSP_BITRATE_KBPS     = 1000
RTSP_IFRAME_INTERVAL  = CAM_FPS   # 1 keyframe / detik -> latency join rendah
# nvv4l2h264enc control-rate: 0=variable_bitrate, 1=constant_bitrate
RTSP_CONTROL_RATE_CBR = 1
# nvv4l2h264enc preset-level: 0=DisablePreset, 1=UltraFast, 2=Fast,
# 3=Medium, 4=Slow. Pakai 1 untuk latency terendah.
RTSP_PRESET_ULTRAFAST = 1


# ==================== 3. STATE GLOBAL ====================
state = {
  "x": 0.0,
  "y": 0.0,
  "z": 0.0,
  "roll": 0.0,
  "pitch": 0.0,
  "yaw": 0.0,
  "depth": 0.0,
  "depth_pressure": 0.0,
  "dr_x": 0.0,
  "dr_y": 0.0,
  "pos_valid": False,
  "rollspeed": 0.0,
  "pitchspeed": 0.0,
  "yawspeed": 0.0,
  "mavlink_connected": False,
  "armed": False,
  # qr_data: deteksi TERBARU dari kamera manapun. "camera_id" menunjukkan sumbernya.
  "qr_data": {
    "target_id": "-",
    "type": "-",
    "valid": False,
    "time": "-",
    "camera_id": None,
  },
  # qr_data_by_camera: hasil per kamera, tidak saling menimpa.
  "qr_data_by_camera": {
    str(cam_id): {"target_id": "-", "type": "-", "valid": False, "time": "-"}
    for cam_id in CAM_MAPPING
  },
  "pwm": {
    "PWM1": 1500,
    "PWM2": 1500,
    "PWM3": 1500,
    "PWM4": 1500,
    "PWM5": 1500,
    "PWM6": 1500,
  },
}
state_lock = threading.Lock()

# Dead reckoning
_dr_lock = threading.Lock()
_dr_vx = 0.0
_dr_vy = 0.0
_dr_last_t = None

# Tekanan permukaan (hPa) untuk kalibrasi kedalaman
surface_pressure_hpa = None

# Kamera
cameras_active = False
zoom_levels = {cam_id: 1.0 for cam_id in CAM_MAPPING}  # zoom manual per kamera
zoom_lock = threading.Lock()
display_fps = {cam_id: 0.0 for cam_id in CAM_MAPPING}

_last_frames = {}  # frame terakhir yang SUDAH diproses (snapshot & MJPEG)
_last_frames_lock = threading.Lock()


# ==================== 4. UTILITAS KECIL ====================
def get_local_ip():
  """IP LAN mesin ini, dipakai membentuk URL rtsp:// untuk frontend."""
  try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    ip = s.getsockname()[0]
    s.close()
    return ip
  except Exception:
    return "127.0.0.1"


JETSON_IP = get_local_ip()


def rtsp_url_for(camera_id):
  return f"rtsp://{JETSON_IP}:{RTSP_PORT}/camera{camera_id}"


def wrap_deg(angle):
  return (angle + 180) % 360 - 180


# ==================== 5. KAMERA ====================
# ===== 5a. Grabber hardware (Jetson) =====
def build_hw_capture_pipeline(device, width, height, fps):
  """
  Pipeline GStreamer: kamera USB MJPEG -> decode JPEG di hardware Jetson (nvv4l2decoder) -> BGR, supaya terbaca cv2.VideoCapture(CAP_GSTREAMER) sebagai array numpy biasa.
  """
  return (
    f"v4l2src device={device} io-mode=2 ! "
    f"image/jpeg,width={width},height={height},framerate={fps}/1 ! "
    f"nvv4l2decoder mjpeg=1 ! "
    f"nvvidconv ! video/x-raw,format=BGRx ! "
    f"videoconvert ! video/x-raw,format=BGR ! "
    f"appsink name=sink emit-signals=false sync=false drop=true max-buffers=1"
  )


def apply_v4l2_controls(device, controls):
  """
  Set kontrol V4L2 (mis. kunci exposure) via v4l2-ctl SEBELUM device dibuka. 
  Mengunci exposure sering menghilangkan FPS patah-patah di webcam murah yang auto-exposure-nya "berburu" di kondisi gelap.
  """
  if not controls:
    return
  for name, value in controls.items():
    try:
      subprocess.run(
        ["v4l2-ctl", "--device", device, "-c", f"{name}={value}"],
        check=True,
        capture_output=True,
        timeout=3,
      )
      print(f"[CAM {device}] v4l2 control diset: {name}={value}")
    except Exception as e:
      print(f"[CAM {device}] Gagal set v4l2 control {name}={value}: {e}")


class CameraGrabber:
  """
  Thread pembaca kamera yang tahan gagal:
    1. Coba pipeline GStreamer hardware decode (nvv4l2decoder).
    2. Gagal -> fallback cv2.VideoCapture V4L2 (software JPEG decode).
    3. Device tidak ada -> grabber tetap "hidup" (frame None), tidak
       meng-crash thread/backend lain.
  Resolusi/fps diminta PER-KAMERA lewat CAM_CONFIG.
  """

  def __init__(self, device, camera_id=None):
    self.device = device
    self.camera_id = camera_id
    self.using_hw = False
    self.opened = False
    self.measured_fps = 0.0

    cfg = (
      cam_cfg(camera_id)
      if camera_id is not None
      else {
        "width": CAM_W,
        "height": CAM_H,
        "fps": CAM_FPS,
        "extra_controls": None,
      }
    )
    self.width, self.height, self.fps = cfg["width"], cfg["height"], cfg["fps"]

    # Kunci exposure/kontrol lain sebelum device dibuka
    apply_v4l2_controls(device, cfg.get("extra_controls"))

    self._open_capture()

    self.frame = None
    self.lock = threading.Lock()
    self.running = False
    self.thread = None

  def _open_capture(self):
    hw_pipeline = build_hw_capture_pipeline(
      self.device, self.width, self.height, self.fps
    )
    self.cap = cv2.VideoCapture(hw_pipeline, cv2.CAP_GSTREAMER)

    if self.cap.isOpened():
      self.using_hw = True
      self.opened = True
      print(
        f"[CAM {self.device}] Hardware MJPEG decode aktif "
        f"({self.width}x{self.height}@{self.fps}, nvv4l2decoder)."
      )
      return

    print(
      f"[CAM {self.device}] Pipeline hardware decode gagal dibuka di "
      f"{self.width}x{self.height}@{self.fps} -- kemungkinan kamera "
      f"tidak sanggup mode MJPEG ini. Fallback ke V4L2 + software "
      f"JPEG decode OpenCV. Cek mode asli dgn "
      f"`v4l2-ctl --device={self.device} --list-formats-ext`."
    )
    self.cap = cv2.VideoCapture(self.device, cv2.CAP_V4L2)
    self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
    self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
    self.cap.set(cv2.CAP_PROP_FPS, self.fps)
    self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    self.opened = self.cap.isOpened()
    if not self.opened:
      print(
        f"[CAM {self.device}] Kamera tidak bisa dibuka sama sekali. "
        f"Stream ini akan diam (frame None) sampai device tersedia."
      )

  def start(self):
    if self.running:
      return
    self.running = True
    self.thread = threading.Thread(target=self._update, daemon=True)
    self.thread.start()

  def _update(self):
    # Hitung FPS RIIL dari hardware tiap ~1 detik (untuk /status).
    window_start = time.time()
    window_count = 0

    while self.running:
      if not self.opened:
        time.sleep(0.5)
        continue
      ok, frame = self.cap.read()
      if not ok:
        time.sleep(0.01)
        continue
      with self.lock:
        self.frame = frame  # selalu menimpa -> tidak ada antrian

      window_count += 1
      now = time.time()
      elapsed = now - window_start
      if elapsed >= 1.0:
        self.measured_fps = window_count / elapsed
        window_count = 0
        window_start = now

  def read(self):
    with self.lock:
      return None if self.frame is None else self.frame.copy()

  def stop(self):
    self.running = False
    if self.thread is not None:
      self.thread.join(timeout=1)
    self.cap.release()


# ===== 5b. Grabber DEV (laptop, tanpa Jetson) =====
def _make_dev_qr_image(text="A", size=240):
  """
  QR sintetis (putih-hitam) untuk menguji pipeline QR. 
  None kalau versi OpenCV tidak punya QRCodeEncoder.
  """
  try:
    encoder = cv2.QRCodeEncoder.create()
    qr = encoder.encode(text)
    qr = cv2.resize(qr, (size, size), interpolation=cv2.INTER_NEAREST)
    qr = cv2.copyMakeBorder(qr, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
    return cv2.cvtColor(qr, cv2.COLOR_GRAY2BGR)
  except Exception as e:
    print(f"[DEV] QR sintetis tidak bisa dibuat ({e}). Lewati.")
    return None


class DevCameraGrabber:
  """
  Pengganti CameraGrabber untuk laptop. Antarmukanya sama
  (start/read/stop/opened/measured_fps), jadi sisa pipeline tidak tahu
  bedanya. Sumber gambar:
    - webcam laptop (ROV_DEV_WEBCAM=1), kalau gagal dibuka -> sintetis
    - kamera sintetis: latar bergradasi + bola bergerak + jam + (CAM 0) QR berisi "A" supaya deteksi QR bisa dites.
  """

  def __init__(self, device, camera_id=None):
    self.device = device
    self.camera_id = camera_id if camera_id is not None else 0
    cfg = cam_cfg(self.camera_id)
    self.width, self.height, self.fps = cfg["width"], cfg["height"], cfg["fps"]

    self.using_hw = False
    self.measured_fps = 0.0
    self.frame = None
    self.lock = threading.Lock()
    self.running = False
    self.thread = None

    self.cap = None
    if DEV_USE_WEBCAM:
      cap = cv2.VideoCapture(self.camera_id)
      if cap.isOpened():
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self.cap = cap
        print(
          f"[DEV CAM {self.camera_id}] Pakai webcam laptop index {self.camera_id}."
        )
      else:
        print(
          f"[DEV CAM {self.camera_id}] Webcam index {self.camera_id} tidak ada, "
          f"pakai kamera sintetis."
        )
    if self.cap is None:
      print(
        f"[DEV CAM {self.camera_id}] Kamera sintetis {self.width}x{self.height}@{self.fps}."
      )

    self.opened = True

    ramp = np.linspace(20, 90, self.width, dtype=np.uint8)
    bg = np.zeros((self.height, self.width, 3), dtype=np.uint8)
    bg[:, :, 0] = ramp[None, :]
    bg[:, :, 1] = 40 + (self.camera_id * 40)
    bg[:, :, 2] = 25
    self._bg = bg
    self._qr_img = _make_dev_qr_image("A") if self.camera_id == 0 else None

  def _synthetic_frame(self):
    frame = self._bg.copy()
    t = time.time()
    w, h = self.width, self.height

    cx = int(w / 2 + (w * 0.35) * math.sin(t * 0.8))
    cy = int(h / 2 + (h * 0.30) * math.sin(t * 1.3))
    cv2.circle(frame, (cx, cy), 28, (56, 189, 248), -1)

    if self._qr_img is not None:
      qh, qw = self._qr_img.shape[:2]
      if qh < h and qw < w:
        x0, y0 = (w - qw) // 2, (h - qh) // 2
        frame[y0: y0 + qh, x0: x0 + qw] = self._qr_img

    cv2.putText(
      frame,
      f"DEV CAM {self.camera_id}",
      (15, h - 45),
      cv2.FONT_HERSHEY_SIMPLEX,
      0.8,
      (255, 255, 255),
      2,
      cv2.LINE_AA,
    )
    cv2.putText(
      frame,
      datetime.datetime.now().strftime("%H:%M:%S.%f")[:-3],
      (15, h - 15),
      cv2.FONT_HERSHEY_SIMPLEX,
      0.6,
      (200, 255, 200),
      1,
      cv2.LINE_AA,
    )
    return frame

  def start(self):
    if self.running:
      return
    self.running = True
    self.thread = threading.Thread(target=self._update, daemon=True)
    self.thread.start()

  def _update(self):
    period = 1.0 / self.fps
    window_start = time.time()
    window_count = 0

    while self.running:
      t0 = time.time()
      if self.cap is not None:
        ok, frame = self.cap.read()
        if not ok:
          time.sleep(0.01)
          continue
        frame = cv2.resize(frame, (self.width, self.height))
      else:
        frame = self._synthetic_frame()

      with self.lock:
        self.frame = frame

      window_count += 1
      now = time.time()
      if now - window_start >= 1.0:
        self.measured_fps = window_count / (now - window_start)
        window_count = 0
        window_start = now

      sleep_left = period - (time.time() - t0)
      if sleep_left > 0:
        time.sleep(sleep_left)

  def read(self):
    with self.lock:
      return None if self.frame is None else self.frame.copy()

  def stop(self):
    self.running = False
    if self.thread is not None:
      self.thread.join(timeout=1)
    if self.cap is not None:
      self.cap.release()


# ===== 5c. Registry grabber =====
_grabbers = {}
_grabbers_lock = threading.Lock()


def get_grabber(camera_id):
  with _grabbers_lock:
    g = _grabbers.get(camera_id)
    if g is None:
      device = CAM_MAPPING.get(camera_id, f"/dev/video{camera_id}")
      grabber_cls = DevCameraGrabber if DEV_MODE else CameraGrabber
      g = grabber_cls(device, camera_id)
      g.start()
      _grabbers[camera_id] = g
    return g


def stop_all_grabbers():
  with _grabbers_lock:
    for g in _grabbers.values():
      g.stop()
    _grabbers.clear()


# ==================== 6. MAVLINK / TELEMETRI ====================
# ===== 6a. Handler per tipe pesan MAVLink (mode asli) =====
def _on_attitude(msg):
  state["roll"] = math.degrees(msg.roll)
  state["pitch"] = math.degrees(msg.pitch)
  raw_yaw = math.degrees(msg.yaw)
  state["yaw"] = raw_yaw if raw_yaw >= 0 else raw_yaw + 360
  state["rollspeed"] = math.degrees(msg.rollspeed)
  state["pitchspeed"] = math.degrees(msg.pitchspeed)
  state["yawspeed"] = math.degrees(msg.yawspeed)


def _on_local_position_ned(msg):
  x, y, z = msg.x, msg.y, msg.z
  if not state["pos_valid"] and (abs(x) > 0.05 or abs(y) > 0.05):
    state["pos_valid"] = True
  state["x"], state["y"], state["z"] = x, y, z

  raw_depth = max(0.0, z)
  depth_from_ned = max(0.0, raw_depth - 0.19)
  # Sensor tekanan (SCALED_PRESSURE2) adalah kedalaman ASLI; estimasi NED hanya pengisi sementara sebelum kalibrasi tekanan permukaan selesai.
  if state.get("depth_pressure", 0.0) <= 0.01:
    state["depth"] = depth_from_ned


def _on_vfr_hud(msg):
  depth_from_alt = max(0.0, -msg.alt)
  if state.get("depth_pressure", 0.0) <= 0.01:
    state["depth"] = depth_from_alt


def _on_rc_channels(msg):
  global _dr_last_t
  ch5_forward = msg.chan5_raw if hasattr(msg, "chan5_raw") else 1500
  now = time.time()
  if _dr_last_t is not None:
    dt = now - _dr_last_t
    if 0 < dt < 0.5 and not state["pos_valid"]:
      if abs(ch5_forward - 1500) > 50:
        speed = 0.6 if ch5_forward > 1500 else -0.6
        yaw_rad = math.radians(state.get("yaw", 0))
        state["dr_x"] += speed * math.cos(yaw_rad) * dt
        state["dr_y"] += speed * math.sin(yaw_rad) * dt
  _dr_last_t = now


def _on_raw_imu(msg):
  global _dr_vx, _dr_vy, _dr_last_t
  SC = 9.80665 / 1000.0
  ax_body = msg.xacc * SC
  ay_body = msg.yacc * SC

  roll_r = math.radians(state.get("roll", 0.0))
  pitch_r = math.radians(state.get("pitch", 0.0))
  yr = math.radians(state.get("yaw", 0.0))

  g = 9.80665
  ax_body -= g * math.sin(pitch_r)
  ay_body += g * math.sin(roll_r) * math.cos(pitch_r)

  ax_ned = ax_body * math.cos(yr) - ay_body * math.sin(yr)
  ay_ned = ax_body * math.sin(yr) + ay_body * math.cos(yr)

  now = time.time()
  with _dr_lock:
    if _dr_last_t is not None and not state["pos_valid"]:
      dt = now - _dr_last_t
      if 0 < dt < 0.5:
        DECAY = 0.90
        _dr_vx = _dr_vx * DECAY + ax_ned * dt
        _dr_vy = _dr_vy * DECAY + ay_ned * dt
        if abs(_dr_vx) > 0.02 or abs(_dr_vy) > 0.02:
          state["dr_x"] += _dr_vx * dt
          state["dr_y"] += _dr_vy * dt
    _dr_last_t = now


def _on_scaled_pressure2(msg):
  global surface_pressure_hpa
  if surface_pressure_hpa is None:
    surface_pressure_hpa = msg.press_abs
    print(
      "[DEPTH] Surface pressure calibrated: {:.2f} hPa".format(
          surface_pressure_hpa
      )
    )
  depth_from_pressure = max(0.0, (msg.press_abs - surface_pressure_hpa) / 98.0665)
  state["depth_pressure"] = depth_from_pressure
  # Sensor tekanan = sumber utama "depth" begitu tersedia.
  state["depth"] = depth_from_pressure


def _on_servo_output_raw(msg):
  # PWM 1-6 persis seperti yang dikirim Pixhawk ke thruster.
  state["pwm"] = {
    "PWM1": msg.servo1_raw,
    "PWM2": msg.servo2_raw,
    "PWM3": msg.servo3_raw,
    "PWM4": msg.servo4_raw,
    "PWM5": msg.servo5_raw,
    "PWM6": msg.servo6_raw,
  }


# ===== Jalur perintah ke Pixhawk (tab Thruster) =====
_mav_master = None 
_mav_send_lock = threading.Lock()
_mav_cmd_lock = threading.Lock() 
_mav_cond = threading.Condition()
_params = {}
_last_ack = {}  


class MavCommandError(Exception):
  """Perintah ke Pixhawk gagal (belum terhubung, tidak ada balasan, ditolak)."""


def _on_heartbeat(msg):
  if msg.autopilot == mavutil.mavlink.MAV_AUTOPILOT_INVALID:
    return
  if msg.type == mavutil.mavlink.MAV_TYPE_GCS:
    return
  state["armed"] = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)


def _on_param_value(msg):
  name = msg.param_id
  if isinstance(name, bytes):
    name = name.decode("ascii", "ignore")
  name = name.rstrip("\x00")
  with _mav_cond:
    _params[name] = {"value": float(msg.param_value), "type": int(msg.param_type), "t": time.time()}
    _mav_cond.notify_all()


def _on_command_ack(msg):
  with _mav_cond:
    _last_ack[int(msg.command)] = {"result": int(msg.result), "t": time.time()}
    _mav_cond.notify_all()


_MAVLINK_HANDLERS = {
  "HEARTBEAT": _on_heartbeat,
  "PARAM_VALUE": _on_param_value,
  "COMMAND_ACK": _on_command_ack,
  "ATTITUDE": _on_attitude,
  "LOCAL_POSITION_NED": _on_local_position_ned,
  "VFR_HUD": _on_vfr_hud,
  "RC_CHANNELS": _on_rc_channels,
  "RAW_IMU": _on_raw_imu,
  "SCALED_PRESSURE2": _on_scaled_pressure2,
  "SERVO_OUTPUT_RAW": _on_servo_output_raw,
}


def _run_mavlink_once():
  """
  Satu sesi koneksi MAVLink. Keluar normal kalau heartbeat timeout;
  melempar exception kalau koneksi putus (ditangkap mavlink_thread).
  """
  global _dr_vx, _dr_vy, _dr_last_t, _mav_master

  print(f"[MAVLink] Menghubungkan ke port {SERIAL_PORT}...")
  master = mavutil.mavlink_connection(
    SERIAL_PORT, baud=BAUD_RATE, source_system=MAV_SOURCE_SYSTEM
  )
  hb = master.wait_heartbeat(timeout=10)
  if hb is None:
    print("[MAVLink] Heartbeat timeout. Mencoba kembali...")
    time.sleep(3)
    return

  print(f"[MAVLink] Terhubung! System ID: {master.target_system}")
  state["mavlink_connected"] = True
  _mav_master = master

  def request_message(msg_id, hz):
    master.mav.command_long_send(
      master.target_system,
      master.target_component,
      mavutil.mavlink.MAV_CMD_SET_MESSAGE_INTERVAL,
      0,
      msg_id,
      1e6 / hz,
      0,
      0,
      0,
      0,
      0,
    )

  request_message(mavutil.mavlink.MAVLINK_MSG_ID_ATTITUDE, 10)
  request_message(mavutil.mavlink.MAVLINK_MSG_ID_LOCAL_POSITION_NED, 10)
  request_message(mavutil.mavlink.MAVLINK_MSG_ID_VFR_HUD, 10)
  request_message(mavutil.mavlink.MAVLINK_MSG_ID_SCALED_PRESSURE, 10)
  request_message(mavutil.mavlink.MAVLINK_MSG_ID_SCALED_PRESSURE2, 10)
  request_message(mavutil.mavlink.MAVLINK_MSG_ID_RAW_IMU, 25)
  request_message(mavutil.mavlink.MAVLINK_MSG_ID_RC_CHANNELS, 10)
  request_message(mavutil.mavlink.MAVLINK_MSG_ID_SERVO_OUTPUT_RAW, 10)

  # Reset dead reckoning tiap koneksi baru
  _dr_vx = 0.0
  _dr_vy = 0.0
  _dr_last_t = None
  state["dr_x"] = 0.0
  state["dr_y"] = 0.0
  state["pos_valid"] = False

  try:
    while True:
      msg = master.recv_match(blocking=False)
      if msg is None:
        time.sleep(0.001)
        continue
      handler = _MAVLINK_HANDLERS.get(msg.get_type())
      if handler:
        handler(msg)
  finally:
    _mav_master = None


# ===== 6c. Perintah ke Pixhawk: baca/tulis parameter, uji motor =====
# Simulasi DEV: parameter palsu supaya tab Thruster bisa dites tanpa robot.
_dev_params = {
  MOTOR_DIR_PARAM.format(n=n): {"value": 1.0, "type": 2, "t": 0.0}
  for n in range(1, MOTOR_COUNT + 1)
}
_dev_motor_test = {"motor": 0, "until": 0.0, "percent": 0.0}


def _require_master():
  master = _mav_master
  if master is None:
    raise MavCommandError("Pixhawk belum terhubung")
  return master


def _wait_param(name, since, timeout):
  """Tunggu PARAM_VALUE untuk `name` yang diterima setelah waktu `since`."""
  deadline = time.time() + timeout
  with _mav_cond:
    while True:
      p = _params.get(name)
      if p and p["t"] >= since:
        return dict(p)
      remaining = deadline - time.time()
      if remaining <= 0:
        raise MavCommandError(f"Pixhawk tidak membalas ({name})")
      _mav_cond.wait(remaining)


def mav_param_read(name, timeout=MAV_REPLY_TIMEOUT):
  if DEV_MODE:
    p = _dev_params.get(name)
    if p is None:
      raise MavCommandError(f"Parameter {name} tidak ada (simulasi)")
    return {**p, "t": time.time()}
  master = _require_master()
  t_sent = time.time()
  with _mav_send_lock:
    master.mav.param_request_read_send(
      master.target_system, master.target_component, name.encode("ascii"), -1
    )
  return _wait_param(name, t_sent, timeout)


def mav_param_write(name, value, timeout=MAV_REPLY_TIMEOUT):
  """
  Tulis parameter, lalu BACA ULANG dari Pixhawk. Mengembalikan (nilai_lama, nilai_baru_hasil_baca_ulang).
  Pemanggil yang membandingkan nilai_baru dengan yang diminta; jangan percaya "terkirim" saja.
  """
  old = mav_param_read(name, timeout)
  if DEV_MODE:
    time.sleep(0.2)
    _dev_params[name]["value"] = float(value)
    return old["value"], float(value)
  master = _require_master()
  t_sent = time.time()
  with _mav_send_lock:
    master.mav.param_set_send(
      master.target_system, master.target_component,
      name.encode("ascii"), float(value), old["type"],
    )
  _wait_param(name, t_sent, timeout) 
  new = mav_param_read(name, timeout)
  return old["value"], new["value"]


def mav_motor_test(motor, percent, seconds, timeout=MAV_REPLY_TIMEOUT):
  """Putar SATU motor sebentar (MAV_CMD_DO_MOTOR_TEST). Nilai dibatasi di sini, bukan percaya browser."""
  percent = max(1, min(MOTOR_TEST_MAX_PERCENT, int(percent)))
  seconds = max(1, min(MOTOR_TEST_MAX_SECONDS, int(seconds)))

  if DEV_MODE:
    _dev_motor_test.update(motor=motor, until=time.time() + seconds, percent=percent)
    return {"result": 0, "result_text": "ACCEPTED (simulasi)", "percent": percent, "seconds": seconds}

  master = _require_master()
  CMD = mavutil.mavlink.MAV_CMD_DO_MOTOR_TEST
  t_sent = time.time()
  with _mav_send_lock:
    master.mav.command_long_send(
      master.target_system, master.target_component, CMD, 0,
      motor,       # p1: nomor motor (mulai 1)
      0,           # p2: jenis throttle 0 = persen
      percent,     # p3: nilai
      seconds,     # p4: durasi detik
      1,           # p5: jumlah motor di Test berurutan
      0,           # p6: urutan Test (default)
      0,
    )
  deadline = t_sent + timeout
  with _mav_cond:
    while True:
      ack = _last_ack.get(int(CMD))
      if ack and ack["t"] >= t_sent:
        break
      remaining = deadline - time.time()
      if remaining <= 0:
        raise MavCommandError("Pixhawk tidak membalas perintah uji motor")
      _mav_cond.wait(remaining)
  try:
    text = mavutil.mavlink.enums["MAV_RESULT"][ack["result"]].name
  except Exception:
    text = str(ack["result"])
  return {"result": ack["result"], "result_text": text, "percent": percent, "seconds": seconds}


def _fallback_simulation_loop():
  """Simulasi sederhana kalau pymavlink tidak terpasang (perilaku asli)."""
  global _dr_last_t
  while True:
    time.sleep(0.1)
    now = time.time()
    if _dr_last_t is None:
      _dr_last_t = now
      continue
    dt = now - _dr_last_t
    _dr_last_t = now

    state["yaw"] = (state.get("yaw", 0) + 4) % 360
    yaw_rad = math.radians(state["yaw"])
    state["dr_x"] += 0.4 * math.cos(yaw_rad) * dt
    state["dr_y"] += 0.4 * math.sin(yaw_rad) * dt
    state["depth"] = 0.4 + 0.1 * math.sin(now)
    state["mavlink_connected"] = True
    state["pos_valid"] = False
    for i in range(1, 7):
      state["pwm"][f"PWM{i}"] = round(1500 + 30 * math.sin(now + i))


# ===== 6b. Simulasi DEV (laptop) =====
def _dev_telemetry_loop():
  """
  Telemetri palsu untuk pengembangan di laptop: ROV berputar pelan, roll/pitch bergoyang, kedalaman naik-turun (0.2-1.8 m, supaya warna jejak berubah), PWM bergoyang di sekitar 1500.

  ROV_DEV_POS=dr  (default) -> pos_valid False, posisi lewat dr_x/dr_y => trajectory tampil mode "DR"
  ROV_DEV_POS=ned           -> pos_valid True, posisi lewat x/y => trajectory tampil mode "PIXHAWK"
  """
  print(
    f"[DEV] Telemetri simulasi aktif (posisi: {DEV_POSITION_MODE.upper()}).")
  t0 = time.time()
  last = t0
  state["mavlink_connected"] = True

  while True:
    time.sleep(0.1)
    now = time.time()
    dt = now - last
    last = now
    t = now - t0

    state["roll"] = 8.0 * math.sin(t * 0.7)
    state["pitch"] = 5.0 * math.sin(t * 0.5 + 1.0)
    state["yaw"] = (state["yaw"] + 4 * dt * 10) % 360  # ~4 deg / 0.1 s

    depth = 1.0 + 0.8 * math.sin(t * 0.2)
    state["depth"] = depth
    state["depth_pressure"] = depth

    if DEV_POSITION_MODE == "ned":
      radius, w = 1.5, 0.3
      state["x"] = radius * math.sin(w * t)
      state["y"] = radius * (1 - math.cos(w * t))
      state["z"] = depth + 0.19
      state["pos_valid"] = True
    else:
      yaw_rad = math.radians(state["yaw"])
      state["dr_x"] += 0.4 * math.cos(yaw_rad) * dt
      state["dr_y"] += 0.4 * math.sin(yaw_rad) * dt
      state["pos_valid"] = False

    for i in range(1, 7):
      state["pwm"][f"PWM{i}"] = round(1500 + 30 * math.sin(now + i))

    # Simulasi uji motor: PWM motor itu naik/turun sesuai arah (MOT_n_DIRECTION) selama uji.
    test = _dev_motor_test
    if now < test["until"] and 1 <= test["motor"] <= 6:
      direction = _dev_params[MOTOR_DIR_PARAM.format(n=test["motor"])]["value"]
      state["pwm"][f"PWM{test['motor']}"] = round(1500 + 4 * test["percent"] * direction)
    state["armed"] = False


def mavlink_thread():
  """Pilih sumber telemetri: simulasi DEV, fallback dummy, atau MAVLink asli."""
  if DEV_MODE:
    _dev_telemetry_loop()
    return
  if not MAVLINK_AVAILABLE:
    _fallback_simulation_loop()
    return

  while True:
    try:
      _run_mavlink_once()
    except Exception as e:
      print(f"[MAVLink] Terputus / Error: {e}")
      state["mavlink_connected"] = False
      time.sleep(3)


# ==================== 7. PEMROSESAN GAMBAR (zoom, white balance, gamma) ====================
def zoom_frame(frame, zoom=1.0):
  """Zoom digital (crop tengah lalu resize ke ukuran asli)."""
  if zoom <= 1.0:
    return frame
  h, w = frame.shape[:2]
  nw = int(w / zoom)
  nh = int(h / zoom)
  x1 = (w - nw) // 2
  y1 = (h - nh) // 2
  return cv2.resize(frame[y1: y1 + nh, x1: x1 + nw], (w, h))


def get_zoom_level(camera_id):
  with zoom_lock:
    return zoom_levels.get(camera_id, 1.0)


def white_balance_gray_world(frame):
  result = frame.astype(np.float32)
  avg_b = np.mean(result[:, :, 0])
  avg_g = np.mean(result[:, :, 1])
  avg_r = np.mean(result[:, :, 2])
  avg_gray = (avg_b + avg_g + avg_r) / 3
  result[:, :, 0] *= avg_gray / (avg_b + 1e-6)
  result[:, :, 1] *= avg_gray / (avg_g + 1e-6)
  result[:, :, 2] *= avg_gray / (avg_r + 1e-6)
  return np.clip(result, 0, 255).astype(np.uint8)


def adjust_gamma(frame, gamma=1.0):
  inv_gamma = 1.0 / gamma
  table = np.array([((i / 255.0) ** inv_gamma) * 255 for i in range(256)]).astype("uint8")
  return cv2.LUT(frame, table)


def adaptive_gamma(frame, dark_threshold=80, bright_threshold=170):
  gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
  brightness = np.mean(gray)
  if brightness < dark_threshold:
    return adjust_gamma(frame, gamma=0.7)
  elif brightness > bright_threshold:
    return adjust_gamma(frame, gamma=1.3)
  return frame


def enhance_frame(frame):
  """
  Peningkatan gambar (white balance + adaptive gamma).
  Saat ini TIDAK dipanggil (ENHANCE_EVERY_FRAME = False). 
  Dulu isinya dikomentari dan mengembalikan variabel yang tidak ada; sekarang aman dipanggil tapi hasilnya sama persis dengan frame asli sampai kamu mengaktifkan dua baris di bawah.
  """
  if frame is None:
    return None
  enhanced = frame
  # enhanced = white_balance_gray_world(frame.copy())
  # enhanced = adaptive_gamma(enhanced)
  return enhanced


# ==================== 8. DETEKSI QR ====================
# QR discan di thread terpisah (per kamera) supaya decode yang lambat tidak membekukan loop video.
_qr_busy = {cam_id: False for cam_id in CAM_MAPPING}
_qr_busy_lock = threading.Lock()

# Cache bounding box QR terakhir per kamera. Box otomatis hilang kalau lebih tua dari QR_BOX_TTL detik.
_qr_box = {cam_id: None for cam_id in CAM_MAPPING}
_qr_box_lock = threading.Lock()


def scan_qr_async(frame, camera_id):
  """
  Jalankan scan QR di thread terpisah. 
  Skip kalau scan sebelumnya untuk kamera ini masih berjalan.
  """
  with _qr_busy_lock:
    if _qr_busy.get(camera_id):
      return
    _qr_busy[camera_id] = True

  # Perkecil dulu sebelum dikirim ke thread -> decode jauh lebih cepat
  if QR_SCAN_DOWNSCALE < 1.0:
    small = cv2.resize(
      frame,
      None,
      fx=QR_SCAN_DOWNSCALE,
      fy=QR_SCAN_DOWNSCALE,
      interpolation=cv2.INTER_AREA,
    )
  else:
    small = frame.copy()

  threading.Thread(
    target=_scan_qr_worker, args=(small, camera_id), daemon=True
  ).start()


def _scan_qr_worker(frame, camera_id):
  """
  pyzbar dulu (kalau ada); kalau tidak ketemu, fallback cv2.QRCodeDetector.
  Koordinat box diskalakan balik ke ukuran frame asli.
  """
  try:
    text = None
    points = None

    if PYZBAR_AVAILABLE:
      barcodes = pyzbar.decode(frame)
      if barcodes:
        b = barcodes[0]
        text = b.data.decode("utf-8")
        if b.polygon and len(b.polygon) >= 4:
          points = [(p.x, p.y) for p in b.polygon]
        else:
          x, y, w, h = b.rect
          points = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]

    if text is None:
      data, bbox, _ = _cv2_qr_detector.detectAndDecode(frame)
      if data and bbox is not None:
        text = data
        quad = bbox[0] if bbox.ndim == 3 else bbox
        points = [(float(p[0]), float(p[1])) for p in quad]

    if not text:
      return

    # Buang "?" dan spasi di pinggir, mis. "?D?" -> "D"
    clean_text = text.strip().strip("?").strip() or text

    if QR_SCAN_DOWNSCALE < 1.0 and points:
      inv = 1.0 / QR_SCAN_DOWNSCALE
      points = [(px * inv, py * inv) for (px, py) in points]

    detail = {
      "target_id": clean_text,
      "type": "QR-CODE",
      "valid": True,
      "time": datetime.datetime.now().strftime("%H:%M:%S"),
    }
    state["qr_data_by_camera"][str(camera_id)] = detail
    state["qr_data"] = {**detail, "camera_id": camera_id}

    with _qr_box_lock:
      _qr_box[camera_id] = {
        "points": points,
        "text": clean_text,
        "time": time.time(),
      }
  finally:
    with _qr_busy_lock:
      _qr_busy[camera_id] = False


def draw_qr_box(frame, camera_id):
  """
  Gambar box hijau + label QR terakhir kamera ini (kalau masih fresh, lihat QR_BOX_TTL). 
  Kalau tidak, frame dikembalikan apa adanya.
  """
  with _qr_box_lock:
    box = _qr_box.get(camera_id)

  if box is None or (time.time() - box["time"]) > QR_BOX_TTL:
    return frame

  pts = np.array(box["points"], dtype=np.int32).reshape((-1, 1, 2))
  cv2.polylines(frame, [pts], isClosed=True, color=(0, 255, 0), thickness=2)

  label = box["text"]
  x_min = min(p[0] for p in box["points"])
  y_min = min(p[1] for p in box["points"])
  label_org = (int(x_min), int(max(0, y_min - 8)))

  font = cv2.FONT_HERSHEY_SIMPLEX
  font_scale = 0.6
  thickness = 2
  (tw, th), baseline = cv2.getTextSize(label, font, font_scale, thickness)

  # Kotak latar solid supaya label terbaca di air keruh/gelap
  bg_top_left = (label_org[0], label_org[1] - th - baseline)
  bg_bottom_right = (label_org[0] + tw, label_org[1] + baseline)
  cv2.rectangle(frame, bg_top_left, bg_bottom_right, (0, 255, 0), thickness=-1)
  cv2.putText(frame, label, label_org, font, font_scale, ( 0, 0, 0), thickness, cv2.LINE_AA)
  return frame


# ==================== 9. PIPELINE FRAME: grabber -> processing -> snapshot cache + RTSP ====================
_frame_sources = {}  # camera_id -> {"frame": ndarray|None, "lock": Lock()}

def get_frame_source(camera_id):
  if camera_id not in _frame_sources:
    _frame_sources[camera_id] = {"frame": None, "lock": threading.Lock()}
  return _frame_sources[camera_id]


def processing_loop(camera_id):
  """
  Loop per kamera (hidup selama proses jalan, aktif hanya saat cameras_active True):
    1. Ambil frame mentah dari grabber.
    2. zoom -> (opsional enhance) -> scan QR async -> gambar box QR.
    3. Gambar teks FPS lalu simpan ke _last_frames (snapshot/MJPEG) dan _frame_sources (RTSP appsrc).
  """
  src = get_frame_source(camera_id)
  frame_count = 0
  fps_count = 0
  fps_start = time.time()
  period = 1.0 / cam_cfg(camera_id)["fps"]
  grabber = None

  while True:
    if not cameras_active:
      grabber = None
      time.sleep(0.05)
      continue

    if grabber is None:
      grabber = get_grabber(camera_id)

    t0 = time.time()
    frame = grabber.read()
    if frame is None:
      time.sleep(0.01)
      continue

    frame_count += 1
    fps_count += 1
    now = time.time()
    fps_elapsed = now - fps_start
    if fps_elapsed >= 1.0:
      display_fps[camera_id] = fps_count / fps_elapsed
      fps_count = 0
      fps_start = now

    frame = zoom_frame(frame, get_zoom_level(camera_id))

    if ENHANCE_EVERY_FRAME:
      frame = enhance_frame(frame)

    # QR discan di semua kamera. Box digambar tiap frame (bukan cuma tiap N frame) supaya mulus.
    if frame_count % QR_SCAN_EVERY_N_FRAMES == 0:
      scan_qr_async(frame, camera_id)
    frame = draw_qr_box(frame, camera_id)

    fps_text = f"CAM {camera_id} | FPS: {display_fps[camera_id]:.1f}"
    cv2.putText(
      frame,
      fps_text,
      (15, 30),
      cv2.FONT_HERSHEY_SIMPLEX,
      0.8,
      (0, 255, 0),
      2,
      cv2.LINE_AA,
    )

    with _last_frames_lock:
      _last_frames[camera_id] = frame
    with src["lock"]:
      src["frame"] = frame

    sleep_left = period - (time.time() - t0)
    if sleep_left > 0:
      time.sleep(sleep_left)


# ==================== 10. RTSP SERVER (gst-rtsp-server) ====================
# HARDWARE H.264 (NVENC) Hanya aktif di Jetson. Di mode DEV / tanpa GStreamer dilewati.
if RTSP_AVAILABLE:

  def rtsp_push_loop(camera_id, appsrc_holder):
    """Thread per kamera: ambil frame terbaru hasil processing, bungkus jadi GstBuffer, dorong ke appsrc pipeline RTSP."""
    src = get_frame_source(camera_id)
    period = 1.0 / cam_cfg(camera_id)["fps"]

    while True:
      appsrc = appsrc_holder.get("appsrc")
      if appsrc is None or not cameras_active:
        time.sleep(0.05)
        continue

      with src["lock"]:
        frame = src["frame"]

      if frame is None:
        time.sleep(0.02)
        continue

      data = frame.tobytes()
      buf = Gst.Buffer.new_allocate(None, len(data), None)
      buf.fill(0, data)
      appsrc.emit("push-buffer", buf)
      time.sleep(period)

  class CamRTSPFactory(GstRtspServer.RTSPMediaFactory):
    """
    Satu factory per kamera, di-mount ke /cameraN. Pipeline dipakai bersama semua client (set_shared(True)):

      appsrc (BGR dari OpenCV) -> videoconvert (I420)
        -> nvvidconv (NVMM) -> nvv4l2h264enc (NVENC)
        -> h264parse -> rtph264pay (pay0)
    """

    def __init__(self, camera_id, width, height, fps):
      super().__init__()
      self.camera_id = camera_id
      self._holder = {"appsrc": None}

      self.set_shared(True)
      try:
        self.set_latency(0)  # kurangi buffering kalau versi mendukung
      except Exception:
        pass

      bitrate_bps = RTSP_BITRATE_KBPS * 1000
      launch = (
        f"appsrc name=src{camera_id} is-live=true block=false format=time "
        f"do-timestamp=true "
        f"caps=video/x-raw,format=BGR,width={width},height={height},framerate={fps}/1 "
        f"! videoconvert ! video/x-raw,format=I420 "
        f"! nvvidconv ! video/x-raw(memory:NVMM),format=I420 "
        f"! nvv4l2h264enc name=enc{camera_id} "
        f"  bitrate={bitrate_bps} "
        f"  insert-sps-pps=1 "
        f"  iframeinterval={RTSP_IFRAME_INTERVAL} "
        f"  maxperf-enable=1 "
        f"  control-rate={RTSP_CONTROL_RATE_CBR} "
        f"  preset-level={RTSP_PRESET_ULTRAFAST} "
        f"! h264parse config-interval=1 "
        f"! rtph264pay name=pay0 pt=96 config-interval=1"
      )
      # Kalau ada properti nvv4l2h264enc yang bikin pipeline gagal di
      # board-mu: cek `gst-inspect-1.0 nvv4l2h264enc`, lalu hapus/ganti.
      self.set_launch(launch)
      self.connect("media-configure", self._on_media_configure)

      threading.Thread(
        target=rtsp_push_loop, args=(camera_id, self._holder), daemon=True
      ).start()

    def _on_media_configure(self, factory, media):
      element = media.get_element()
      self._holder["appsrc"] = element.get_by_name(f"src{self.camera_id}")
      print(
        f"[RTSP] Camera {self.camera_id}: appsrc terhubung ke pipeline NVENC."
      )

  def start_rtsp_server():
    server = GstRtspServer.RTSPServer()
    server.props.service = RTSP_PORT
    mounts = server.get_mount_points()

    for cam_id in CAM_MAPPING.keys():
      cfg = cam_cfg(cam_id)
      factory = CamRTSPFactory(cam_id, cfg["width"], cfg["height"], cfg["fps"])
      mounts.add_factory(f"/camera{cam_id}", factory)

    server.attach(None)
    urls = ", ".join(rtsp_url_for(c) for c in CAM_MAPPING)
    print(f"[RTSP] Server aktif di port {RTSP_PORT} -> {urls}")

    GLib.MainLoop().run()


def start_background_services():
  """Nyalakan semua thread latar belakang."""
  threading.Thread(target=mavlink_thread, daemon=True).start()

  if RTSP_AVAILABLE:
    threading.Thread(target=start_rtsp_server, daemon=True).start()

  for cam_id in CAM_MAPPING.keys():
    threading.Thread(target=processing_loop,
    args=(cam_id,), daemon=True).start()


# ==================== 11. ROUTE HTTP FLASK ====================
# ===== Kamera =====
@app.route("/start_cameras", methods=["POST"])
def start_cameras():
  global cameras_active
  if not cameras_active:
    cameras_active = True
  return jsonify({"status": "cameras activated"})


@app.route("/stop_cameras", methods=["POST"])
def stop_cameras():
  global cameras_active
  cameras_active = False
  stop_all_grabbers()
  return jsonify({"status": "cameras deactivated"})


def mjpeg_preview_generator(camera_id, target_fps=25):
  """
  Preview MJPEG ringan untuk <img> di dashboard. 
  TIDAK membaca kamera lagi dan TIDAK menyentuh RTSP: hanya meng-encode JPEG dari frame yang sudah diproses processing_loop() (_last_frames) - frame yang sama dengan /snapshot dan RTSP (termasuk box QR).
  """
  period = 1.0 / target_fps
  while True:
    if not cameras_active:
      time.sleep(0.2)
      continue
    with _last_frames_lock:
      frame = _last_frames.get(camera_id)
    if frame is None:
      time.sleep(0.1)
      continue
    ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
      time.sleep(0.05)
      continue
    yield (
      b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg.tobytes() + b"\r\n"
    )
    time.sleep(period)


@app.route("/video_feed/<int:camera_id>")
def video_feed(camera_id):
  """
  Stream MJPEG untuk preview dashboard (bukan pipeline video utama; 
  yang utama RTSP NVENC, lihat GET /status -> video.rtsp_urls).
  """
  if camera_id not in CAM_MAPPING:
    return jsonify({"error": f"Camera {camera_id} tidak dikenal"}), 404
  return Response(
    mjpeg_preview_generator(camera_id),
    mimetype="multipart/x-mixed-replace; boundary=frame",
  )


@app.route("/snapshot/<int:camera_id>")
def snapshot(camera_id):
  with _last_frames_lock:
    if camera_id in _last_frames:
      ret, jpeg = cv2.imencode(".jpg", _last_frames[camera_id])
      if ret:
        return Response(jpeg.tobytes(), mimetype="image/jpeg")
  return jsonify({"error": f"No cached frame for camera {camera_id}"}), 404


# ===== Zoom manual per kamera =====
@app.route("/zoom/in/<int:camera_id>", methods=["POST"])
def zoom_in(camera_id):
  if camera_id not in CAM_MAPPING:
    return jsonify({"error": f"Camera {camera_id} tidak dikenal"}), 404
  with zoom_lock:
    level = min(round(zoom_levels.get(camera_id, 1.0) + 0.2, 1), 3.0)
    zoom_levels[camera_id] = level
  return jsonify({"camera_id": camera_id, "zoom_level": level})


@app.route("/zoom/out/<int:camera_id>", methods=["POST"])
def zoom_out(camera_id):
  if camera_id not in CAM_MAPPING:
    return jsonify({"error": f"Camera {camera_id} tidak dikenal"}), 404
  with zoom_lock:
    level = max(round(zoom_levels.get(camera_id, 1.0) - 0.2, 1), 1.0)
    zoom_levels[camera_id] = level
  return jsonify({"camera_id": camera_id, "zoom_level": level})


@app.route("/zoom/in", methods=["POST"])
def zoom_in_default():
  return zoom_in(0)


@app.route("/zoom/out", methods=["POST"])
def zoom_out_default():
  return zoom_out(0)


# ===== Pengaturan motor (tab Thruster) =====
def _json_error(message, code):
  return jsonify({"ok": False, "error": message}), code


def _control_guard():
  """Penjaga fitur yang MENULIS ke robot. Mengembalikan response error, atau None kalau boleh lanjut."""
  if not ENABLE_MOTOR_CONFIG:
    return _json_error("Kontrol dimatikan di backend. Jalankan backend dengan ROV_ENABLE_CONTROL=1.", 403)
  if state.get("armed"):
    return _json_error("Robot sedang ARMED. Disarm dulu sebelum mengubah / menguji motor.", 409)
  return None


@app.route("/motors/directions")
def motors_directions():
  """Baca arah putar semua motor dari Pixhawk (aman: hanya membaca)."""
  motors = []
  with _mav_cmd_lock:
    for n in range(1, MOTOR_COUNT + 1):
      name = MOTOR_DIR_PARAM.format(n=n)
      try:
        value = int(round(mav_param_read(name)["value"]))
        motors.append({"n": n, "param": name, "value": value})
      except MavCommandError as e:
        motors.append({"n": n, "param": name, "value": None, "error": str(e)})
  return jsonify({
    "ok": True,
    "control_enabled": ENABLE_MOTOR_CONFIG,
    "armed": bool(state.get("armed")),
    "connected": bool(state.get("mavlink_connected")),
    "motors": motors,
  })


@app.route("/motors/<int:n>/direction", methods=["POST"])
def motor_set_direction(n):
  if not 1 <= n <= MOTOR_COUNT:
    return _json_error(f"Motor {n} tidak dikenal", 404)
  direction = (request.get_json(silent=True) or {}).get("direction")
  if direction not in (1, -1):
    return _json_error("direction harus 1 (normal) atau -1 (terbalik)", 400)
  guard = _control_guard()
  if guard:
    return guard

  name = MOTOR_DIR_PARAM.format(n=n)
  with _mav_cmd_lock:
    try:
      old, new = mav_param_write(name, direction)
    except MavCommandError as e:
      return _json_error(str(e), 502)
  verified = int(round(new)) == direction
  print(f"[MAVLink] {name}: {old:g} -> {new:g} (diminta {direction}, {'TERBUKTI' if verified else 'GAGAL'})")
  return jsonify({"ok": True, "n": n, "param": name,
                  "old": int(round(old)), "new": int(round(new)), "verified": verified})


@app.route("/motors/<int:n>/test", methods=["POST"])
def motor_test(n):
  if not 1 <= n <= MOTOR_COUNT:
    return _json_error(f"Motor {n} tidak dikenal", 404)
  body = request.get_json(silent=True) or {}
  try:
    percent = int(body.get("percent", 10))
    seconds = int(body.get("seconds", 2))
  except (TypeError, ValueError):
    return _json_error("percent dan seconds harus angka", 400)
  guard = _control_guard()
  if guard:
    return guard

  with _mav_cmd_lock:
    try:
      res = mav_motor_test(n, percent, seconds)
    except MavCommandError as e:
      return _json_error(str(e), 502)
  print(f"[MAVLink] Uji motor {n}: {res['percent']}% {res['seconds']}s -> {res['result_text']}")
  if res["result"] != 0:
    return _json_error(f"Pixhawk menolak uji motor ({res['result_text']})", 409)
  return jsonify({"ok": True, "n": n, **res})


# ===== Telemetri, model 3D, status =====
@app.route("/telemetry")
def get_telemetry():
  return jsonify(
    {
      "x": float(state.get("x", 0.0)),
      "y": float(state.get("y", 0.0)),
      "z": float(state.get("z", 0.0)),
      "roll": float(state.get("roll", 0.0)),
      "pitch": float(state.get("pitch", 0.0)),
      "yaw": float(state.get("yaw", 0.0)),
      "depth": float(state.get("depth", 0.0)),
      "depth_cm": float(state.get("depth", 0.0)) * 100.0,
      "depth_pressure": float(state.get("depth_pressure", 0.0)),
      "dr_x": float(state.get("dr_x", 0.0)),
      "dr_y": float(state.get("dr_y", 0.0)),
      "pos_valid": bool(state.get("pos_valid", False)),
      "armed": bool(state.get("armed", False)),
      "qr_data": state.get("qr_data"),
      "pwm": state.get("pwm", {}),
      # indikator LIVE / NO LINK di panel ROV DESIGN
      "mavlink_connected": bool(state.get("mavlink_connected", False)),
      "link": "connected" if state.get("mavlink_connected") else "reconnecting",
    }
  )


@app.route("/models/<path:filename>")
def serve_model(filename):
  # File model 3D (.glb/.gltf) untuk panel ROV DESIGN
  return send_from_directory(MODELS_DIR, filename)


@app.route("/status")
def status():
  return jsonify(
    {
      "backend": "online",
      "dev_mode": DEV_MODE,
      "mavlink_connected": state.get("mavlink_connected", False),
      "cameras_active": cameras_active,
      "zoom_levels": {str(c): get_zoom_level(c) for c in CAM_MAPPING},
      "pyzbar": PYZBAR_AVAILABLE,
      "cv2_qr_fallback": True,
      "pymavlink": MAVLINK_AVAILABLE,
      "video": {
        "protocol": "rtsp",
        "rtsp_urls": {str(c): rtsp_url_for(c) for c in CAM_MAPPING},
        # Resolusi/fps yang DIMINTA (dari CAM_CONFIG)
        "resolution": {
          str(c): f"{cam_cfg(c)['width']}x{cam_cfg(c)['height']}"
          for c in CAM_MAPPING
        },
        "fps": {str(c): cam_cfg(c)["fps"] for c in CAM_MAPPING},
        # FPS yang BENAR-BENAR terukur dari hardware; 
        # null kalau grabber kamera itu belum pernah dijalankan (belum POST /start_cameras)
        "measured_fps": {
          str(c): (round(_grabbers[c].measured_fps,1) if c in _grabbers else None)
          for c in CAM_MAPPING
        },
        "encoder": (
          "nvv4l2h264enc (hardware NVENC)"
          if RTSP_AVAILABLE
          else "none (RTSP nonaktif)"
        ),
      },
    }
  )


# ==================== 12. MAIN ====================
if __name__ == "__main__":
  print("=" * 50)
  print("  ROV GCS Backend System  ")
  if DEV_MODE:
    cam_src = (
      "webcam laptop (fallback sintetis)" if DEV_USE_WEBCAM else "kamera sintetis"
    )
    print(
      f"  MODE DEV (laptop) — kamera: {cam_src}, posisi: {DEV_POSITION_MODE.upper()}"
    )
    print(f"http://localhost:{HTTP_PORT} (RTSP nonaktif)")
  else:
    print(f"RTSP: {', '.join(rtsp_url_for(c) for c in CAM_MAPPING)}")
  print("=" * 50)

  start_background_services()
  app.run(host="0.0.0.0", port=HTTP_PORT, debug=False, threaded=True)