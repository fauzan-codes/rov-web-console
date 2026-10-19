//  ./frontend/js/rov3d.js
//  rov3d.js - Model 3D ROV di panel "ROV DESIGN"

//  NOTE:
//  file ini menempel LANGSUNG ke backend.py (port 8080 lewat BACKEND_URL) supaya orientasi model ini otomatis mengikuti data Pixhawk yang sama dengan panel TELEMETRY lain di dashboard - tidak perlu server / koneksi Pixhawk kedua.
//
//  interact.js memanggil window.updateRovOrientation(...) setiap kali dapat data baru dari GET /telemetry (setiap 100ms).


import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const container = document.getElementById('rovViewport');

if (container) {
  // window.ROV_BACKEND_URL di-set oleh interact.js (lihat BACKEND_URL di sana). Fallback dipakai kalau rov3d.js dimuat sendirian.
  const BACKEND_URL = window.ROV_BACKEND_URL || 'http://192.168.1.10:8080';
  const MODEL_URL    = `${BACKEND_URL}/models/assembly_rov_80.glb`;

  const linkEl  = document.getElementById('rov3dLink');
  const depthEl = document.getElementById('rov3dDepth');

  // ===== SCENE =====
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07111b);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(2.4, 1.7, 3.4);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  controls.minDistance = 1.5;
  controls.maxDistance = 12;

  scene.add(new THREE.HemisphereLight(0xbfdfff, 0x16202a, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(4, 6, 5);
  scene.add(key);

  const grid = new THREE.GridHelper(8, 16, 0x22d3ee, 0x14384a);
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  const rov = new THREE.Group();
  scene.add(rov);

  // ===== JEJAK LINTASAN 3D (trail) =====
  // Sama seperti panel "TRAJECTORY REPLAY" 2D di interact.js, tapi digambar sebagai garis di sekitar model, bukan peta datar. 
  // interact.js memanggil window.updateRov3DTrail(x, y, depth, yaw, posValid) tiap 100ms dari GET /telemetry (lihat fetchTelemetry()).
  const TRAIL_MAX_POINTS = 2000;
  const TRAIL_MIN_MOVE   = 0.05;   // meter, sama seperti MIN_MOVE_NED di trajectory 2D
  const DEPTH_WARN_3D    = 2.5;    // meter, sama seperti DEPTH_WARN di trajectory 2D
  const POS_SCALE        = 1.0;    // 1 unit dunia = 1 meter (samakan dgn grid 8x16)

  let trailPoints  = []; 
  let trailStartXY = null;

  // Konversi NED relatif (rx=North, ry=East, depth=ke bawah) ke koordinat Three.js (Y ke atas). 
  // Konvensi ini arbitrer tapi konsisten dgn grid di scene - bukan representasi geografis yang presisi.
  function nedToWorld(rx, ry, depth) {
    return new THREE.Vector3(ry * POS_SCALE, -depth * POS_SCALE, -rx * POS_SCALE);
  }

  function depthColor3D(depth) {
    const dr = Math.min(Math.max(depth, 0) / (DEPTH_WARN_3D * 1.5), 1);
    return new THREE.Color(
      (34  + (220 - 34)  * dr) / 255,
      (211 + (50  - 211) * dr) / 255,
      (238 + (80  - 238) * dr) / 255
    );
  }

  const trailGeometry = new THREE.BufferGeometry();
  const trailMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
  const trailLine = new THREE.Line(trailGeometry, trailMaterial);
  scene.add(trailLine);

  const startMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x22c55e })
  );
  startMarker.visible = false;
  scene.add(startMarker);

  const endMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
  );
  endMarker.visible = false;
  scene.add(endMarker);

  function rebuildTrailGeometry() {
    const positions = new Float32Array(trailPoints.length * 3);
    const colors    = new Float32Array(trailPoints.length * 3);
    trailPoints.forEach((p, i) => {
      const v = nedToWorld(p.rx, p.ry, p.depth);
      positions[i * 3]     = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
      const c = depthColor3D(p.depth);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    });
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    trailGeometry.computeBoundingSphere();

    const startV = nedToWorld(trailPoints[0].rx, trailPoints[0].ry, trailPoints[0].depth);
    startMarker.position.copy(startV);
    startMarker.visible = true;

    const last = trailPoints[trailPoints.length - 1];
    const endV = nedToWorld(last.rx, last.ry, last.depth);
    endMarker.position.copy(endV);
    endMarker.visible = true;
  }

  // Dipanggil interact.js tiap siklus /telemetry. Kedalaman (dari sensor tekanan) SELALU dipakai untuk posisi vertikal model, karena itu lebih reliable daripada estimasi posisi NED di ROV tanpa DVL/GPS. Posisi horizontal (x/y) ikut jejak kalau hasPosition true - ini berlaku untuk posisi NED (Pixhawk/GPS/DVL) MAUPUN posisi DR (dead reckoning dari backend, dr_x/dr_y), sama seperti mode "PIXHAWK"/"DR" di recordTrajPoint() versi 2D. 
  // Sebelumnya parameter ini hanya true untuk NED, sehingga model 3D "diam" (tidak ikut gerak ROV) setiap kali GPS/DVL tidak tersedia, misalnya saat ROV ada di dalam kolam.
  window.updateRov3DTrail = function (x, y, depth, yawDeg, hasPosition) {
    const safeDepth = Number.isFinite(depth) ? depth : 0;

    if (hasPosition && Number.isFinite(x) && Number.isFinite(y)) {
      if (trailStartXY === null) trailStartXY = { x, y };
      const rx = x - trailStartXY.x;
      const ry = y - trailStartXY.y;

      const last = trailPoints[trailPoints.length - 1];
      if (!last || Math.hypot(rx - last.rx, ry - last.ry) >= TRAIL_MIN_MOVE) {
        trailPoints.push({ rx, ry, depth: safeDepth });
        if (trailPoints.length > TRAIL_MAX_POINTS) trailPoints.shift();
      }
    }

    const lastPt = trailPoints[trailPoints.length - 1];
    rov.position.copy(nedToWorld(lastPt ? lastPt.rx : 0, lastPt ? lastPt.ry : 0, safeDepth));

    if (trailPoints.length >= 2) rebuildTrailGeometry();
  };

  // Dipanggil dari tombol "CLR" di panel trajectory 2D (interact.js) supaya jejak 3D ikut bersih bareng peta 2D-nya.
  window.clearRov3DTrail = function () {
    trailPoints = [];
    trailStartXY = null;
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    trailGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
    startMarker.visible = false;
    endMarker.visible = false;
    rov.position.set(0, 0, 0);
  };

  function fitModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.scale.setScalar(2.4 / maxDim);
  }

  const loader = new GLTFLoader();
  loader.load(
    MODEL_URL,
    (gltf) => {
      rov.add(gltf.scene);
      fitModel(gltf.scene);
    },
    undefined,
    (err) => {
      console.error('[ROV3D] Gagal memuat model GLB dari', MODEL_URL, err);
      const warn = document.createElement('div');
      warn.className = 'rov-viewport-error';
      warn.textContent = 'Model 3D gagal dimuat — cek backend.py & /models/assembly_rov_80.glb';
      warn.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'padding:12px;text-align:center;color:#f87171;font-size:11px;background:rgba(7,17,27,.85);';
      container.appendChild(warn);
    }
  );

  // ===== ORIENTASI: smoothing quaternion (bukan snap tiap update) =====
  // Data Pixhawk cuma update tiap 100ms. Kalau rotasi di-set langsung, model kelihatan patah-patah. Jadi tiap frame render (requestAnimationFrame) kita slerp sedikit demi sedikit menuju target terbaru.
  const targetQuat = new THREE.Quaternion();
  const tmpEuler = new THREE.Euler();
  let hasTarget = false;
  const ROT_SMOOTH_RATE = 10; // per detik - makin besar makin responsif

  window.updateRovOrientation = function (rollDeg, pitchDeg, yawDeg, depthM, linkOk) {
    tmpEuler.set(
      THREE.MathUtils.degToRad(pitchDeg || 0),
      THREE.MathUtils.degToRad(yawDeg   || 0),
      THREE.MathUtils.degToRad(rollDeg  || 0),
      'XYZ'
    );
    targetQuat.setFromEuler(tmpEuler);

    if (!hasTarget) {
      rov.quaternion.copy(targetQuat);
      hasTarget = true;
    }

    if (depthEl) depthEl.textContent = `${(depthM || 0).toFixed(2)} m`;
    if (linkEl) {
      linkEl.classList.toggle('live', !!linkOk);
      linkEl.innerHTML = linkOk
        ? '<i class="fa-solid fa-satellite-dish"></i> LIVE'
        : '<i class="fa-solid fa-satellite-dish"></i> NO LINK';
    }
  };

  // ===== RESIZE (mengikuti ukuran panel, bukan window) =====
  function resize() {
    const w = container.clientWidth  || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // ===== RENDER LOOP =====
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    if (hasTarget) {
      const alpha = 1 - Math.exp(-ROT_SMOOTH_RATE * dt);
      rov.quaternion.slerp(targetQuat, alpha);
    }

    // Target orbit mengikuti posisi ROV secara halus, supaya model tetap kelihatan walau jejaknya sudah menjauh dari titik start.
    controls.target.lerp(rov.position, Math.min(1, dt * 2));

    controls.update();
    renderer.render(scene, camera);
  }
  animate();
}