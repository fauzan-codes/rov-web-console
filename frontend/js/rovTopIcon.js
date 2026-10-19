//  ./frontend/js/rovTopIcon.js
//  rovTopIcon.js - Ikon ROV di panel "TRAJECTORY REPLAY"

//  NOTE:
//  model 3D asli ROV (assembly_rov_80.glb) - model yang sama yang
//  dipakai panel "ROV DESIGN" (rov3d.js) - supaya ikon di peta benar-benar terlihat seperti desain ROV kita, bukan cuma dot.
//
//  Cara kerja:
//   1. Render model sekali dari kamera ortografis tegak lurus dari atas ke sebuah canvas kecil (256x256), hasilnya di-cache jadi "sprite" PNG diam (tidak perlu render ulang tiap frame - jauh lebih ringan daripada rov3d.js yang render live tiap frame).
//   2. interact.js (drawTraj) memanggil window.getRovTopIconCanvas() tiap frame untuk mengambil sprite ini, lalu memutarnya sendiri di canvas 2D sesuai heading (yaw) — jadi rotasi heading tetap real-time meski render 3D-nya statis.
//
//  Kalibrasi arah "depan" model:
//  Bergantung bagaimana model 3D digambar, sisi yang tampil sebagai "depan" ROV pada sprite bisa saja tidak menghadap ke atas (utara, yaw=0) secara default. Kalau ikon di peta trajectory kelihatan "muter salah arah" dibanding arah gerak ROV yang sebenarnya, ubah FORWARD_OFFSET_DEG di bawah (misal 90, 180, atau -90) sampai cocok - atau panggil window.setRovIconForwardOffset(deg) dari console browser untuk coba-coba tanpa reload file.


import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BACKEND_URL = window.ROV_BACKEND_URL || 'http://192.168.1.10:8080';
const MODEL_URL    = `${BACKEND_URL}/models/assembly_rov_80.glb`;

const ICON_RES = 256; // resolusi render sprite (px)

let FORWARD_OFFSET_DEG = 0; // lihat catatan kalibrasi di atas

// ===== Scene tampak-atas (untuk snapshot) =====
const scene = new THREE.Scene();
scene.background = null;

const camDist = 6;
const camera = new THREE.OrthographicCamera(-1.7, 1.7, 1.7, -1.7, 0.01, 50);
camera.position.set(0, camDist, 0.0001);
camera.up.set(0, 0, -1);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(ICON_RES, ICON_RES);
renderer.setPixelRatio(1);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

scene.add(new THREE.HemisphereLight(0xdff2ff, 0x0b1622, 2.6));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 8, 4);
scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-4, 4, -3);
scene.add(fill);

const rov = new THREE.Group();
scene.add(rov);

let _iconCanvas = null; // cache hasil render (256x256, transparan)
let modelReady  = false;

function fitModel(model) {
  const box    = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  model.position.sub(center);

  const footprint = Math.max(size.x, size.z) || 1;
  model.scale.setScalar(2.6 / footprint);
}

function renderIconSnapshot() {
  renderer.render(scene, camera);
  if (!_iconCanvas) _iconCanvas = document.createElement('canvas');
  _iconCanvas.width  = ICON_RES;
  _iconCanvas.height = ICON_RES;
  const ctx = _iconCanvas.getContext('2d');
  ctx.clearRect(0, 0, ICON_RES, ICON_RES);
  ctx.drawImage(renderer.domElement, 0, 0);
}

new GLTFLoader().load(
  MODEL_URL,
  (gltf) => {
    rov.add(gltf.scene);
    fitModel(gltf.scene);
    renderIconSnapshot();
    modelReady = true;
  },
  undefined,
  (err) => {
    console.error('[ROV-ICON] Gagal memuat model GLB untuk ikon trajectory dari', MODEL_URL, err);
  }
);

// ===== API dipakai interact.js =====
window.getRovTopIconCanvas = function () {
  return modelReady ? _iconCanvas : null;
};

window.rovTopIconReady = function () {
  return modelReady;
};

window.getRovIconForwardOffset = function () {
  return FORWARD_OFFSET_DEG;
};
window.setRovIconForwardOffset = function (deg) {
  FORWARD_OFFSET_DEG = Number(deg) || 0;
};
