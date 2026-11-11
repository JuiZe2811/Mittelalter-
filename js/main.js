import * as THREE from 'three';
import { VERSION } from './version.js?v=3';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makePanel, panelBg, roundRect } from './util.js?v=3';
import { SFX, ensureAudio, setListener, setVolumes, setAudioPaused } from './sfx.js?v=3';
import { addDynamic, removeDynamic, localBoxOf, stepPhysics, dynamics } from './physics.js?v=3';
import { room, addWall, addBox, makeWall, makeBox, rotateBox, removeSurface, clearRoom, setEditMode, suggestYaw, surfacesOf, importDetectedPlanes, saveRoom, loadRoom, hasSavedRoom, surfaceName, serializeRoom, deserializeRoom, roomSlots, saveRoomSlot, loadRoomSlot, addOpening, makeOpening, roomOccluders, setAtmosphere, closeRoomGaps, closeRoom, openWallEnds } from './room.js?v=3';
import { initEffects, headRef, floatingText, updateEffects, addDebris, updateDebris, fx, clearDebris, puff } from './effects.js?v=3';
const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // schneller als Math.hypot und ohne Speicher-Müll

// =============================================================================
// Grundgerüst – Burg-Abwehr (Neuanfang)
// Enthalten: Raum-Einrichtung (Wände, Türen, Fenster, Möbel, Bodenhöhe, Räume speichern/laden,
// Ausrichten, Quest-Raum), Physik, Greifen & Werfen, Menü, Einstellungen, Pause.
// Waffen, Gegner, Tränke, Shop usw. kommen neu dazu.
// =============================================================================
const HOLD_OFFSET = new THREE.Matrix4().makeTranslation(0, -0.045, 0.015); // Handmitte relativ zum Controller
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0); // transparent -> Passthrough sichtbar
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

let paused = false; // Pause-Menü (siehe setPaused)
const scene = new THREE.Scene();
scene.matrixWorldAutoUpdate = false; // Leistung: Matrizen werden einmal pro Bild in frameInner aktualisiert
const desktopBackground = new THREE.Color(0x30343c);
scene.background = desktopBackground;
const envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;
scene.add(room.group);
initEffects(scene);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(0, 1.6, 0);
scene.add(camera);
const hemi = new THREE.HemisphereLight(0xffffff, 0x666677, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(1, 3, 2);
scene.add(sun, sun.target);
// Echte Schatten auf den echten Boden (unsichtbarer "Schattenfänger")
let shadowFrame = 0;
let shadowsOn = (() => { try { return localStorage.getItem('vrspiel-schatten') !== 'false'; } catch { return true; } })();
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4.5, right: 4.5, top: 4.5, bottom: -4.5, near: 0.5, far: 14 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
sun.castShadow = shadowsOn;
const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }));
shadowFloor.rotation.x = -Math.PI / 2;
shadowFloor.position.y = 0.002;
shadowFloor.receiveShadow = true;
shadowFloor.renderOrder = -5;
shadowFloor.visible = shadowsOn;
scene.add(shadowFloor);
function setShadows(on) {
  shadowsOn = on;
  sun.castShadow = on;
  shadowFloor.visible = on;
  try { localStorage.setItem('vrspiel-schatten', String(on)); } catch { /* ignorieren */ }
}
const castShadows = (o) => o.traverse(m => { if (m.isMesh && !m.material.transparent) m.castShadow = true; });
const desktopFloor = new THREE.GridHelper(40, 40, 0x666666, 0x444444);
scene.add(desktopFloor);

document.body.appendChild(ARButton.createButton(renderer, { optionalFeatures: ['local-floor', 'plane-detection'] }));
const statusEl = document.getElementById('status');
document.getElementById('info').insertAdjacentHTML('beforeend', `<br /><span style="opacity:.7">Version ${VERSION}</span>`);
const crosshairEl = document.getElementById('crosshair');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('pointerdown', ensureAudio);
document.addEventListener('keydown', ensureAudio);

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const raycaster = new THREE.Raycaster();
const headPos = headRef; // aktuelle Kopfposition (von effects.js mitbenutzt)
let elapsed = 0;
const getViewCamera = () => (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
function headYaw() {
  getViewCamera().getWorldDirection(tmpV);
  return Math.atan2(-tmpV.x, -tmpV.z);
}
// Punkt vor dem Spieler (Winkel positiv = nach links)
function inFront(dist, angle, height, yaw = headYaw()) {
  const a = yaw + angle;
  return new THREE.Vector3(headPos.x - Math.sin(a) * dist, height, headPos.z - Math.cos(a) * dist);
}
// Wie weit ist es in einer Richtung bis zur nächsten echten Wand/Möbel?
function freeDistance(from, dir, max) {
  raycaster.set(from, dir.clone().normalize());
  raycaster.far = max;
  const hit = raycaster.intersectObjects(roomOccluders(), false)[0];
  return hit ? hit.distance : max;
}
const timers = [];
const later = (sec, fn) => timers.push({ t: sec, fn });

// =============================================================================
// Controller / Hände
// =============================================================================
const tipGeo = new THREE.SphereGeometry(0.008, 10, 8);
const hands = [0, 1].map(i => {
  const ray = renderer.xr.getController(i);
  scene.add(ray);
  const h = {
    i, ray, src: null, handedness: i === 0 ? 'left' : 'right', btn: {}, prev: {}, stickX: 0, stickY: 0,
    held: null, hist: [], vel: new THREE.Vector3(), angVel: new THREE.Vector3(),
    point: new THREE.Vector3(), tip: new THREE.Vector3(), quat: new THREE.Quaternion(), uiHover: null, pull: null
  };
  ray.addEventListener('connected', (e) => { h.src = e.data; h.handedness = e.data.handedness; });
  ray.addEventListener('disconnected', () => { releaseHand(h); h.src = null; });
  const ptr = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  ptr.visible = false;
  ray.add(ptr);
  h.pointer = ptr;
  // Markierung der Controller-Spitze (zum Einstellen der Bodenhöhe)
  const tip = new THREE.Mesh(tipGeo, new THREE.MeshBasicMaterial({ color: 0xffee00, toneMapped: false }));
  tip.visible = false;
  ray.add(tip);
  h.tipMarker = tip;
  return h;
});
const BTN = { trigger: 0, squeeze: 1, stick: 3, a: 4, b: 5 };
const handPoint = (h, out) => out.setFromMatrixPosition(tmpM.multiplyMatrices(h.ray.matrixWorld, HOLD_OFFSET));
function readInputs() {
  for (const h of hands) {
    h.prev = h.btn;
    h.btn = {};
    const gp = h.src && h.src.gamepad;
    for (const [k, idx] of Object.entries(BTN)) h.btn[k] = !!(gp && gp.buttons[idx] && gp.buttons[idx].pressed);
    h.stickX = gp && gp.axes.length > 3 ? gp.axes[2] : 0;
    h.stickY = gp && gp.axes.length > 3 ? gp.axes[3] : 0;
    handPoint(h, h.point);
    h.tip.setFromMatrixPosition(h.ray.matrixWorld);
    h.ray.getWorldQuaternion(h.quat);
    // Geschwindigkeit + Drehgeschwindigkeit (für Würfe)
    h.hist.push({ p: h.point.clone(), q: h.quat.clone(), t: elapsed });
    while (h.hist.length > 2 && elapsed - h.hist[0].t > 0.08) h.hist.shift();
    const a = h.hist[0], b = h.hist[h.hist.length - 1], dt = b.t - a.t;
    if (dt > 0.001) {
      h.vel.copy(b.p).sub(a.p).divideScalar(dt);
      const dq = b.q.clone().multiply(a.q.clone().invert());
      if (dq.w < 0) { dq.x *= -1; dq.y *= -1; dq.z *= -1; dq.w *= -1; }
      const angle = 2 * Math.acos(Math.min(1, dq.w)), s = Math.sqrt(1 - dq.w * dq.w);
      if (s > 1e-4) h.angVel.set(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt);
      else h.angVel.set(0, 0, 0);
    }
  }
}
const down = (h, k) => h.btn[k] && !h.prev[k];
const up = (h, k) => !h.btn[k] && h.prev[k];
function pulse(h, intensity, ms) {
  const act = h && h.src && h.src.gamepad && h.src.gamepad.hapticActuators && h.src.gamepad.hapticActuators[0];
  if (act && act.pulse && settings.haptics > 0) act.pulse(Math.min(1, intensity * settings.haptics), ms);
}
const isFree = (h) => !h.held && !h.pull;
// Hand (Controller) als Drehung um die Hochachse
function handYaw(h) {
  tmpV.set(0, 0, -1).applyQuaternion(h.quat);
  return Math.atan2(-tmpV.x, -tmpV.z);
}

// =============================================================================
// Physik-Gegenstände: greifen, halten, werfen (Grundlage für spätere Waffen & Dinge)
// =============================================================================
const props = []; // { obj, mass, phys, holder }
const crateTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#8a5a2b'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#7a4e24' : '#94632f'; g.fillRect(0, i * 32, 128, 30); }
  g.strokeStyle = '#4a2e12'; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118);
  g.beginPath(); g.moveTo(8, 8); g.lineTo(120, 120); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
// Holzkiste zum Testen der Physik
function spawnCrate(pos, size = 0.25) {
  const obj = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85 }));
  obj.position.copy(pos);
  obj.rotation.y = Math.random() * Math.PI;
  castShadows(obj);
  scene.add(obj);
  const p = { obj, mass: 1.5, phys: null, holder: null };
  makeLoose(p);
  props.push(p);
  return p;
}
function makeLoose(p, vel = null, angVel = null) {
  if (p.obj.parent !== scene) scene.attach(p.obj);
  p.holder = null;
  p.phys = addDynamic(p.obj, localBoxOf(p.obj), p.mass, {
    vel, angVel,
    onImpact: (v) => SFX.thunk && SFX.thunk(Math.min(1, v / 6)),
    onLost: () => { removeDynamic(p.phys); p.phys = null; p.obj.position.set(headPos.x, 1.2, headPos.z - 0.5); makeLoose(p); }
  });
}
function grabProp(p, h) {
  if (p.holder) releaseHand(p.holder);
  if (p.phys) { removeDynamic(p.phys); p.phys = null; }
  h.ray.attach(p.obj);
  p.holder = h;
  h.held = { type: 'prop', p };
  SFX.grab();
  pulse(h, 0.4, 30);
}
function clearProps() {
  for (const p of props.splice(0)) {
    if (p.holder) p.holder.held = null;
    if (p.phys) removeDynamic(p.phys);
    if (p.obj.parent) p.obj.parent.remove(p.obj);
    p.obj.geometry.dispose();
  }
}
function grabCandidates(h) {
  const list = [];
  for (const p of props) {
    if (p.holder) continue;
    const d = new THREE.Box3().setFromObject(p.obj).distanceToPoint(h.point);
    if (d < 0.06) list.push({ d, p });
  }
  return list.sort((a, b) => a.d - b.d);
}
function releaseHand(h) {
  h.pull = null;
  const held = h.held;
  if (!held) return;
  h.held = null;
  if (held.type === 'prop') {
    const p = held.p;
    // Wurf: Handgeschwindigkeit + Drehung mitgeben
    makeLoose(p, h.vel.clone().multiplyScalar(1.1), h.angVel.clone());
    return;
  }
  const obj = held.obj;
  obj.updateWorldMatrix(true, false);
  obj.matrixWorld.decompose(obj.position, obj.quaternion, tmpS);
  h.ray.remove(obj);
  addDebris(obj, h.vel.clone(), 4);
}

// Zeigestrahl: UI-Knöpfe und entfernte Gegenstände (Heranziehen mit Griff-Taste)
function pointerTarget(h) {
  h.ray.getWorldPosition(tmpV);
  raycaster.set(tmpV, tmpV3.set(0, 0, -1).applyQuaternion(h.quat));
  raycaster.far = 6;
  let best = null;
  // Menüs zählen nur, wenn ein Knopf getroffen wird – sonst geht der Laser durch
  for (const ph of raycaster.intersectObjects(uiPanels.filter(p => p.mesh.visible).map(p => p.mesh), false)) {
    if (ph.object.userData.ui.buttonAt(ph.uv)) { best = { kind: 'ui', dist: ph.distance, panel: ph.object.userData.ui, uv: ph.uv }; break; }
  }
  for (const p of props) {
    if (p.holder) continue;
    const box = new THREE.Box3().setFromObject(p.obj).expandByScalar(0.03);
    const hit = raycaster.ray.intersectBox(box, tmpV2);
    if (hit) { const d = hit.distanceTo(tmpV); if (d < 4 && (!best || d < best.dist)) best = { kind: 'prop', p, dist: d }; }
  }
  return best;
}

function updateHandsXR(dt) {
  for (const h of hands) {
    if (!h.src) { h.pointer.visible = false; continue; }
    h.tipMarker.visible = state === 'setup' && setup.tool === 'floor';
    const free = isFree(h);
    // Zeigestrahl (im Einrichtungsmodus als Laser bis zum Boden / zur Wand)
    let pt = null;
    if (free && !(setup.drag && setup.drag.src === h)) pt = pointerTarget(h);
    let len = pt ? pt.dist : 2;
    const showPtr = free && (pt || state !== 'playing');
    if (state === 'setup' && free && !pt && setup.tool && setup.tool !== 'floor') {
      if (setup.tool === 'door' || setup.tool === 'window') {
        const wh = setup.drag && setup.drag.src === h ? wallHit(rayOf(h), setup.drag.wall) : wallHit(rayOf(h));
        len = wh ? wh.point.distanceTo(h.tip) : 4;
      } else {
        const fh = floorHit(rayOf(h));
        len = fh ? fh.distanceTo(h.tip) : 4;
      }
    }
    h.pointer.visible = !!showPtr;
    h.pointer.scale.z = len;
    const hover = pt && pt.kind === 'ui' ? pt.panel.buttonAt(pt.uv) : null;
    if (h.uiHover !== hover) { if (h.uiHover) h.uiHover.panel.setHover(null); h.uiHover = hover; if (hover) { hover.panel.setHover(hover); pulse(h, 0.1, 10); } }

    // Griff-Taste: greifen
    if (down(h, 'squeeze') && !free && settings.grip === 'toggle' && h.held) releaseHand(h); // Umschalten: nochmal drücken = loslassen
    else if (down(h, 'squeeze') && free && !(state === 'setup' && setup.align)) {
      const c = grabCandidates(h)[0];
      if (c) grabProp(c.p, h);
      else if (pt && pt.kind === 'prop' && pt.dist > 0.4) h.pull = pt; // aus der Ferne heranziehen
    }
    if (h.pull) {
      const p = h.pull.p;
      if (p.holder) h.pull = null;
      else {
        const o = p.obj;
        if (p.phys) { const b = p.phys.body; b.wakeUp(); b.velocity.set(0, 0, 0); const k = Math.min(1, dt * 10); b.position.x += (h.point.x - o.position.x) * k; b.position.y += (h.point.y - o.position.y) * k; b.position.z += (h.point.z - o.position.z) * k; }
        else o.position.lerp(h.point, Math.min(1, dt * 10));
        if (o.position.distanceTo(h.point) < 0.2) { h.pull = null; grabProp(p, h); }
      }
    }
    if (up(h, 'squeeze') && !(settings.grip === 'toggle' && h.held)) releaseHand(h);

    // Abzug: UI klicken bzw. Raum-Werkzeug
    if (free && down(h, 'trigger')) {
      if (hover) { hover.onClick(); SFX.ui(); pulse(h, 0.3, 20); }
      else if (state === 'setup') setupTriggerDown(h);
    }
    if (setup.drag && setup.drag.src === h && !h.btn.trigger) setupTriggerUp();
  }
}

// =============================================================================
// Stimmung: flackerndes Licht im Flur hinter Türen, Blitze + Donner vor den Fenstern, Staub
// =============================================================================
let flickerT = 0, doorK = 0.2, lightningT = 8, lightningSeq = 0, windowK = 0;
function updateAtmosphere(dt) {
  flickerT -= dt;
  if (flickerT <= 0) { flickerT = Math.random() * 0.15; doorK = Math.random() < 0.12 ? 0 : 0.25 + Math.random() * 0.5; }
  if (surfacesOf('window').length) {
    lightningT -= dt;
    if (lightningT <= 0) { lightningT = THREE.MathUtils.randFloat(12, 28); lightningSeq = 0.6; later(THREE.MathUtils.randFloat(0.6, 2.2), () => SFX.thunder()); }
  }
  if (lightningSeq > 0) { lightningSeq -= dt; windowK = Math.sin(lightningSeq * 40) > 0.3 ? 1 : 0.15; } else windowK = 0;
  setAtmosphere(doorK, windowK);
}
// Schwebende Staubteilchen im Raum (sehr günstig: ein einziges Points-Objekt)
const DUST_N = 260;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_N * 3);
for (let i = 0; i < DUST_N; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 8; dustPos[i * 3 + 1] = Math.random() * 2.6; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 8; }
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.012, color: 0xd8cfb8, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, map: (() => { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 16, 16); return new THREE.CanvasTexture(c); })() }));
dust.frustumCulled = false;
scene.add(dust);
function updateDust(dt) {
  const a = dustGeo.attributes.position.array;
  for (let i = 0; i < DUST_N; i++) {
    const k = i * 3;
    a[k] += Math.sin(elapsed * 0.3 + i) * dt * 0.02;
    a[k + 1] += (Math.sin(elapsed * 0.2 + i * 1.7) * 0.5 - 0.15) * dt * 0.03;
    a[k + 2] += Math.cos(elapsed * 0.25 + i * 0.7) * dt * 0.02;
    // um den Spieler herum halten
    if (a[k] - headPos.x > 4) a[k] -= 8; else if (a[k] - headPos.x < -4) a[k] += 8;
    if (a[k + 2] - headPos.z > 4) a[k + 2] -= 8; else if (a[k + 2] - headPos.z < -4) a[k + 2] += 8;
    if (a[k + 1] < 0) a[k + 1] += 2.6; else if (a[k + 1] > 2.6) a[k + 1] -= 2.6;
  }
  dustGeo.attributes.position.needsUpdate = true;
}

// =============================================================================
// Leistung: Profile + bei Rucklern automatisch Details reduzieren
// =============================================================================
const QUALITY = {
  quality: { scale: 1.0, fov: 0.5, shadowEvery: 1, shadowMap: 1024, soft: true, env: true },
  balanced: { scale: 0.9, fov: 1, shadowEvery: 2, shadowMap: 1024, soft: false, env: false },
  fast: { scale: 0.75, fov: 1, shadowEvery: 3, shadowMap: 512, soft: false, env: false }
};
const Q = () => QUALITY[settings.quality] || QUALITY.balanced;
function applyQuality() {
  const q = Q();
  if (sun.shadow.mapSize.x !== q.shadowMap) { sun.shadow.mapSize.set(q.shadowMap, q.shadowMap); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  if (!renderer.xr.isPresenting) renderer.xr.setFramebufferScaleFactor(q.scale); // wirkt beim nächsten VR-Start
  try { renderer.xr.setFoveation(q.fov); } catch { /* nicht unterstützt */ }
  const type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  const env = q.env ? envTex : null;
  if (renderer.shadowMap.type !== type || scene.environment !== env) {
    renderer.shadowMap.type = type;
    scene.environment = env;
    hemi.intensity = q.env ? 1.2 : 1.55; // ohne Spiegelungen etwas mehr Grundlicht
    scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.needsUpdate = true; }); });
  }
}
const perf = { ema: 0, slowT: 0, level: 0, okT: 0, lowHz: false };
// Bildrate der Brille (Quest: 72/90/120 Hz)
function applyFrameRate() {
  const session = renderer.xr.getSession && renderer.xr.getSession();
  if (!session || !session.updateTargetFrameRate || !session.supportedFrameRates) return;
  const rates = [...session.supportedFrameRates].sort((a, b) => a - b);
  const want = settings.frameRate > 72 && perf.lowHz ? 72 : settings.frameRate;
  const best = rates.filter(r => r <= want + 0.5).pop() || rates[0];
  if (best && Math.abs((session.frameRate || 0) - best) > 0.5) session.updateTargetFrameRate(best).catch(() => {});
}
// Automatisch flüssig halten – nur vorübergehend: erst 72 Hz, dann Staub, dann Schatten, dann Partikel
function autoPerf(raw) {
  if (!settings.autoPerf || !renderer.xr.isPresenting || raw <= 0 || raw > 0.5) return;
  const session = renderer.xr.getSession();
  const target = 1 / ((session && session.frameRate) || 72);
  perf.ema += (raw - perf.ema) * 0.05;
  if (perf.ema > target * 1.3) { perf.slowT += raw; perf.okT = 0; } else { perf.slowT = Math.max(0, perf.slowT - raw); perf.okT += raw; }
  if (perf.slowT > 2.5) {
    perf.slowT = 0;
    perf.ema = target;
    if (!perf.lowHz && session && (session.frameRate || 72) > 73) { perf.lowHz = true; applyFrameRate(); return; }
    if (perf.level >= 3) return;
    perf.level++;
    applyPerfLevel();
  } else if (perf.okT > 25 && perf.level > 0) {
    perf.okT = 0;
    perf.level--;
    applyPerfLevel();
  }
}
function applyPerfLevel() {
  const L = perf.level;
  dust.visible = settings.dust && L < 1;
  fx.particles = L >= 3 ? Math.min(settings.particles, 0.4) : L >= 1 ? Math.min(settings.particles, 0.6) : settings.particles;
  const sh = settings.shadows && L < 2;
  sun.castShadow = sh; shadowFloor.visible = sh; shadowsOn = sh; // nicht gespeichert
}

// =============================================================================
// Einstellungen (alle an einem Ort, gespeichert als ein Eintrag) + Ansager
// =============================================================================
const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignorieren */ } };
const ten = (lbl = (v) => (v === 0 ? 'Aus' : v * 10 + ' %')) => Array.from({ length: 11 }, (_, i) => [i, lbl(i)]);
const onOff = [[true, 'An'], [false, 'Aus']];
const SETTINGS_TABS = {
  ton: { label: '🔊 Ton', items: [
    { key: 'master', label: 'Gesamtlautstärke', opts: ten() },
    { key: 'sfx', label: 'Effekte', opts: ten() },
    { key: 'music', label: 'Musik', opts: ten() },
    { key: 'voices', label: 'Stimmen', opts: ten() },
    { key: 'announcer', label: 'Ansager', opts: ten() },
    { key: 'announcerVoice', label: 'Ansager-Stimme', opts: [['demon', 'Dämon'], ['deep', 'Tief'], ['normal', 'Normal'], ['high', 'Hoch']] }
  ] },
  bedienung: { label: '✊ Bedienung', items: [
    { key: 'grip', label: 'Griff-Taste', opts: [['hold', 'Halten'], ['toggle', 'Tippen']] },
    { key: 'haptics', label: 'Vibration', opts: [[0, 'Aus'], [0.5, 'Schwach'], [1, 'Normal'], [1.5, 'Stark']] },
    { key: 'popups', label: 'Text-Einblendungen', opts: onOff }
  ] },
  grafik: { label: '✨ Grafik', items: [
    { key: 'quality', label: 'Leistung', opts: [['quality', 'Schön'], ['balanced', 'Ausgewogen'], ['fast', 'Flüssig']] },
    { key: 'shadows', label: 'Echte Schatten', opts: onOff },
    { key: 'particles', label: 'Partikel', opts: [[0.5, 'Wenig'], [1, 'Normal'], [1.6, 'Viel']] },
    { key: 'dust', label: 'Staub in der Luft', opts: onOff },
    { key: 'frameRate', label: 'Bildrate (Brille)', opts: [[72, '72 Hz'], [90, '90 Hz'], [120, '120 Hz']] },
    { key: 'autoPerf', label: 'Automatisch flüssig halten', opts: onOff }
  ] }
};
const SETTINGS_DEFAULT = {
  master: 9, sfx: 10, music: 6, voices: 10, announcer: 10, announcerVoice: 'deep',
  grip: 'hold', haptics: 1, popups: true,
  quality: 'balanced', shadows: true, particles: 1, dust: true, frameRate: 90, autoPerf: true
};
const settings = Object.assign({}, SETTINGS_DEFAULT, { shadows: shadowsOn }, load('burg-einstellungen', {}));
let voiceOn = settings.announcer > 0;
function applySettings() {
  setVolumes({ master: settings.master / 10, sfx: settings.sfx / 10, music: settings.music / 10, voices: settings.voices / 10 });
  voiceOn = settings.announcer > 0;
  fx.particles = settings.particles;
  fx.popups = settings.popups;
  if (shadowsOn !== settings.shadows) setShadows(settings.shadows);
  dust.visible = settings.dust;
  applyQuality();
  perf.level = 0; perf.lowHz = false;
  if (renderer.xr.isPresenting) applyFrameRate();
}
function setSetting(k, v) {
  settings[k] = v;
  store('burg-einstellungen', settings);
  applySettings();
  refreshMenu();
}
function speak(textStr) {
  if (!voiceOn || !window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(textStr);
    u.lang = 'de-DE';
    u.pitch = { demon: 0.05, deep: 0.55, normal: 1, high: 1.45 }[settings.announcerVoice] ?? 0.55;
    u.rate = settings.announcerVoice === 'demon' ? 0.82 : 0.95;
    u.volume = settings.announcer / 10;
    const v = speechSynthesis.getVoices().find(x => x.lang && x.lang.startsWith('de'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* keine Sprachausgabe */ }
}

// =============================================================================
// Bedienfelder mit Knöpfen (Zeigen + Abzug, am PC: Klick)
// =============================================================================
const uiPanels = [];
class UIPanel {
  constructor(w, h, ppm = 700) {
    this.p = makePanel(w, h, ppm);
    this.mesh = this.p.mesh;
    this.mesh.userData.ui = this;
    this.mesh.renderOrder = 5;
    this.buttons = [];
    this.hover = null;
    this.border = '#ffcc33';
    this.anchor = new THREE.Vector3();
    scene.add(this.mesh);
    uiPanels.push(this);
  }
  set(drawFn, buttons = []) {
    this.drawFn = drawFn;
    this.buttons = buttons.map(b => ({ ...b, panel: this }));
    this.hover = null;
    this.redraw();
  }
  setHover(b) { if (this.hover !== b) { this.hover = b; this.redraw(); } }
  buttonAt(uv) {
    if (!uv) return null;
    const x = uv.x * this.p.canvas.width, y = (1 - uv.y) * this.p.canvas.height;
    return this.buttons.find(b => !b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) || null;
  }
  redraw() {
    this.p.draw((ctx, w, h) => {
      panelBg(ctx, w, h, 30, this.border);
      if (this.drawFn) this.drawFn(ctx, w, h);
      for (const b of this.buttons) {
        const hov = this.hover && this.hover.id === b.id;
        roundRect(ctx, b.x, b.y, b.w, b.h, 16);
        ctx.fillStyle = b.disabled ? 'rgba(60,64,72,0.6)' : b.active ? '#2f8a50' : hov ? '#56657d' : '#2c3444';
        ctx.fill();
        ctx.lineWidth = hov ? 5 : 2;
        ctx.strokeStyle = b.active ? '#7dffa8' : hov ? '#ffffff' : '#8796ad';
        ctx.stroke();
        ctx.fillStyle = b.disabled ? '#8a8f99' : '#fff';
        ctx.font = `bold ${b.font || 32}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
      }
    });
  }
  place(dist, angle, dy) {
    this.mesh.position.copy(inFront(dist, angle, headPos.y + dy));
    this.mesh.lookAt(headPos);
    this.anchor.copy(headPos);
  }
  get visible() { return this.mesh.visible; }
  set visible(v) { this.mesh.visible = v; }
}
function text(ctx, str, x, y, size, color = '#fff', align = 'center', bold = false) {
  ctx.font = `${bold ? 'bold ' : ''}${size}px system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}
// Knöpfe in einer Reihe verteilen
function row(y, h, labels, W, pad = 30, gap = 18) {
  const bw = (W - pad * 2 - gap * (labels.length - 1)) / labels.length;
  return labels.map((b, i) => ({ ...b, x: pad + i * (bw + gap), y, w: bw, h }));
}

const setupPanel = new UIPanel(1.0, 0.84, 760);
setupPanel.border = '#3a8bff';
const menuPanel = new UIPanel(1.1, 0.95, 720);
setupPanel.visible = menuPanel.visible = false;

// =============================================================================
// Raum einrichten – alles per Laser (wie die Begrenzung der Quest):
// Wände und Möbel auf dem Boden aufziehen, Türen/Fenster einzeichnen, Bodenhöhe einstellen
// =============================================================================
const setup = { view: 'main', align: null, hoverS: null, confirm: -1, tool: null, drag: null, pending: null, last: null, msg: '', rotT: 0, planeSupport: false, importReq: false, autoImport: 0, refT: 0 };
const previewMat = new THREE.MeshBasicMaterial({ color: 0xffee00, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
const previewWall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), previewMat);
const previewBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previewMat);
const previewLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineBasicMaterial({ color: 0xffee00 }));
previewWall.visible = previewBox.visible = previewLine.visible = false;
scene.add(previewWall, previewBox, previewLine);
// Laserpunkt auf dem Boden (pro Hand + Maus)
const markerGeo = new THREE.RingGeometry(0.035, 0.05, 32).rotateX(-Math.PI / 2);
const makeMarker = () => { const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xffee00, toneMapped: false, depthTest: false, transparent: true })); m.renderOrder = 30; m.visible = false; scene.add(m); return m; };
for (const h of hands) h.floorMarker = makeMarker();
const mouseMarker = makeMarker();
// Gitter zum Einstellen der Bodenhöhe
const floorGrid = new THREE.GridHelper(4, 16, 0x00ffcc, 0x00ffcc);
floorGrid.material.transparent = true;
floorGrid.material.opacity = 0.7;
floorGrid.visible = false;
scene.add(floorGrid);

// Bodenhöhe: verschiebt das Koordinatensystem der VR-Sitzung, bis y = 0 auf dem echten Boden liegt
const FLOOR_KEY = 'vrspiel-boden';
let floorOffset = (() => { try { return parseFloat(localStorage.getItem(FLOOR_KEY) || '0') || 0; } catch { return 0; } })();
let baseRefSpace = null;
function applyFloorOffset() {
  if (!baseRefSpace || typeof XRRigidTransform === 'undefined') return;
  renderer.xr.setReferenceSpace(baseRefSpace.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: floorOffset, z: 0 })));
  try { localStorage.setItem(FLOOR_KEY, String(floorOffset)); } catch { /* ignorieren */ }
}

const TOOL_HELP = {
  wall: ['WAND: Laser auf den Boden an einer Ecke der Wand richten,', 'Abzug halten, an der Wand entlang zur anderen Ecke fahren, loslassen.'],
  table: ['TISCH: Grundfläche mit dem Laser auf dem Boden aufziehen (Ecke zu Ecke),', 'dann mit dem Laser auf die Tischkante zeigen = Höhe, Abzug = fertig.'],
  chair: ['STUHL: Grundfläche mit dem Laser auf dem Boden aufziehen,', 'dann auf die Sitzfläche zeigen = Höhe, Abzug = fertig.'],
  door: ['TÜR: Laser oben an eine Türecke auf der Wand, Abzug halten,', 'zur anderen Ecke ziehen, loslassen. Unten = automatisch Boden.'],
  window: ['FENSTER: Laser an eine Fensterecke auf der Wand, Abzug halten,', 'zur gegenüberliegenden Ecke ziehen, loslassen.'],
  erase: ['LÖSCHEN: Mit dem Laser auf eine Fläche zeigen (wird rot),', 'Abzug = diese Fläche entfernen.'],
  align: ['AUSRICHTEN: GRIFF-TASTE HALTEN = Karte anfassen und mit der Hand hinschieben/drehen.', 'Fein: linker Stick schieben, rechter Stick drehen · Laser-Linie an echter Wand = einrasten.'],
  floor: ['BODENHÖHE: Controller auf den Boden legen und Abzug drücken, dann mit', 'Stick ▲▼ fein einstellen, bis das Gitter genau auf dem echten Boden liegt.']
};
function refreshSetupPanel() {
  const count = (t) => surfacesOf(t).length;
  const pend = setup.pending;
  if (setup.view === 'rooms') { refreshRoomsPanel(); return; }
  setupPanel.set((ctx, w) => {
    text(ctx, '🧱 Spielbereich einrichten', w / 2, 40, 40, '#fff', 'center', true);
    const help = pend && pend.type === 'window' ? [`Laser auf die ${pend.stage === 'bottom' ? 'UNTERKANTE' : 'OBERKANTE'} des Fensters zeigen (${(pend.stage === 'bottom' ? pend.bottom : pend.top).toFixed(2)} m),`, 'Abzug = übernehmen · B/Y = abbrechen']
      : pend ? ['Mit dem Laser auf die Oberkante zeigen = Höhe (' + pend.height.toFixed(2) + ' m),', 'Abzug = übernehmen · Stick ◀ ▶ = drehen · B/Y = abbrechen']
      : setup.tool ? TOOL_HELP[setup.tool] : ['Wähle unten ein Werkzeug. Tipp: zuerst die Bodenhöhe prüfen, dann Wände,', 'Türen/Fenster und Möbel. Räume kannst du speichern.'];
    text(ctx, help[0], w / 2, 86, 20, '#cfd8e3');
    text(ctx, help[1], w / 2, 114, 20, '#cfd8e3');
    text(ctx, `Wände ${count('wall')} · Türen ${count('door')} · Fenster ${count('window')} · Tische ${count('table')} · Stühle ${count('chair')}`, w / 2, 150, 18, '#9ad', 'center', true);
    text(ctx, `Boden ${floorOffset >= 0 ? '+' : ''}${(floorOffset * 100).toFixed(1)} cm${setup.align ? ` · Drehung ${Math.round(THREE.MathUtils.radToDeg(setup.align.angle))}°` : ''}`, w / 2, 174, 18, '#9ad', 'center', true);
    if (setup.msg) text(ctx, setup.msg, w / 2, 204, 22, '#ffcc33', 'center', true);
    text(ctx, `Version ${VERSION}`, w - 22, 26, 16, '#6b8ab0', 'right');
  }, [
    ...row(226, 56, [
      { id: 'wall', label: '🧱 Wand', active: setup.tool === 'wall', onClick: () => setTool('wall') },
      { id: 'door', label: '🚪 Tür', active: setup.tool === 'door', onClick: () => setTool('door') },
      { id: 'window', label: '🪟 Fenster', active: setup.tool === 'window', onClick: () => setTool('window') }
    ], 760),
    ...row(290, 56, [
      { id: 'table', label: '🪑 Tisch', active: setup.tool === 'table', onClick: () => setTool('table') },
      { id: 'chair', label: '💺 Stuhl', active: setup.tool === 'chair', onClick: () => setTool('chair') },
      { id: 'floor', label: '📏 Boden', active: setup.tool === 'floor', onClick: () => setTool('floor') }
    ], 760),
    ...row(354, 56, [
      { id: 'quest', label: '📡 Quest-Raum', font: 23, disabled: !setup.planeSupport, onClick: () => { endAlign(); setup.importReq = true; } },
      { id: 'rooms', label: '💾 Räume …', font: 23, onClick: () => { endAlign(); setup.tool = null; setup.view = 'rooms'; setup.confirm = -1; refreshSetupPanel(); } },
      { id: 'align', label: '🧭 Ausrichten', font: 23, disabled: !room.surfaces.length, active: setup.tool === 'align', onClick: () => setTool('align') }
    ], 760, 30, 12),
    ...row(418, 56, [
      { id: 'erase', label: '✂ Löschen', font: 23, active: setup.tool === 'erase', onClick: () => setTool('erase') },
      { id: 'undo', label: '↶ Zurück', font: 23, onClick: undoSurface },
      { id: 'clear', label: '🗑 Alles', font: 23, onClick: () => { endAlign(); clearRoom(); setup.last = null; setup.pending = null; setup.msg = 'Alles gelöscht'; refreshSetupPanel(); } }
    ], 760, 30, 12),
    ...row(500, 62, [{ id: 'done', label: '✔ Fertig', font: 34, onClick: finishSetup }], 760, 160)
  ]);
}
// Speicherplätze für Räume
const SLOT_COUNT = 5;
function refreshRoomsPanel() {
  const slots = roomSlots();
  const btns = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const y = 132 + i * 72;
    btns.push({ id: 'ld' + i, label: '📂 Laden', font: 26, x: 400, y, w: 160, h: 56, disabled: !slots[i], onClick: () => loadSlot(i) });
    btns.push({ id: 'sv' + i, label: setup.confirm === i ? '⚠ Überschreiben?' : '💾 Speichern', font: setup.confirm === i ? 21 : 26, x: 574, y, w: 160, h: 56, disabled: !room.surfaces.length, onClick: () => saveSlot(i) });
  }
  btns.push({ id: 'auto', label: '↺ Letzten Raum laden', font: 25, x: 30, y: 498, w: 340, h: 56, disabled: !hasSavedRoom(), onClick: () => { const n = loadRoom(); afterRoomLoad(n, 'Letzter Raum'); } });
  btns.push({ id: 'back', label: '◀ Zurück', font: 28, x: 394, y: 498, w: 340, h: 56, onClick: () => { setup.view = 'main'; setup.confirm = -1; refreshSetupPanel(); } });
  setupPanel.set((ctx, w) => {
    text(ctx, '💾 Gespeicherte Räume', w / 2, 40, 40, '#fff', 'center', true);
    text(ctx, 'Nach dem Laden die Karte mit 🧭 Ausrichten an deine echten Wände anlegen.', w / 2, 88, 20, '#cfd8e3');
    for (let i = 0; i < SLOT_COUNT; i++) {
      const y = 160 + i * 72, sl = slots[i];
      text(ctx, `Raum ${i + 1}`, 40, y - 10, 26, '#fff', 'left', true);
      text(ctx, sl ? `${sl.count} Flächen · ${new Date(sl.date).toLocaleDateString('de-DE')} ${new Date(sl.date).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'leer', 40, y + 16, 18, sl ? '#9ad' : '#6b778a', 'left');
    }
    if (setup.msg) text(ctx, setup.msg, w / 2, 580, 22, '#ffcc33', 'center', true);
  }, btns);
}
function saveSlot(i) {
  if (roomSlots()[i] && setup.confirm !== i) { setup.confirm = i; refreshSetupPanel(); return; }
  setup.confirm = -1;
  saveRoomSlot(i);
  setup.msg = `Raum ${i + 1} gespeichert (${room.surfaces.length} Flächen)`;
  SFX.magIn();
  refreshSetupPanel();
}
function loadSlot(i) {
  const n = loadRoomSlot(i);
  afterRoomLoad(n, `Raum ${i + 1}`);
}
function afterRoomLoad(n, name) {
  setup.view = 'main';
  setup.confirm = -1;
  setup.last = null;
  saveRoom();
  SFX.magIn();
  setTool('align');
  setup.msg = `${name} geladen (${n} Flächen) – jetzt an einer echten Wand ausrichten`;
  refreshSetupPanel();
}
// ---- Ausrichten: gespeicherte Karte drehen/verschieben, bis sie auf den echten Raum passt ----
function beginAlign() {
  setup.align = { base: serializeRoom(), angle: 0, pivot: headPos.clone().setY(0), offset: new THREE.Vector3(), dirty: false, t: 0, lines: 0 };
}
function applyAlign(force = false) {
  const a = setup.align;
  if (!a || (!a.dirty && !force)) return;
  a.dirty = false;
  deserializeRoom(a.base, a.angle, a.pivot, a.offset);
  setup.hoverS = null;
}
// zusätzliche Drehung um einen Punkt c (in Weltkoordinaten) in die Transformation einrechnen
function alignRotate(delta, c) {
  const a = setup.align;
  const q = new THREE.Quaternion().setFromAxisAngle(UP, delta);
  const t = a.pivot.clone().add(a.offset).sub(c).applyQuaternion(q).add(c);
  a.offset.copy(t.sub(a.pivot));
  a.angle += delta;
  a.dirty = true;
}
function endAlign() {
  const a = setup.align;
  if (!a) return;
  applyAlign();
  setup.align = null;
  saveRoom();
}
// Linie entlang einer echten Wand gezogen → passende gespeicherte Wand darauf einrasten
function alignToLine(p0, p1) {
  const a = setup.align;
  const dir = p1.clone().sub(p0).setY(0);
  const len = dir.length();
  if (len < 0.4) return 'Linie zu kurz – mindestens 40 cm an der Wand entlang ziehen';
  dir.normalize();
  const mid = p0.clone().add(p1).multiplyScalar(0.5).setY(0);
  const lineAng = Math.atan2(dir.z, dir.x);
  let best = null, bs = Infinity;
  for (const w of surfacesOf('wall')) {
    let dA = Math.atan2(w.right.z, w.right.x) - lineAng;
    dA = Math.atan2(Math.sin(dA), Math.cos(dA));
    if (dA > Math.PI / 2) dA -= Math.PI; else if (dA < -Math.PI / 2) dA += Math.PI; // Richtung egal
    const dist = Math.abs(mid.clone().sub(w.mid).dot(w.normal));
    const along = Math.max(0, Math.abs(mid.clone().sub(w.mid).dot(w.right)) - w.width / 2);
    // beim 2. Mal nur noch fast parallele Wände (Drehung steht schon)
    if (a.lines > 0 && Math.abs(dA) > 0.35) continue;
    const score = Math.abs(dA) * 2.5 + dist + along * 0.5;
    if (score < bs) { bs = score; best = { w, dA }; }
  }
  if (!best) return 'Keine passende Wand gefunden';
  const w = best.w;
  // erste Linie: drehen (um die Wandmitte, die bleibt dabei stehen); danach nur noch schieben
  const rot = a.lines === 0 ? best.dA : 0; // atan2-Winkel und Drehung um die Hochachse haben entgegengesetzte Vorzeichen
  if (rot) alignRotate(rot, w.mid.clone().setY(0));
  const n = w.normal.clone().applyAxisAngle(UP, rot);
  const shift = mid.clone().sub(w.mid.clone().setY(0)).dot(n);
  a.offset.addScaledVector(n, shift);
  a.dirty = true;
  a.lines++;
  applyAlign();
  return a.lines === 1 ? 'Eingerastet! Optional: Linie an einer QUER stehenden Wand ziehen' : 'Feinschliff übernommen ✔';
}
function setTool(t) {
  if (setup.tool === 'align' && t !== 'align') endAlign();
  setup.tool = setup.tool === t && t !== 'align' ? null : t;
  if (setup.tool === 'align' && !setup.align) beginAlign();
  if (setup.hoverS) { unhover(); }
  setup.pending = null;
  setup.drag = null;
  setup.msg = '';
  floorGrid.visible = setup.tool === 'floor';
  refreshSetupPanel();
}
function undoSurface() {
  if (setup.pending) { setup.pending = null; refreshSetupPanel(); return; }
  if (setup.align) { setup.align.angle = 0; setup.align.offset.set(0, 0, 0); setup.align.lines = 0; setup.align.dirty = true; applyAlign(); setup.msg = 'Ausrichtung zurückgesetzt'; refreshSetupPanel(); return; }
  const list = room.surfaces;
  if (!list.length) return;
  unhover();
  removeSurface(list[list.length - 1]);
  setup.last = null;
  setup.msg = 'Letzte Fläche entfernt';
  saveRoom();
  refreshSetupPanel();
}

// Strahl einer Hand bzw. der Maus
function rayOf(src) {
  if (src === 'mouse') { raycaster.setFromCamera(mouseNdc, camera); return { o: raycaster.ray.origin.clone(), d: raycaster.ray.direction.clone() }; }
  return { o: src.tip.clone(), d: new THREE.Vector3(0, 0, -1).applyQuaternion(src.quat) };
}
// Schnittpunkt mit dem Boden (y = 0)
function floorHit(r, maxDist = 12) {
  if (r.d.y > -0.02) return null;
  const t = -r.o.y / r.d.y;
  return t > 0 && t < maxDist ? r.o.clone().addScaledVector(r.d, t) : null;
}
// Höhe aus dem Laser: Schnitt mit senkrechter Ebene durch die Mitte (zum Spieler gedreht)
function heightFromRay(r, center, maxH = 1.6) {
  const n = new THREE.Vector3(headPos.x - center.x, 0, headPos.z - center.z);
  if (n.lengthSq() < 1e-4) return null;
  n.normalize();
  const denom = r.d.dot(n);
  if (Math.abs(denom) < 1e-3) return null;
  const t = center.clone().sub(r.o).dot(n) / denom;
  return t > 0 ? THREE.MathUtils.clamp(r.o.y + r.d.y * t, 0.15, maxH) : null;
}
// Laser trifft eine markierte Wand: Position entlang der Wand (u) und Höhe (v)
function wallHit(r, only = null) {
  let best = null;
  for (const w of only ? [only] : surfacesOf('wall')) {
    const denom = r.d.dot(w.normal);
    if (Math.abs(denom) < 1e-4) continue;
    const t = ((w.mid.x - r.o.x) * w.normal.x + (w.mid.z - r.o.z) * w.normal.z) / denom;
    if (t <= 0 || t > 15) continue;
    const p = r.o.clone().addScaledVector(r.d, t);
    let u = (p.x - w.a.x) * w.right.x + (p.z - w.a.z) * w.right.z, v = p.y;
    if (only) { u = THREE.MathUtils.clamp(u, 0, w.width); v = THREE.MathUtils.clamp(v, 0, w.height); }
    else if (u < -0.05 || u > w.width + 0.05 || v < 0 || v > w.height) continue;
    if (!best || t < best.t) best = { wall: w, u, v, t, point: w.a.clone().addScaledVector(w.right, u).setY(v) };
  }
  return best;
}
// Rechteck einer Tür/eines Fensters aus dem Ziehen auf der Wand
function openingFromDrag(d) {
  const w = d.wall;
  const u0 = Math.min(d.u0, d.u), u1 = Math.max(d.u0, d.u);
  let bottom, top;
  if (setup.tool === 'door') { bottom = 0; top = THREE.MathUtils.clamp(Math.max(d.v0, d.v), 1.6, w.height - 0.02); }
  else { bottom = Math.min(d.v0, d.v); top = Math.max(d.v0, d.v); if (top - bottom < 0.25) top = Math.min(w.height, bottom + 0.25); }
  return { a: w.a.clone().addScaledVector(w.right, u0), b: w.a.clone().addScaledVector(w.right, u1), inside: w.mid.clone().add(w.normal), bottom, top, width: u1 - u0 };
}
const boxWithHeight = (p) => makeBox(p.type, p.p1.clone().setY(p.height), p.p2.clone().setY(p.height), p.yaw);

// ---- Hilfen: Wand-Ecken einrasten, Längen-Anzeige, Löschen per Laser ----
function wallEnds() {
  const pts = [];
  for (const w of surfacesOf('wall')) pts.push(w.a.clone().setY(0), w.a.clone().addScaledVector(w.right, w.width).setY(0));
  return pts;
}
function snapCorner(p, maxD = 0.4) {
  let best = null, bd = maxD;
  for (const e of wallEnds()) { const d = hyp(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } }
  return best;
}
// Endpunkt einer neuen Wand: an Ecken einrasten, sonst rechte Winkel zur nächsten Wand
function snapWallEnd(start, cur) {
  const c = snapCorner(cur);
  if (c && c.distanceTo(start) > 0.25) return { p: c, how: 'Ecke' };
  const dir = cur.clone().sub(start).setY(0);
  const len = dir.length();
  if (len < 0.3) return { p: cur, how: '' };
  let ref = null, bd = Infinity;
  for (const w of surfacesOf('wall')) { const d = start.distanceTo(w.mid.clone().setY(0)) - w.width / 2; if (d < bd) { bd = d; ref = w; } }
  if (!ref) return { p: cur, how: '' };
  const phi = Math.atan2(ref.right.z, ref.right.x);
  let rel = Math.atan2(dir.z, dir.x) - phi;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const snapped = Math.round(rel / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(rel - snapped) > 0.12) return { p: cur, how: '' };
  return { p: start.clone().add(new THREE.Vector3(Math.cos(phi + snapped), 0, Math.sin(phi + snapped)).multiplyScalar(len)), how: snapped % Math.PI === 0 ? '∥' : '90°' };
}
const lenLabel = makePanel(0.34, 0.09, 600);
lenLabel.mesh.renderOrder = 40;
lenLabel.mesh.material.depthTest = false;
lenLabel.mesh.visible = false;
scene.add(lenLabel.mesh);
let lenLabelTxt = '';
function showLenLabel(pos, str) {
  lenLabel.mesh.visible = true;
  lenLabel.mesh.position.copy(pos);
  lenLabel.mesh.lookAt(headPos);
  if (str === lenLabelTxt) return;
  lenLabelTxt = str;
  lenLabel.draw((ctx, w, h) => { roundRect(ctx, 2, 2, w - 4, h - 4, 14); ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fill(); text(ctx, str, w / 2, h / 2 + 2, 34, '#ffee66', 'center', true); });
}
function surfaceAt(r) {
  const vis = room.surfaces.map(x => x.visual).filter(Boolean);
  raycaster.set(r.o, r.d);
  raycaster.far = 15;
  const hit = raycaster.intersectObjects(vis, false)[0];
  return hit ? room.surfaces.find(x => x.visual === hit.object) : null;
}
function unhover() {
  const s0 = setup.hoverS;
  if (s0 && s0.edges && s0._ec !== undefined) { s0.edges.material.color.setHex(s0._ec); s0.visual.material.opacity = s0._eo; }
  setup.hoverS = null;
}
function hoverSurface(x) {
  if (x === setup.hoverS) return;
  unhover();
  if (!x || !x.edges) return;
  setup.hoverS = x;
  x._ec = x.edges.material.color.getHex();
  x._eo = x.visual.material.opacity;
  x.edges.material.color.setHex(0xff2a2a);
  if (x.visual.material.transparent) x.visual.material.opacity = 0.6;
}
// Abzug gedrückt (mit Laser, nicht auf ein Menü)
function setupTriggerDown(src) {
  const tool = setup.tool;
  if (setup.pending && setup.pending.type === 'window') { // Fenster: erst Unter-, dann Oberkante
    const p = setup.pending;
    if (p.stage === 'bottom') { p.stage = 'top'; p.top = Math.max(p.top, p.bottom + 0.4); refreshSetupPanel(); return; }
    setup.pending = null;
    const s = addOpening('window', p.a, p.b, headPos, p.bottom, Math.max(p.top, p.bottom + 0.2));
    if (s) { setup.last = s; setup.msg = 'Fenster hinzugefügt'; SFX.magIn(); saveRoom(); }
    refreshSetupPanel();
    return;
  }
  if (setup.pending) { // Höhe bestätigen
    const p = setup.pending;
    setup.pending = null;
    const s = addBox(p.type, p.p1.clone().setY(p.height), p.p2.clone().setY(p.height), p.yaw);
    if (s) { setup.last = s; setup.msg = `${surfaceName(s.type)} hinzugefügt (Höhe ${p.height.toFixed(2)} m)`; SFX.magIn(); saveRoom(); }
    refreshSetupPanel();
    return;
  }
  if (tool === 'floor') {
    if (src !== 'mouse') {
      floorOffset += src.tip.y - 0.035; // Controller liegt auf dem Boden: Spitze ca. 3,5 cm darüber
      applyFloorOffset();
      setup.msg = 'Bodenhöhe gesetzt – mit Stick ▲▼ fein einstellen';
      SFX.magIn();
      refreshSetupPanel();
    }
    return;
  }
  if (tool === 'erase') {
    const x = surfaceAt(rayOf(src));
    if (!x) return;
    unhover();
    if (x === setup.last) setup.last = null;
    removeSurface(x);
    setup.msg = `${surfaceName(x.type)} gelöscht`;
    SFX.click();
    saveRoom();
    refreshSetupPanel();
    return;
  }
  if (tool === 'door' || tool === 'window') {
    const wh = wallHit(rayOf(src));
    if (!wh) { setup.msg = surfacesOf('wall').length ? 'Zeige mit dem Laser auf eine markierte (blaue) Wand' : 'Zuerst Wände markieren – dann Türen/Fenster einzeichnen'; refreshSetupPanel(); return; }
    setup.drag = { src, wall: wh.wall, u0: wh.u, v0: wh.v, u: wh.u, v: wh.v };
    if (src !== 'mouse') pulse(src, 0.4, 30);
    return;
  }
  const hit = floorHit(rayOf(src));
  if (!tool || !hit) return;
  const start = tool === 'wall' ? (snapCorner(hit) || hit) : hit;
  setup.drag = { src, start, cur: start.clone() };
  if (src !== 'mouse') pulse(src, 0.4, 30);
}
function setupTriggerUp() {
  const d = setup.drag;
  setup.drag = null;
  previewWall.visible = previewLine.visible = false;
  if (!d) return;
  if (d.wall) { // Tür / Fenster in der Wand
    const o = openingFromDrag(d);
    const s = o.width >= 0.3 ? addOpening(setup.tool, o.a, o.b, o.inside, o.bottom, o.top) : null;
    if (s) { setup.last = s; setup.msg = `${surfaceName(s.type)} hinzugefügt (${o.width.toFixed(2)} × ${(o.top - o.bottom).toFixed(2)} m)`; SFX.magIn(); saveRoom(); }
    else setup.msg = 'Zu schmal – nochmal ziehen';
    refreshSetupPanel();
    return;
  }
  lenLabel.mesh.visible = false;
  const len = d.start.distanceTo(d.cur);
  if (setup.tool === 'align') {
    setup.msg = alignToLine(d.start, d.cur);
    SFX.magIn();
  } else if (setup.tool === 'wall') {
    const s = addWall(d.start, d.cur, headPos);
    if (s) {
      const fixed = closeRoomGaps(0.6); // an Nachbarwände anheften
      setup.last = surfacesOf('wall').includes(s) ? s : null;
      const open = openWallEnds();
      setup.msg = `Wand hinzugefügt${fixed ? ' · angeheftet' : ''}${open ? ` · noch ${open} offene Enden` : ' · Raum geschlossen ✔'}`;
      SFX.magIn(); saveRoom();
    } else setup.msg = 'Zu kurz – nochmal';
  } else if (setup.tool === 'door') {
    const s = addOpening('door', d.start, d.cur, headPos, 0, 2.05);
    if (s) { setup.last = s; setup.msg = 'Tür hinzugefügt'; SFX.magIn(); saveRoom(); } else setup.msg = 'Zu schmal – nochmal';
  } else if (setup.tool === 'window') {
    if (len < 0.25) setup.msg = 'Zu schmal – Breite unter dem Fenster aufziehen';
    else { setup.pending = { type: 'window', a: d.start, b: d.cur, stage: 'bottom', bottom: 0.9, top: 2.0, src: d.src }; setup.msg = ''; }
  } else if (setup.tool === 'table' || setup.tool === 'chair') {
    if (len < 0.15) setup.msg = 'Zu klein – Grundfläche von Ecke zu Ecke aufziehen';
    else {
      setup.pending = { type: setup.tool, p1: d.start, p2: d.cur, yaw: d.yaw, height: setup.tool === 'table' ? 0.75 : 0.45, src: d.src };
      setup.msg = '';
    }
  }
  refreshSetupPanel();
}
function updateSetup(dt) {
  // Laser-Punkt(e) auf dem Boden
  const srcs = renderer.xr.isPresenting ? hands.filter(h => h.src) : ['mouse'];
  for (const h of hands) h.floorMarker.visible = false;
  mouseMarker.visible = false;
  const laserTool = setup.tool && setup.tool !== 'floor';
  for (const src of srcs) {
    const marker = src === 'mouse' ? mouseMarker : src.floorMarker;
    if (!laserTool || (src !== 'mouse' && (!isFree(src) || src.uiHover))) continue;
    if (setup.tool === 'erase') continue;
    if (setup.tool === 'door' || setup.tool === 'window') {
      const wh = setup.drag && setup.drag.src === src ? wallHit(rayOf(src), setup.drag.wall) : wallHit(rayOf(src));
      if (wh) { marker.visible = true; marker.position.copy(wh.point).addScaledVector(wh.wall.normal, 0.01); marker.quaternion.setFromUnitVectors(UP, wh.wall.normal); }
      continue;
    }
    marker.quaternion.identity();
    const hit = floorHit(rayOf(src));
    if (hit) {
      marker.visible = true;
      const c = setup.tool === 'wall' && !setup.drag ? snapCorner(hit) : null;
      marker.position.copy(c || hit).setY(0.003);
      marker.scale.setScalar(c ? 1.8 : 1);
    }
  }
  if (setup.tool === 'erase') {
    let hx = null;
    for (const src of srcs) { if (src !== 'mouse' && (!isFree(src) || src.uiHover)) continue; hx = surfaceAt(rayOf(src)); if (hx) break; }
    hoverSurface(hx);
  } else if (setup.hoverS) unhover();
  // Ziehen
  const d = setup.drag;
  previewWall.visible = previewBox.visible = previewLine.visible = false;
  if (d && d.wall) {
    const wh = wallHit(rayOf(d.src), d.wall);
    if (wh) { d.u = wh.u; d.v = wh.v; }
    const o = openingFromDrag(d);
    const w = d.wall;
    previewWall.visible = true;
    previewWall.scale.set(Math.max(0.02, o.width), Math.max(0.02, o.top - o.bottom), 1);
    previewWall.position.copy(o.a).addScaledVector(w.right, o.width / 2).setY((o.bottom + o.top) / 2).addScaledVector(w.normal, 0.01);
    previewWall.quaternion.setFromRotationMatrix(tmpM.makeBasis(w.right, UP, w.normal));
  } else if (d) {
    const hit = floorHit(rayOf(d.src));
    let how = '';
    if (hit) { if (setup.tool === 'wall') { const sn = snapWallEnd(d.start, hit); d.cur = sn.p; how = sn.how; } else d.cur = hit; }
    d.yaw = suggestYaw(d.start, headYaw());
    const L = d.start.distanceTo(d.cur);
    if (L > 0.05) showLenLabel(d.cur.clone().setY(0.25), `${L.toFixed(2)} m${how ? ' · ' + how : ''}`);
    previewLine.visible = true;
    previewLine.geometry.setFromPoints([d.start.clone().setY(0.01), d.cur.clone().setY(0.01)]);
    if (setup.tool === 'wall' || setup.tool === 'door' || setup.tool === 'window') {
      const s = setup.tool === 'wall' ? makeWall(d.start, d.cur, headPos) : makeOpening(setup.tool, d.start, d.cur, headPos, setup.tool === 'door' ? 0 : 0.9, setup.tool === 'door' ? 2.05 : 2.0);
      if (s) {
        previewWall.visible = true;
        previewWall.scale.set(s.width, s.type === 'wall' ? s.height : s.top - s.bottom, 1);
        previewWall.position.copy(s.center);
        previewWall.quaternion.setFromRotationMatrix(tmpM.makeBasis(s.right, UP, s.normal));
      }
    } else if (setup.tool === 'table' || setup.tool === 'chair') {
      const s = makeBox(setup.tool, d.start.clone().setY(0.02), d.cur.clone().setY(0.02), d.yaw);
      previewBox.visible = true;
      previewBox.scale.set(s.hx * 2, 0.02, s.hz * 2);
      previewBox.position.set(s.center.x, 0.01, s.center.z);
      previewBox.rotation.set(0, s.yaw, 0);
    }
  }
  // Höhe des neuen Tisches/Stuhls mit dem Laser bestimmen
  const p = setup.pending;
  const stickX = hands.reduce((a, h) => (Math.abs(h.stickX) > Math.abs(a) ? h.stickX : a), 0);
  const stickY = hands.reduce((a, h) => (Math.abs(h.stickY) > Math.abs(a) ? h.stickY : a), 0);
  if (p && p.type === 'window') {
    // die Hand, die gezeichnet hat, bestimmt die Höhe
    const src = !renderer.xr.isPresenting ? 'mouse' : (p.src && p.src !== 'mouse' && p.src.src && !p.src.uiHover ? p.src : (hands.find(h => h.src && isFree(h) && !h.uiHover) || null));
    const mid = p.a.clone().add(p.b).multiplyScalar(0.5).setY(0);
    if (src) { const hgt = heightFromRay(rayOf(src), mid, 2.6); if (hgt) p[p.stage] = THREE.MathUtils.damp(p[p.stage], hgt, 20, dt); }
    if (hands.some(h => down(h, 'b'))) { setup.pending = null; setup.msg = 'Abgebrochen'; refreshSetupPanel(); return; }
    const s = makeOpening('window', p.a, p.b, headPos, p.bottom, p.stage === 'bottom' ? p.bottom + 0.02 : Math.max(p.top, p.bottom + 0.05));
    if (s) {
      previewWall.visible = true;
      previewWall.scale.set(s.width, Math.max(0.02, s.top - s.bottom), 1);
      previewWall.position.copy(s.center);
      previewWall.quaternion.setFromRotationMatrix(tmpM.makeBasis(s.right, UP, s.normal));
    }
    setup.refT -= dt;
    if (setup.refT <= 0) { setup.refT = 0.15; refreshSetupPanel(); }
  } else if (p) {
    // die Hand, die gezeichnet hat, bestimmt die Höhe
    const src = !renderer.xr.isPresenting ? 'mouse' : (p.src && p.src !== 'mouse' && p.src.src && !p.src.uiHover ? p.src : (hands.find(h => h.src && isFree(h) && !h.uiHover) || null));
    const s0 = boxWithHeight(p);
    if (src) {
      const hgt = heightFromRay(rayOf(src), s0.center.clone().setY(0));
      if (hgt) p.height = THREE.MathUtils.damp(p.height, hgt, 20, dt);
    }
    if (Math.abs(stickX) > 0.4) p.yaw -= stickX * dt * 1.2;
    if (hands.some(h => down(h, 'b'))) { setup.pending = null; setup.msg = 'Abgebrochen'; refreshSetupPanel(); return; }
    const s = boxWithHeight(p);
    previewBox.visible = true;
    previewBox.scale.set(s.hx * 2, s.height, s.hz * 2);
    previewBox.position.set(s.center.x, s.height / 2, s.center.z);
    previewBox.rotation.set(0, s.yaw, 0);
    setup.refT -= dt;
    if (setup.refT <= 0) { setup.refT = 0.15; refreshSetupPanel(); }
  } else if (!setup.align && setup.last && setup.last.type !== 'wall' && !setup.last.pos && Math.abs(stickX) > 0.4 && room.surfaces.includes(setup.last)) {
    // zuletzt platzierten Tisch/Stuhl drehen
    setup.rotT -= dt;
    if (setup.rotT <= 0) { rotateBox(setup.last, setup.last.yaw - stickX * 0.1); setup.rotT = 0.05; }
  }
  // Ausrichten:
  //  · Griff-Taste halten = Karte „anfassen“: sie folgt der Hand (verschieben) und dreht sich mit dem Handgelenk
  //  · linker Stick = in alle Richtungen schieben, rechter Stick ◀ ▶ = drehen (fein)
  if (setup.align && !d) {
    const a = setup.align;
    const grabber = renderer.xr.isPresenting ? hands.find(h => h.src && h.btn.squeeze && !h.held) : null;
    if (grabber) {
      const hy = handYaw(grabber);
      if (!a.grab || a.grab.h !== grabber) {
        a.grab = { h: grabber, start: grabber.point.clone().setY(0), yaw0: hy, angle0: a.angle, offset0: a.offset.clone() };
        pulse(grabber, 0.5, 40);
        setup.msg = 'Karte gepackt – Hand bewegen = schieben, Handgelenk drehen = drehen';
      }
      const g = a.grab;
      const dYaw = Math.atan2(Math.sin(hy - g.yaw0), Math.cos(hy - g.yaw0));
      const dP = grabber.point.clone().setY(0).sub(g.start);
      // Transformation: erst um den Griffpunkt drehen, dann um die Handbewegung verschieben
      const q = new THREE.Quaternion().setFromAxisAngle(UP, dYaw);
      const t = a.pivot.clone().add(g.offset0).sub(g.start).applyQuaternion(q).add(g.start).add(dP);
      a.angle = g.angle0 + dYaw;
      a.offset.copy(t.sub(a.pivot));
      a.dirty = true;
      if (Math.random() < dt * 8) pulse(grabber, 0.08, 10);
    } else if (a.grab) { a.grab = null; setup.msg = 'Losgelassen – passt es? Sonst nochmal packen'; refreshSetupPanel(); }
    else {
      const L = hands[0], R = hands[1];
      const mx = renderer.xr.isPresenting ? (L && L.stickX) || 0 : stickX, my = renderer.xr.isPresenting ? (L && L.stickY) || 0 : stickY;
      const rx = renderer.xr.isPresenting ? (R && R.stickX) || 0 : 0;
      if (Math.abs(rx) > 0.3) alignRotate(-rx * dt * 0.3, headPos.clone().setY(0));
      if (Math.abs(mx) > 0.25 || Math.abs(my) > 0.25) {
        const yaw = headYaw();
        const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        a.offset.addScaledVector(right, mx * dt * 0.35).addScaledVector(fwd, -my * dt * 0.35);
        a.dirty = true;
      }
    }
    a.t -= dt;
    if (a.dirty && a.t <= 0) { a.t = a.grab ? 0.06 : 0.12; applyAlign(); if (!a.grab) refreshSetupPanel(); }
  }
  if (!d) lenLabel.mesh.visible = false;
  // Bodenhöhe fein einstellen
  if (setup.tool === 'floor') {
    floorGrid.position.set(headPos.x, 0.001, headPos.z);
    if (Math.abs(stickY) > 0.3) {
      floorOffset -= stickY * dt * 0.08; // Stick hoch = Gitter hoch
      setup.refT -= dt;
      if (setup.refT <= 0) { setup.refT = 0.05; applyFloorOffset(); refreshSetupPanel(); }
    }
  }
  // Raum aus der Quest-Raumeinrichtung übernehmen
  const frame = renderer.xr.getFrame && renderer.xr.getFrame();
  if (frame && frame.detectedPlanes !== undefined && !setup.planeSupport) { setup.planeSupport = true; refreshSetupPanel(); }
  const autoTry = setup.autoImport > 0 && !room.surfaces.length;
  if (setup.autoImport > 0) setup.autoImport -= dt;
  if (frame && (setup.importReq || (autoTry && frame.detectedPlanes && frame.detectedPlanes.size > 0))) {
    if (setup.importReq) clearRoom();
    const n = importDetectedPlanes(frame, renderer.xr.getReferenceSpace());
    setup.importReq = false;
    setup.autoImport = 0;
    setup.msg = n > 0 ? `${n} Flächen aus der Quest-Raumeinrichtung übernommen – prüfen & ergänzen` : 'Keine Raumdaten gefunden – bitte selbst einzeichnen';
    if (n > 0) { closeRoomGaps(0.9); saveRoom(); }
    refreshSetupPanel();
  }
}
function enterSetup() {
  state = 'setup';
  for (const h of hands) releaseHand(h); // Hände frei zum Einrichten
  setEditMode(true);
  menuPanel.visible = false;
  setupPanel.visible = true;
  setupPanel.place(0.85, 0.65, -0.4);
  refreshSetupPanel();
}
function finishSetup() {
  endAlign();
  // Wände zu einem geschlossenen Raum verbinden (Lücken schließen, letzte Öffnung zumachen)
  if (surfacesOf('wall').length >= 2 && closeRoom() > 0) floatingText('Raum geschlossen', headPos.clone().add(new THREE.Vector3(0, -0.2, 0)), '#7dffa8');
  unhover();
  lenLabel.mesh.visible = false;
  setup.view = 'main';
  setup.tool = null;
  setup.drag = null;
  setup.pending = null;
  floorGrid.visible = false;
  previewWall.visible = previewBox.visible = previewLine.visible = false;
  for (const h of hands) h.floorMarker.visible = false;
  mouseMarker.visible = false;
  saveRoom();
  setEditMode(false);
  setupPanel.visible = false;
  enterMenu();
}

// =============================================================================
// Spielablauf (Grundgerüst): Menü → Spielen → Pause/Hauptmenü
// =============================================================================
let state = 'menu';
const inRound = () => state === 'playing';

function enterMenu() {
  state = 'menu';
  menuView = 'main';
  menuPanel.visible = true;
  menuPanel.place(Math.min(1.1, freeDistance(headPos, inFront(1, 0.2, headPos.y).sub(headPos), 1.4) - 0.15), 0.2, -0.15);
  refreshMenu();
}
function refreshMenu() {
  if (menuView === 'settings') { refreshSettings(); return; }
  if (paused) { menuPanel.visible = false; pausePanel.visible = true; refreshPause(); return; } // aus den Einstellungen zurück in die Pause
  const nOpen = surfacesOf('door', 'window').length;
  menuPanel.set((ctx, w) => {
    text(ctx, '🏰 Burg-Abwehr', w / 2, 48, 48, '#fff', 'center', true);
    text(ctx, 'Neuanfang – Raum, Physik und Menü sind bereit.', w / 2, 100, 24, '#cfd8e3');
    text(ctx, `Raum: ${surfacesOf('wall').length} Wände · ${nOpen} Türen/Fenster · ${surfacesOf('table', 'chair').length} Möbel`, w / 2, 134, 22, nOpen ? '#9ad' : '#ffb04a', 'center', true);
    text(ctx, 'Kisten: hingreifen + Griff-Taste · aus der Ferne: Laser + Griff-Taste · loslassen = werfen', w / 2, 452, 19, '#cfd8e3');
    text(ctx, `Version ${VERSION}`, w - 24, 664, 18, '#6b7a90', 'right');
  }, [
    ...row(170, 64, [{ id: 'start', label: '▶ SPIELEN', font: 40, onClick: startPressed }], 792, 200),
    ...row(256, 58, [
      { id: 'room', label: '🧱 Raum bearbeiten', onClick: enterSetup },
      { id: 'crate', label: '📦 Testkiste', onClick: () => { spawnCrate(inFront(0.7, 0, headPos.y + 0.1)); SFX.ui(); } }
    ], 792),
    ...row(328, 58, [
      { id: 'clearprops', label: '🧹 Kisten wegräumen', font: 28, disabled: !props.length, onClick: () => { clearProps(); refreshMenu(); } },
      { id: 'settings', label: '⚙ Einstellungen', onClick: () => { menuView = 'settings'; refreshMenu(); } }
    ], 792)
  ]);
}
// Einstellungs-Ansicht mit Reitern
let menuView = 'main', settingsTab = 'ton';
function refreshSettings() {
  const tab = SETTINGS_TABS[settingsTab];
  const btns = [...row(80, 52, Object.entries(SETTINGS_TABS).map(([id, t]) => ({ id: 't_' + id, label: t.label, font: 21, active: settingsTab === id, onClick: () => { settingsTab = id; refreshMenu(); } })), 792, 20, 8)];
  tab.items.forEach((it, i) => {
    const y = 148 + i * 57;
    const idx = Math.max(0, it.opts.findIndex(o => o[0] === settings[it.key]));
    const step = (d) => () => { const n = it.opts.length; setSetting(it.key, it.opts[(idx + d + n) % n][0]); if (it.key === 'announcer' || it.key === 'announcerVoice') speak('Willkommen in der Burg'); else SFX.ui(); };
    btns.push({ id: 'l_' + it.key, label: '◀', font: 28, x: 470, y, w: 64, h: 50, onClick: step(-1) });
    btns.push({ id: 'r_' + it.key, label: '▶', font: 28, x: 704, y, w: 64, h: 50, onClick: step(1) });
  });
  btns.push(...row(610, 56, [
    { id: 'reset', label: '↺ Standard', font: 26, onClick: () => { for (const it of tab.items) settings[it.key] = SETTINGS_DEFAULT[it.key]; setSetting(tab.items[0].key, settings[tab.items[0].key]); } },
    { id: 'back', label: '◀ Zurück', font: 30, onClick: () => { menuView = 'main'; refreshMenu(); } }
  ], 792));
  menuPanel.set((ctx, w) => {
    text(ctx, '⚙ Einstellungen', w / 2, 40, 38, '#fff', 'center', true);
    tab.items.forEach((it, i) => {
      const y = 148 + i * 57;
      const o = it.opts.find(q => q[0] === settings[it.key]) || it.opts[0];
      text(ctx, it.label, 40, y + 26, 24, '#e6edf5', 'left', true);
      roundRect(ctx, 542, y + 3, 154, 44, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
      text(ctx, o[1], 619, y + 27, 24, '#ffd36a', 'center', true);
      if (it.opts.length === 11 && typeof o[0] === 'number') { ctx.fillStyle = '#ffd36a'; ctx.fillRect(546, y + 43, 146 * o[0] / 10, 4); }
    });
    text(ctx, `Version ${VERSION}`, w - 24, 664, 18, '#6b7a90', 'right');
  }, btns);
}
function startPressed() {
  if (state !== 'menu') return;
  state = 'playing';
  menuPanel.visible = false;
  SFX.ui();
  floatingText('Pause: Stick drücken oder B/Y (PC: Esc)', inFront(1.2, 0, headPos.y - 0.1), '#ffd36a');
}

// =============================================================================
// Steuerung am PC (zum Testen ohne Brille)
// =============================================================================
const mouseNdc = new THREE.Vector2();
let lookYaw = 0, lookPitch = -0.2, rightDrag = false, lastX = 0, lastY = 0;
const keys = new Set();
let deskHeld = null; // am PC gehaltene Kiste
renderer.domElement.addEventListener('pointermove', (e) => {
  mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  crosshairEl.style.left = e.clientX + 'px';
  crosshairEl.style.top = e.clientY + 'px';
  if (rightDrag) {
    lookYaw -= (e.clientX - lastX) * 0.004;
    lookPitch = THREE.MathUtils.clamp(lookPitch - (e.clientY - lastY) * 0.004, -1.3, 1.2);
    lastX = e.clientX; lastY = e.clientY;
  }
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting) return;
  mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  if (e.button === 2) { rightDrag = true; lastX = e.clientX; lastY = e.clientY; return; }
  if (e.button !== 0) return;
  raycaster.setFromCamera(mouseNdc, camera);
  const ui = raycaster.intersectObjects(uiPanels.filter(p => p.visible).map(p => p.mesh), false)[0];
  if (ui) { const b = ui.object.userData.ui.buttonAt(ui.uv); if (b) { b.onClick(); SFX.ui(); } return; }
  if (paused) return; // in der Pause nur Menü-Knöpfe
  if (state === 'setup') { setupTriggerDown('mouse'); return; }
  // Kiste mit der Maus greifen (Klick) und werfen (nochmal klicken)
  if (deskHeld) { deskThrow(); return; }
  const hit = raycaster.intersectObjects(props.map(p => p.obj), false)[0];
  if (hit && hit.distance < 5) {
    const p = props.find(q => q.obj === hit.object);
    if (p.phys) { removeDynamic(p.phys); p.phys = null; }
    camera.attach(p.obj);
    p.obj.position.set(0.15, -0.2, -0.6);
    deskHeld = p;
    SFX.grab();
  }
});
function deskThrow() {
  const p = deskHeld;
  deskHeld = null;
  raycaster.setFromCamera(mouseNdc, camera);
  makeLoose(p, raycaster.ray.direction.clone().multiplyScalar(6).add(new THREE.Vector3(0, 1.5, 0)), new THREE.Vector3(2, 1, 0));
}
window.addEventListener('pointerup', (e) => {
  if (e.button === 2) rightDrag = false;
  if (e.button === 0 && setup.drag && setup.drag.src === 'mouse') setupTriggerUp();
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (renderer.xr.isPresenting) return;
  if (e.code === 'Escape') { if (paused) setPaused(false); else if (state === 'playing') setPaused(true); return; }
  if (paused) return; // in der Pause keine Spiel-Tasten
  keys.add(e.code);
  if (e.key === 'Enter') startPressed();
  if (e.key === 'c' || e.key === 'C') spawnCrate(inFront(1, 0, 1.4));
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
// PC: mit WASD durch den Raum gehen
function updateDesktopMove(dt) {
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!f && !s) return;
  const sp = 2 * dt;
  camera.position.x += (-Math.sin(lookYaw) * f + Math.cos(lookYaw) * s) * sp;
  camera.position.z += (-Math.cos(lookYaw) * f - Math.sin(lookYaw) * s) * sp;
}
// Beispielraum für den PC-Test
function buildDemoRoom() {
  room.desktop = true;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  addWall(v(-4, 0, -5), v(4, 0, -5), headPos);
  addWall(v(-3.2, 0, -5), v(-3.2, 0, 1), headPos);
  addBox('table', v(0.4, 0.75, -2.9), v(1.8, 0.75, -2.2), 0);
  addBox('chair', v(-1.7, 0.46, -3.3), v(-1.25, 0.46, -2.85), 0);
  addOpening('door', v(-3.2, 0, -3.6), v(-3.2, 0, -2.6), headPos, 0, 2.05);
  addOpening('window', v(-0.6, 0, -5), v(0.6, 0, -5), headPos, 0.9, 2.0);
}

// =============================================================================
// VR-Sitzung
// =============================================================================
renderer.xr.addEventListener('sessionstart', () => {
  scene.background = null;
  desktopFloor.visible = false;
  crosshairEl.style.display = 'none';
  ensureAudio();
  if (deskHeld) deskThrow();
  clearProps();
  room.desktop = false;
  baseRefSpace = renderer.xr.getReferenceSpace();
  applyFloorOffset();
  clearRoom();
  setup.autoImport = 4;
  perf.level = 0; perf.lowHz = false; perf.ema = 0;
  applyPerfLevel();
  applyFrameRate(); // 90 Hz statt 72 Hz (wenn die Brille es kann)
  setTimeout(() => enterSetup(), 400);
});
renderer.xr.addEventListener('sessionend', () => {
  scene.background = desktopBackground;
  desktopFloor.visible = true;
  crosshairEl.style.display = '';
  camera.position.set(0, 1.6, 0);
  for (const h of hands) { h.held = null; h.pull = null; }
  clearProps();
  setPaused(false);
  clearRoom();
  baseRefSpace = null;
  setup.tool = null; setup.pending = null; setup.drag = null;
  floorGrid.visible = false;
  setEditMode(false);
  setupPanel.visible = false;
  buildDemoRoom();
  enterMenu();
});

// =============================================================================
// Pause-Menü: jederzeit beim Spielen (VR: Stick drücken oder Y/B mit freier Hand · PC: Esc)
// =============================================================================
const pausePanel = new UIPanel(0.9, 0.62, 700);
pausePanel.border = '#7dc8ff';
pausePanel.visible = false;
function refreshPause() {
  pausePanel.set((ctx, w) => {
    text(ctx, '⏸ Pause', w / 2, 52, 48, '#fff', 'center', true);
    text(ctx, 'Pause/weiter: Stick drücken oder Y/B (PC: Esc)', w / 2, 398, 18, '#8796ad');
  }, [
    ...row(120, 70, [{ id: 'resume', label: '▶ Weiter', font: 36, onClick: () => setPaused(false) }], 630, 60),
    ...row(206, 62, [{ id: 'psettings', label: '⚙ Einstellungen', font: 28, onClick: () => { pausePanel.visible = false; menuView = 'settings'; menuPanel.visible = true; menuPanel.place(0.95, 0, -0.1); refreshMenu(); } }], 630, 60),
    ...row(284, 62, [{ id: 'quit', label: '🏠 Hauptmenü', font: 28, onClick: () => { setPaused(false); enterMenu(); } }], 630, 60)
  ]);
}
const clock = new THREE.Clock();
function setPaused(on) {
  if (on === paused) return;
  if (on && state !== 'playing') return;
  paused = on;
  setAudioPaused(on);
  if (on) {
    refreshPause();
    pausePanel.visible = true;
    pausePanel.place(0.9, 0, -0.1);
    for (const h of hands) pulse(h, 0.4, 40);
  } else {
    pausePanel.visible = false;
    if (menuView === 'settings') { menuView = 'main'; menuPanel.visible = false; }
    clock.getDelta(); // die Pausenzeit nicht als einen riesigen Zeitschritt nachholen
  }
}
const pauseButton = (h) => down(h, 'stick') || (down(h, 'b') && !h.held);
// Bild während der Pause: nur Kopf, Zeigestrahl und Menü – alles andere steht still
function pauseFrame(xr) {
  clock.getDelta();
  if (!xr) camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
  camera.updateMatrixWorld(true);
  getViewCamera().getWorldPosition(headPos);
  if (xr) {
    readInputs();
    for (const h of hands) {
      h.ray.updateMatrixWorld(true);
      if (!h.src) { h.pointer.visible = false; continue; }
      const pt = pointerTarget(h);
      const hover = pt && pt.kind === 'ui' ? pt.panel.buttonAt(pt.uv) : null;
      if (h.uiHover !== hover) { if (h.uiHover) h.uiHover.panel.setHover(null); h.uiHover = hover; if (hover) { hover.panel.setHover(hover); pulse(h, 0.1, 10); } }
      h.pointer.visible = true;
      h.pointer.scale.z = pt && pt.kind === 'ui' ? pt.dist : 1.5;
      if (down(h, 'trigger') && hover) { hover.onClick(); pulse(h, 0.3, 20); if (!paused) break; }
      else if (pauseButton(h) && pausePanel.visible) { setPaused(false); break; }
    }
  }
  scene.updateMatrixWorld();
  renderer.render(scene, camera);
}

// =============================================================================
// Hauptschleife
// =============================================================================
camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ');
camera.updateMatrixWorld(true);
buildDemoRoom();
enterMenu();

// Fehler werden gemeldet, aber das Spiel läuft weiter (sonst friert die VR-Ansicht ein)
const errorEl = document.createElement('div');
errorEl.style.cssText = 'position:absolute;bottom:120px;left:16px;right:16px;color:#ffb0b0;font:12px monospace;white-space:pre-wrap;pointer-events:none';
document.body.appendChild(errorEl);
let errorCount = 0, lastErrorShown = -10;
function reportError(e) {
  errorCount++;
  console.error(e);
  errorEl.textContent = `Fehler (${errorCount}): ${e && e.message ? e.message : e}`;
  if (renderer.xr.isPresenting && elapsed - lastErrorShown > 5) {
    lastErrorShown = elapsed;
    try { floatingText('⚠ Fehler abgefangen – Spiel läuft weiter', inFront(1.2, 0, headPos.y), '#ff9090'); } catch { /* egal */ }
  }
}
window.addEventListener('error', (ev) => reportError(ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason));

renderer.setAnimationLoop(() => {
  try { frameInner(); }
  catch (e) {
    reportError(e);
    try { renderer.setRenderTarget(null); scene.updateMatrixWorld(); renderer.render(scene, camera); } catch { /* nächstes Bild */ }
  }
});
function frameInner() {
  if (paused) { pauseFrame(renderer.xr.isPresenting); return; }
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  autoPerf(rawDt);
  elapsed += dt;
  const xr = renderer.xr.isPresenting;
  if (!xr) { updateDesktopMove(dt); camera.rotation.set(lookPitch, lookYaw, 0, 'YXZ'); }
  camera.updateMatrixWorld(true);
  getViewCamera().getWorldPosition(headPos);
  for (const h of hands) h.ray.updateMatrixWorld(true);
  if (shadowsOn) { // Schattenkamera folgt dem Spieler
    sun.target.position.set(headPos.x, 0, headPos.z);
    shadowFloor.position.x = headPos.x; shadowFloor.position.z = headPos.z;
    sun.position.set(headPos.x + 1.6, 5, headPos.z + 2.2);
    sun.target.updateMatrixWorld();
    shadowFrame = (shadowFrame + 1) % Q().shadowEvery;
    if (shadowFrame === 0) renderer.shadowMap.needsUpdate = true;
  }
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  }
  if (xr) {
    readInputs();
    if (state === 'playing' && hands.some(h => h.src && pauseButton(h))) { setPaused(true); pauseFrame(true); return; }
    // Bedienfelder folgen, wenn man sich weit entfernt
    for (const p of [setupPanel, menuPanel]) if (p.visible && headPos.distanceTo(p.anchor) > 1.3) p === menuPanel ? enterMenu() : p.place(0.85, 0.65, -0.4);
    updateHandsXR(dt);
  }
  if (state === 'setup') updateSetup(dt);
  stepPhysics(dt);
  updateDust(dt);
  updateAtmosphere(dt);
  getViewCamera().getWorldDirection(tmpV);
  setListener(headPos, tmpV, UP.clone().applyQuaternion(getViewCamera().getWorldQuaternion(tmpQ)));
  updateEffects(dt);
  updateDebris(dt);
  statusEl.style.display = 'none';
  scene.updateMatrixWorld();
  renderer.render(scene, camera);
}

// Für automatisierte Tests
applySettings();
window.__game = {
  renderer, room, hands, props, uiPanels, settings, setup, menuPanel, setupPanel, pausePanel,
  get state() { return state; }, get paused() { return paused; }, get errors() { return errorCount; }, get floorOffset() { return floorOffset; },
  startPressed, enterMenu, enterSetup, finishSetup, setPaused, spawnCrate, clearProps, setTool, setupTriggerDown, setupTriggerUp,
  alignToLine, loadSlot, saveSlot, serializeRoom, surfaceAt, updateSetup
};
