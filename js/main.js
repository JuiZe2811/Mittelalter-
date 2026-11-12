import * as THREE from 'three';
import { VERSION } from './version.js?v=11';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makePanel, panelBg, roundRect } from './util.js?v=11';
import { SFX, SFX_PLAYER, ensureAudio, setListener, setVolumes, setAudioPaused } from './sfx.js?v=11';
import { segPoint, segSeg } from './geom.js?v=11';
import { stepPhysics, addDynamic, removeDynamic, localBoxOf } from './physics.js?v=11';
import { initEnemies, spawnEnemy, updateEnemies, clearEnemies, prepareNav, aliveCount, enemies, strikeTest, applyHit, shoveEnemy, hitShield, teamOpening, notifyShot, beatWeapon, pushEnemy, bindTest, bindPush, enemyWeaponSeg, player, opts as combatOpts, pickType, ENEMY_TYPES, TYPE_ORDER, warmupGroup } from './enemies.js?v=11';
import { groundAt } from './nav.js?v=11';
import { WEAPON_ORDER, WEAPONS, createWeapon, setBowString, setXbowString, xbowPull, initWeapons, shootArrow, throwWeapon, updateFlying, clearFlying, updateChain, makeArrowMesh } from './weapons.js?v=11';
import { createHolsters, updateHolsters, slotNear, fits, holsterPose } from './holster.js?v=11';
import { setWarn, surfaceDistance } from './room.js?v=11';
import { room, addWall, addBox, makeWall, makeBox, rotateBox, removeSurface, clearRoom, setEditMode, suggestYaw, surfacesOf, importDetectedPlanes, saveRoom, loadRoom, hasSavedRoom, surfaceName, serializeRoom, deserializeRoom, roomSlots, saveRoomSlot, loadRoomSlot, addOpening, makeOpening, roomOccluders, setAtmosphere, closeRoomGaps, closeRoom, openWallEnds } from './room.js?v=11';
import { initEffects, headRef, floatingText, updateEffects, updateDebris, fx, clearDebris, sparks, warmText, burst } from './effects.js?v=11';
const clamp = THREE.MathUtils.clamp;
const hyp = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // schneller als Math.hypot und ohne Speicher-Müll

// =============================================================================
// Grundgerüst – Burg-Abwehr (Neuanfang)
// Enthalten: Raum-Einrichtung (Wände, Türen, Fenster, Möbel, Bodenhöhe, Räume speichern/laden,
// Ausrichten, Quest-Raum), Menü, Einstellungen, Pause, Gegner (kommen durch Türen & Fenster,
// klettern auf Bett/Tisch, kämpfen mit echten Waffenbahnen) und Waffen: Dolch, Langschwert, Schild, Bogen.
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
initEnemies(scene);
initWeapons(scene, (h, r, info) => onEnemyHit(h, r, info), (h, f) => enemyBlocked(h, null, f.shield));

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
  const grip = renderer.xr.getControllerGrip(i); // Griff-Raum: Mitte der Handfläche, -Z entlang der geschlossenen Faust
  scene.add(grip);
  const h = {
    i, ray, grip, velHist: [], throwVel: new THREE.Vector3(), highlight: null, src: null, handedness: i === 0 ? 'left' : 'right', btn: {}, prev: {}, stickX: 0, stickY: 0,
    point: new THREE.Vector3(), tip: new THREE.Vector3(), quat: new THREE.Quaternion(), uiHover: null,
    held: null, drawing: null, pull: null, grip2: null, hist: [], vel: new THREE.Vector3(), angVel: new THREE.Vector3()
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
const hasGrip = (h) => h.grip.visible && settings.gripSpace;
const handPoint = (h, out) => (hasGrip(h) ? out.setFromMatrixPosition(h.grip.matrixWorld) : out.setFromMatrixPosition(tmpM.multiplyMatrices(h.ray.matrixWorld, HOLD_OFFSET)));
function readInputs() {
  for (const h of hands) {
    h.prev = h.btn;
    h.btn = {};
    const gp = h.src && h.src.gamepad;
    for (const [k, idx] of Object.entries(BTN)) h.btn[k] = !!(gp && gp.buttons[idx] && gp.buttons[idx].pressed);
    h.stickX = gp && gp.axes.length > 3 ? gp.axes[2] : 0;
    h.stickY = gp && gp.axes.length > 3 ? gp.axes[3] : 0;
    if (!h.ray.visible && !h.grip.visible) { h.hist.length = 0; h.velHist.length = 0; h.vel.set(0, 0, 0); h.prevFist = null; continue; } // Tracking verloren
    handPoint(h, h.point);
    h.tip.setFromMatrixPosition(h.ray.matrixWorld);
    h.ray.getWorldQuaternion(h.quat);
    // Geschwindigkeit + Drehgeschwindigkeit der Hand (für Würfe)
    h.hist.push({ p: h.point.clone(), q: h.quat.clone(), t: elapsed });
    while (h.hist.length > 2 && elapsed - h.hist[0].t > 0.08) h.hist.shift();
    const a = h.hist[0], b = h.hist[h.hist.length - 1], dt = b.t - a.t;
    if (dt > 0.001) {
      h.vel.copy(b.p).sub(a.p).divideScalar(dt);
      const dq = b.q.clone().multiply(a.q.clone().invert());
      if (dq.w < 0) { dq.x *= -1; dq.y *= -1; dq.z *= -1; dq.w *= -1; }
      const angle = 2 * Math.acos(Math.min(1, dq.w)), sn = Math.sqrt(1 - dq.w * dq.w);
      if (sn > 1e-4) h.angVel.set(dq.x / sn, dq.y / sn, dq.z / sn).multiplyScalar(angle / dt); else h.angVel.set(0, 0, 0);
    }
    // Wurf-Geschwindigkeit: die schnellste Handbewegung der letzten 0,1 s (beim Loslassen bremst die Hand schon ab)
    h.velHist.push({ v: h.vel.clone(), t: elapsed });
    while (h.velHist.length && elapsed - h.velHist[0].t > 0.1) h.velHist.shift();
    h.throwVel.copy(h.velHist.reduce((m, x) => (x.v.lengthSq() > m.lengthSq() ? x.v : m), h.vel));
  }
}
const down = (h, k) => h.btn[k] && !h.prev[k];
const up = (h, k) => !h.btn[k] && h.prev[k];
function pulse(h, intensity, ms) {
  const act = h && h.src && h.src.gamepad && h.src.gamepad.hapticActuators && h.src.gamepad.hapticActuators[0];
  if (act && act.pulse && settings.haptics > 0) act.pulse(Math.min(1, intensity * settings.haptics), ms);
}
// Hand (Controller) als Drehung um die Hochachse
function handYaw(h) {
  tmpV.set(0, 0, -1).applyQuaternion(h.quat);
  return Math.atan2(-tmpV.x, -tmpV.z);
}

// Zeigestrahl: UI-Knöpfe
function pointerTarget(h) {
  h.ray.getWorldPosition(tmpV);
  raycaster.set(tmpV, tmpV3.set(0, 0, -1).applyQuaternion(h.quat));
  raycaster.far = 6;
  let best = null;
  // Menüs zählen nur, wenn ein Knopf getroffen wird – sonst geht der Laser durch
  for (const ph of raycaster.intersectObjects(uiPanels.filter(p => p.mesh.visible).map(p => p.mesh), false)) {
    if (ph.object.userData.ui.buttonAt(ph.uv)) { best = { kind: 'ui', dist: ph.distance, panel: ph.object.userData.ui, uv: ph.uv }; break; }
  }
  if (!best && (state === 'playing' || state === 'menu')) for (const w of arsenal) { // Waffen aus der Ferne heranziehen
    if (w.holder || w.thrown || !w.root.visible || w.holstered) continue;
    const box = new THREE.Box3().setFromObject(w.root).expandByScalar(0.04);
    const p = raycaster.ray.intersectBox(box, tmpV2);
    if (p) { const d = p.distanceTo(tmpV); if (d < 5 && (!best || d < best.dist)) best = { kind: 'weapon', w, dist: d }; }
  }
  return best;
}

function updateHandsXR(dt) {
  for (const h of hands) {
    if (!h.src) { h.pointer.visible = false; continue; }
    h.tipMarker.visible = state === 'setup' && setup.tool === 'floor';
    const free = !h.held && !h.drawing && !h.pull && !h.grip2 && !h.arrow;
    const wasHolding = !!h.held;
    // Zeigestrahl (im Einrichtungsmodus als Laser bis zum Boden / zur Wand)
    let pt = null;
    if ((free || weaponPanel.visible) && !(setup.drag && setup.drag.src === h)) pt = pointerTarget(h);
    let len = pt ? pt.dist : 2;
    const showPtr = (free && (pt || state !== 'playing')) || (pt && pt.kind === 'ui');
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

    // Waffe in Greifweite: leicht vergrößert + kurzes Vibrieren
    const near = free && state !== 'setup' ? weaponNear(h) : null;
    if (near !== h.highlight) {
      if (h.highlight && !h.highlight.holder) h.highlight.root.scale.setScalar(1);
      if (near) { near.root.scale.setScalar(1.08); pulse(h, 0.2, 15); }
      h.highlight = near;
    }
    // A/X: Waffen-Menü öffnen/schließen
    if (down(h, 'a') && (state === 'playing' || state === 'menu')) toggleWeaponMenu();
    // Griff-Taste: Sehne greifen (andere Hand hält den Bogen), Waffe nehmen oder per Laser heranziehen
    if (down(h, 'squeeze') && free && state !== 'setup') {
      const ow = otherHand(h).held;
      const nockDist = ow && ow.def.bow && !ow.loaded ? h.point.distanceTo(ow.model.localToWorld(ow.nock.clone())) : 9;
      const realQuiver = settings.quiver && settings.holsters && ow && ow.def.bow && !ow.def.crossbow;
      const quiverSlot = settings.quiver && settings.holsters ? slotNear(holsters, h.point, 0.22, (S) => S.def.kind === 'quiver') : null;
      if (nockDist < 0.25 && !realQuiver) { h.drawing = ow; ow.draw = 0; SFX.click(500, 0.3, 0.05); pulse(h, 0.4, 30); }
      else if (quiverSlot && !h.arrow) { // Pfeil aus dem Köcher ziehen
        h.arrow = makeArrowMesh(0); scene.add(h.arrow); SFX.click(700, 0.25, 0.05); pulse(h, 0.5, 40);
      } else if (ow && !ow.def.twoHand && h.point.distanceTo(ow.root.position) < 0.09) { // Übergabe in die andere Hand
        const o = otherHand(h); o.held = null; ow.holder = null; takeWeapon(ow, h); pulse(o, 0.3, 30);
      }
      else if (ow && ow.def.twoHand && !ow.second && (h.point.distanceTo(ow.root.localToWorld(ow.grip2.clone())) < 0.22 || segPoint(ow.root.localToWorld(ow.ga.clone()), ow.root.localToWorld(ow.gb.clone()), h.point) < 0.09)) { // beidhändig fassen (Griff, Schaft oder Klinge)
        ow.second = h; h.grip2 = ow; SFX.grab(); pulse(h, 0.5, 40); pulse(otherHand(h), 0.3, 30);
      } else {
        const S = settings.holsters ? slotNear(holsters, h.point, 0.17, (S) => !!S.weapon) : null;
        const w = weaponNear(h);
        if (S && (!w || S.anchor.position.distanceTo(h.point) < 0.12)) { const sw = S.weapon; takeWeapon(sw, h); SFX.whoosh(); } // aus dem Holster ziehen
        else if (w) takeWeapon(w, h);
        else if (pt && pt.kind === 'weapon') { h.pull = { w: pt.w }; SFX.whoosh(); }
      }
    }
    // Loslassen: Sehne und zweite Hand immer beim Loslassen der Griff-Taste; die Waffe selbst je nach Einstellung
    if (up(h, 'squeeze')) {
      if (h.drawing || h.grip2) releaseHand(h);
      else if (settings.grip === 'hold' && !h.keepUntilSqueeze) releaseHand(h);
    }
    if (down(h, 'squeeze') && settings.grip === 'toggle' && wasHolding && h.held && !h.keepUntilSqueeze) releaseHand(h); // Tippen: nochmal drücken = loslassen
    if (down(h, 'squeeze')) h.keepUntilSqueeze = false;

    // Abzug: UI klicken bzw. Raum-Werkzeug
    if (!hover && down(h, 'trigger') && h.held && h.held.def.crossbow) fireCrossbow(h.held, h);
    if (hover && down(h, 'trigger')) { uiClickHand = h; hover.onClick(); uiClickHand = null; SFX.ui(); pulse(h, 0.3, 20); }
    else if (free && down(h, 'trigger')) {
      if (hover) { hover.onClick(); SFX.ui(); pulse(h, 0.3, 20); }
      else if (state === 'setup') setupTriggerDown(h);
    }
    if (setup.drag && setup.drag.src === h && !h.btn.trigger) setupTriggerUp();
  }
}

const otherHand = (h) => hands[1 - h.i];

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
  balanced: { scale: 0.9, fov: 1, shadowEvery: 1, shadowMap: 1024, soft: false, env: false },
  fast: { scale: 0.75, fov: 1, shadowEvery: 1, shadowMap: 512, soft: false, env: false }
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
  if (perf.slowT > 1.2) {
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
  kampf: { label: '⚔ Kampf', items: [
    { key: 'difficulty', label: 'Schwierigkeit', opts: [['easy', 'Leicht'], ['normal', 'Normal'], ['hard', 'Schwer']] },
    { key: 'popups', label: 'Kampf-Texte (Parade!, Bein verletzt …)', opts: onOff },
    { key: 'blood', label: 'Blut', opts: [[0, 'Aus'], [1, 'An']] }
  ] },
  bedienung: { label: '✊ Bedienung', items: [
    { key: 'grip', label: 'Griff-Taste', opts: [['hold', 'Halten'], ['toggle', 'Tippen = festhalten']] },
    { key: 'gripAngle', label: 'Griffwinkel der Waffen', opts: [[-30, '−30°'], [-15, '−15°'], [0, '0°'], [15, '+15°'], [30, '+30°']] },
    { key: 'gripSpace', label: 'Waffe sitzt in der Handfläche', opts: onOff },
    { key: 'weight', label: 'Gewicht spürbar (Trägheit)', opts: [[0, 'Aus'], [0.5, 'Leicht'], [1, 'Normal']] },
    { key: 'trails', label: 'Schwung-Spuren', opts: onOff },
    { key: 'throwBoost', label: 'Wurfkraft', opts: [[1, 'Normal'], [1.3, 'Stärker'], [1.6, 'Sehr stark']] },
    { key: 'haptics', label: 'Vibration', opts: [[0, 'Aus'], [0.5, 'Schwach'], [1, 'Normal'], [1.5, 'Stark']] }
  ] },
  koerper: { label: '🎒 Körper', items: [
    { key: 'holsters', label: 'Holster am Körper', opts: onOff },
    { key: 'quiver', label: 'Pfeile aus dem Köcher ziehen', opts: [[true, 'An (echt)'], [false, 'Aus (bequem)']] },
    { key: 'height', label: 'Körpergröße', opts: [[1.55, '1,55 m'], [1.65, '1,65 m'], [1.75, '1,75 m'], [1.85, '1,85 m'], [1.95, '1,95 m']] },
    { key: 'hipOffset', label: 'Hüft-Holster', opts: [[-0.08, 'weiter hinten'], [0, 'normal'], [0.08, 'weiter vorne']] },
    { key: 'leftHanded', label: 'Linkshänder (Köcher links)', opts: onOff },
    { key: 'safety', label: 'Sicherheitsabstand zu Wänden/Möbeln', opts: [[0, 'Aus'], [0.3, '30 cm'], [0.5, '50 cm'], [0.8, '80 cm']] }
  ] },
  grafik: { label: '✨ Grafik', items: [
    { key: 'quality', label: 'Leistung', opts: [['quality', 'Schön'], ['balanced', 'Ausgewogen'], ['fast', 'Flüssig']] },
    { key: 'shadows', label: 'Echte Schatten', opts: onOff },
    { key: 'particles', label: 'Partikel', opts: [[0.5, 'Wenig'], [1, 'Normal'], [1.6, 'Viel']] },
    { key: 'dust', label: 'Staub in der Luft', opts: onOff },
    { key: 'frameRate', label: 'Bildrate (Brille)', opts: [[72, '72 Hz'], [90, '90 Hz'], [120, '120 Hz']] },
    { key: 'autoPerf', label: 'Automatisch flüssig halten', opts: onOff },
    { key: 'fps', label: 'Bildrate anzeigen', opts: onOff }
  ] }
};
const SETTINGS_DEFAULT = {
  master: 9, sfx: 10, music: 6, voices: 10, announcer: 10, announcerVoice: 'deep',
  haptics: 1, popups: true, difficulty: 'normal', blood: 1, grip: 'hold', gripAngle: 0, gripSpace: true, holsters: true, quiver: true, height: 1.75, hipOffset: 0, leftHanded: false, safety: 0.5, weight: 1, trails: true, throwBoost: 1.3, fps: false,
  quality: 'balanced', shadows: false, particles: 1, dust: true, frameRate: 90, autoPerf: true
};
const settings = Object.assign({}, SETTINGS_DEFAULT, load('burg-einstellungen', {}));
let voiceOn = settings.announcer > 0;
function applySettings() {
  setVolumes({ master: settings.master / 10, sfx: settings.sfx / 10, music: settings.music / 10, voices: settings.voices / 10 });
  voiceOn = settings.announcer > 0;
  fx.particles = settings.particles;
  fx.popups = settings.popups;
  fx.blood = settings.blood;
  // Schwierigkeit: Schaden, Reaktionsvermögen (Parieren, Schild, Finten) und Tempo der Gegner
  const D = { easy: { dmg: 0.6, react: 0.7, speed: 0.88 }, normal: { dmg: 1, react: 1, speed: 1 }, hard: { dmg: 1.4, react: 1.25, speed: 1.1 } }[settings.difficulty] || { dmg: 1, react: 1, speed: 1 };
  Object.assign(combatOpts, D, { texts: settings.popups });
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
    if (!laserTool || (src !== 'mouse' && src.uiHover)) continue;
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
    for (const src of srcs) { if (src !== 'mouse' && src.uiHover) continue; hx = surfaceAt(rayOf(src)); if (hx) break; }
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
    const src = !renderer.xr.isPresenting ? 'mouse' : (p.src && p.src !== 'mouse' && p.src.src && !p.src.uiHover ? p.src : (hands.find(h => h.src && !h.uiHover) || null));
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
    const src = !renderer.xr.isPresenting ? 'mouse' : (p.src && p.src !== 'mouse' && p.src.src && !p.src.uiHover ? p.src : (hands.find(h => h.src && !h.uiHover) || null));
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
    const grabber = renderer.xr.isPresenting ? hands.find(h => h.src && h.btn.squeeze) : null;
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
  clearEnemies();
  clearFlying();
  for (const h of hands) releaseHand(h);
  for (const w of arsenal) { freeWeapon(w); w.floating = false; w.root.visible = false; }
  if (deskW || deskShield) { deskW = deskShield = null; }
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
  for (const w of arsenal) { w.root.visible = true; if (!w.phys && !w.holder) placeOnRackOne(w); }
}

// =============================================================================
// Waffen in der Welt: schweben zu Beginn vor dem Spieler, lassen sich greifen, fallen mit Physik herunter
// =============================================================================
const arsenal = []; // alle Waffen in der Welt (aus dem Waffen-Menü geholt)
const holsters = createHolsters(scene);
const _hpose = new THREE.Object3D();
// Waffe ins Holster stecken: sitzt fest am Körper, bewegt sich mit
function holster(w, S) {
  freeWeapon(w);
  w.floating = false;
  S.weapon = w; w.holstered = S;
  S.anchor.add(w.root);
  holsterPose(S, w, _hpose);
  w.root.position.copy(_hpose.position); w.root.quaternion.copy(_hpose.quaternion);
  w.root.visible = true; w.root.scale.setScalar(1);
  SFX.click(900, 0.35, 0.04); SFX.thud(0.2);
}
const MAX_WEAPONS = 16;
function newWeapon(id) {
  const w = createWeapon(id);
  scene.add(w.root);
  arsenal.push(w);
  // zu viele: die älteste nicht gehaltene Waffe verschwindet
  if (arsenal.length > MAX_WEAPONS) { const old = arsenal.find(x => !x.holder && !x.desk && !x.thrown); if (old) removeWeapon(old); }
  return w;
}
function removeWeapon(w) {
  if (w === deskW) deskW = null;
  if (w === deskShield) deskShield = null;
  freeWeapon(w);
  scene.remove(w.root);
  arsenal.splice(arsenal.indexOf(w), 1);
}
function clearWeapons() { for (const w of [...arsenal]) if (!w.thrown) removeWeapon(w); }
// Waffe aus dem Waffen-Menü holen: in die klickende Hand, sonst in die andere freie Hand, sonst schwebend vor dir
function giveWeapon(id, h = null) {
  const w = newWeapon(id);
  if (!renderer.xr.isPresenting) { equipDesk(w); return w; }
  const target = [h, h && otherHand(h), ...hands].find(x => x && x.src && !x.held && !x.drawing);
  if (target) { takeWeapon(w, target); target.keepUntilSqueeze = settings.grip === 'hold'; }
  else placeOnRackOne(w, true);
  return w;
}
function freeWeapon(w) { // aus Hand/Physik/Flug/Holster lösen
  if (w.holstered) { w.holstered.weapon = null; w.holstered = null; }
  if (w.second) { w.second.grip2 = null; w.second = null; }
  w.twoHand = false; w.prevTip = w.prevBase = w.prevC = null; w.tipSpeed = 0;
  if (w.holder) { const h = w.holder; if (h.held === w) h.held = null; if (h.drawing && h.drawing === w) h.drawing = null; w.holder = null; }
  for (const h of hands) { if (h.drawing === w) h.drawing = null; if (h.pull && h.pull.w === w) h.pull = null; }
  if (w.phys) { removeDynamic(w.phys); w.phys = null; }
  if (w.root.parent !== scene) scene.attach(w.root);
  w.thrown = false; w.desk = false; w.stuckWall = false;
  if (w.embed) w.embed = null;
  if (w.def.bow) setBowString(w, null);
}
// Alle Waffen (außer gehaltenen, wenn keep) vor den Spieler zurückholen – schwebend, griffbereit
function placeOnRack(all = true) {
  // VR: auf Hüfthöhe direkt vor dir · PC: etwas weiter weg, damit man sie sieht
  const xr = renderer.xr.isPresenting;
  const yaw = headYaw(), y = xr ? Math.max(0.8, headPos.y - 0.65) : 0.95, dist = xr ? 0.5 : 1.2;
  arsenal.forEach((w, i) => {
    if (!all && (w.holder || w.desk)) return;
    if (w === deskW) deskW = null;
    if (w === deskShield) deskShield = null;
    freeWeapon(w);
    w.floating = true;
    w.home = inFront(dist, xr ? (1.5 - i) * 0.32 : -0.42 - i * 0.17, y, yaw);
    w.homeYaw = yaw;
    w.root.visible = true;
    poseFloating(w, 0);
  });
}
function poseFloating(w, t) {
  w.root.position.copy(w.home);
  w.root.position.y += Math.sin(t * 2 + w.home.x * 5) * 0.015;
  if (w.def.shield) w.root.rotation.set(0, w.homeYaw + Math.PI, 0, 'YXZ');
  else if (w.def.bow) w.root.rotation.set(0, w.homeYaw + Math.PI / 2, 0, 'YXZ');
  else w.root.rotation.set(Math.PI / 2 - 0.55, w.homeYaw, 0, 'YXZ'); // Klinge zeigt nach oben, Griff unten
}
function makeLooseW(w, vel = null, angVel = null) {
  freeWeapon(w);
  w.floating = false;
  w.phys = addDynamic(w.root, localBoxOf(w.root), w.def.mass, {
    vel, angVel, angularDamping: 0.4,
    onImpact: (v) => SFX.thud(Math.min(0.5, v / 10)),
    onLost: () => placeOnRack(false)
  });
}
function takeWeapon(w, h) {
  if (h.held) releaseHand(h);
  freeWeapon(w);
  w.floating = false;
  w.holder = h;
  h.held = w;
  w.slide = 0; w.smoothQ = null; w.root.scale.setScalar(1);
  w.gripMode = w.def.melee && hasGrip(h) ? 'grip' : 'ray';
  if (w.grip2) { // Stielwaffe: die Hand bleibt dort am Schaft, wo sie zugegriffen hat
    w.root.updateMatrixWorld(true);
    const ax = w.gb.clone().sub(w.ga).normalize(), L = w.root.worldToLocal(h.point.clone()), t = L.dot(ax);
    if (L.clone().addScaledVector(ax, -t).length() < 0.25) w.slide = clamp(t, -(w.ga.length() - 0.1), 0.45);
  }
  if (w.embed) { // aus dem Gegner ziehen: Wunde blutet
    const e = w.embed.e; w.embed = null;
    if (e.state !== 'dead') { e.bleed = Math.min(2.5, e.bleed + 0.8); burst(w.root.getWorldPosition(new THREE.Vector3()), 0x8a0a0a, 10); SFX.thunk(); }
  }
  SFX.grab();
  pulse(h, 0.5, 40);
}
function weaponNear(h) {
  let best = null, bd = 0.13;
  for (const w of arsenal) {
    if (w.holder || w.thrown || !w.root.visible || w.desk || w.holstered) continue;
    const d = new THREE.Box3().setFromObject(w.root).distanceToPoint(h.point);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}
function releaseHand(h) {
  h.pull = null;
  if (h.arrow) { const a = h.arrow; h.arrow = null; scene.attach(a); addDebris(a, h.vel.clone(), 3); }
  if (h.grip2) { h.grip2.second = null; h.grip2.twoHand = false; h.grip2 = null; return; } // zweite Hand lässt den Schwertgriff los
  if (h.drawing) { bowRelease(h); return; }
  const w = h.held;
  if (!w) return;
  h.held = null;
  w.holder = null;
  // Bogen loslassen: Sehne der anderen Hand ebenfalls lösen
  for (const o of hands) if (o.drawing === w) { o.drawing = null; setBowString(w, null); }
  if (settings.holsters && (renderer.xr.isPresenting || window.__xrTest) && h.vel.length() < 2.2) {
    const S = slotNear(holsters, h.point, 0.2, (S) => fits(S, w));
    if (S) { holster(w, S); pulse(h, 0.6, 40); return; }
  }
  const tv = h.throwVel.clone().multiplyScalar(settings.throwBoost);
  if (tv.length() > 2.6 && state !== 'setup') { launch(w, tv, h.angVel); return; } // im Schwung losgelassen = Wurf
  makeLooseW(w, h.vel.clone(), h.angVel.clone());
}
// Wurf: jede Waffe fliegt und trifft (Spitze voran oder sich überschlagend); landet sie, gilt wieder Physik
function launch(w, vel, angVel) {
  w.thrown = true;
  throwWeapon(w, vel, angVel, (ww, v, info) => {
    ww.thrown = false;
    if (info && info.embed) { ww.embed = info.embed; ww.floating = false; return; }      // steckt im Gegner
    if (info && info.wall) { ww.floating = false; ww.stuckWall = true; return; }          // steckt in Wand/Tisch
    makeLooseW(ww, v || new THREE.Vector3());
  });
}

// ---- Nahkampf: echte Klingenbahn. Hieb (Schneide voran) oder Stich (entlang der Klinge) ----------
const _mb = new THREE.Vector3(), _mt = new THREE.Vector3();
// Klingenpunkte und Geschwindigkeit aktualisieren (auch für Paraden gegen Angriffe der Gegner)
function bladeState(w, dt) {
  const base = w.root.localToWorld(w.base.clone()), tip = w.root.localToWorld(w.tip.clone());
  const pb = w.prevBase, pt = w.prevTip;
  w.prevBase = base; w.prevTip = tip;
  w.gA = w.root.localToWorld(w.ga.clone()); w.gB = w.root.localToWorld(w.gb.clone()); // ganzer Schaft/ganze Klinge: fängt Schläge ab
  if (!pt || dt <= 0 || w.lost) { w.tipSpeed = 0; w.tipVel.set(0, 0, 0); w.lost = false; return null; }
  w.tipVel.copy(tip).sub(pt).divideScalar(dt);
  w.tipSpeed = w.tipVel.length();
  (w.baseVel || (w.baseVel = new THREE.Vector3())).copy(base).sub(pb).divideScalar(dt);
  return { base, tip, pb, pt };
}
// Ein Schwung beginnt, wenn die Klinge nach einer Ruhephase wieder schnell wird. Innerhalb eines Schwungs
// trifft sie jeden Gegner höchstens einmal – kann aber mehrere Gegner nacheinander treffen.
function swingTrack(w, dt) {
  const slow = w.tipSpeed < w.def.melee.minSpeed * 0.6;
  w.slowT = slow ? (w.slowT || 0) + dt : 0;
  if (w.slowT > 0.08 || !w.swingHits) { w.swingHits = new Set(); w.swingBlocked = false; }
}
const _cv = new THREE.Vector3();
// Vektor a→b auf dem Bogen überblenden (Richtung kugelförmig, Länge linear)
const _pv = new THREE.Vector3(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3(), _sq = new THREE.Quaternion(), _u0 = new THREE.Vector3(), _u1 = new THREE.Vector3();
function slerpLen(a, b, k, out) {
  const la = a.length(), lb = b.length();
  if (la < 1e-5 || lb < 1e-5) return out.lerpVectors(a, b, k);
  _u0.copy(a).divideScalar(la); _u1.copy(b).divideScalar(lb);
  if (_u0.dot(_u1) < -0.98) return out.lerpVectors(a, b, k);
  _sq.setFromUnitVectors(_u0, _u1);
  return out.copy(_u0).applyQuaternion(_sq.identity().slerp(_sq.setFromUnitVectors(_u0, _u1), k)).multiplyScalar(la + (lb - la) * k);
}
function meleeUpdate(w, dt, h) {
  const s = bladeState(w, dt);
  const pivPrev = w.prevPivot; w.prevPivot = w.root.position.clone(); w.prevPiv = pivPrev;
  if (!s || state === 'setup') return;
  if (w.tipSpeed > 28) return; // Tracking-Sprung (Controller kurz verloren): kein Hieb
  swingTrack(w, dt);
  pommelStrike(w, dt, h);
  if (w.swingBlocked) return; // dieser Schwung wurde schon abgefangen
  const M = w.def.melee, kind = M.kind;
  const axis = s.tip.clone().sub(s.base).normalize();
  const along = w.tipVel.dot(axis), baseAlong = w.baseVel.dot(axis);
  // Bewegung entlang der Klinge/des Schafts = Stich (nur Klingen und Speer)
  const easy = M.thrustEasy ? 0.7 : 1; // Rapier: schon kleine Stoßbewegungen zählen als Stich
  const thrust = (kind === 'blade' || kind === 'spear') && along > 0.9 * easy && baseAlong > 0.6 * easy && along > w.tipSpeed * 0.72 * easy;
  if (!thrust && w.tipSpeed < M.minSpeed) { bindUpdate(w, s, dt, h); return; } // langsam: vielleicht Klinge an Klinge drücken
  // Bahn seit dem letzten Bild in kleinen Schritten prüfen (kontinuierliche Kollision: schnelle Hiebe gehen nicht hindurch)
  // Zwischenstellungen auf dem Bogen um die Hand (nicht geradlinig) – sonst „schneidet“ ein schneller Hieb die Kurve ab
  const piv0 = w.prevPiv || w.root.position, piv1 = w.root.position;
  const n = clamp(Math.ceil(s.tip.distanceTo(s.pt) / 0.04), 1, 10);
  let hit = null;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    _pv.lerpVectors(piv0, piv1, k);
    _d0.subVectors(s.pb, piv0); _d1.subVectors(s.base, piv1); slerpLen(_d0, _d1, k, _mb).add(_pv);
    _d0.subVectors(s.pt, piv0); _d1.subVectors(s.tip, piv1); slerpLen(_d0, _d1, k, _mt).add(_pv);
    hit = strikeTest(_mb, _mt, kind === 'blunt' ? 0.04 : 0.012);
    if (hit && (hit.kind !== 'body' || !w.swingHits.has(hit.e))) break;
    hit = null;
  }
  if (!hit) return;
  // Geschwindigkeit genau am Kontaktpunkt: nahe am Griff trifft es viel schwächer als mit der Spitze
  const u = clamp(hit.point.clone().sub(s.base).dot(axis) / Math.max(0.05, s.tip.distanceTo(s.base)), 0, 1);
  _cv.lerpVectors(w.baseVel, w.tipVel, u);
  const cSpeed = _cv.length();
  const two = w.twoHand ? 1 : 0, grip = w.def.needTwo && !two ? 0.6 : 1; // Kriegshammer einhändig: schwach
  const tired = player.stam < 15 ? 0.75 : 1;                            // erschöpft: schwächere Treffer
  const sp = clamp(cSpeed / 3.2, 0.3, 1.7);
  let type, power, flat = false, pen = M.kind === 'blade' && !M.thrustEasy ? 0 : M.pen || 0;
  if (thrust) { type = 'thrust'; power = M.thrust * clamp(along / 1.8, 0.6, 1.6) * (1 + 0.2 * two); }
  else if (kind === 'blunt') { type = 'blunt'; power = M.blunt * sp * (1 + 0.25 * two) * grip; }
  else if (kind === 'spear') { type = 'slash'; power = M.slash * sp; } // quer mit der Speerspitze: schwach
  else {
    const perp = _cv.clone().addScaledVector(axis, -_cv.dot(axis));
    const edge = w.edge.clone().transformDirection(w.root.matrixWorld);
    const align = perp.lengthSq() > 1e-6 ? Math.abs(perp.normalize().dot(edge)) : 1; // 1 = Schneide voran, 0 = flache Seite
    flat = align < 0.45;
    type = flat || u < 0.12 ? 'blunt' : 'slash'; // flache Seite oder Parierstange: stumpfer Treffer
    power = M.slash * sp * (flat ? 0.45 : 0.55 + 0.45 * align) * (1 + 0.3 * two);
    if (kind === 'blade') power *= 0.35 + 0.65 * Math.min(1, u / 0.6); // Hebel: am Klingenansatz (Forte) schneidet es kaum, im vorderen Drittel voll
  }
  power *= tired;
  if (type === 'slash' && M.cut) power *= M.cut;                 // Säbel: besonders gute Schneide
  if (w.def.oneHandWeak && !w.twoHand) power *= 0.6;              // Zweihänder einhändig: Notführung
  if (thrust && M.pen) pen = M.pen;
  const dir = (cSpeed > 0.1 ? _cv.clone() : w.tipVel.clone()).normalize();
  if (hit.kind !== 'body') { // Schild oder Waffe des Gegners im Weg: der Schwung ist abgefangen
    w.swingBlocked = true;
    enemyBlocked(hit, h, (M.shield || 3) * sp, power, dir, w);
    stopWeapon(w); kickWeapon(w, 0.2);
    return;
  }
  w.swingHits.add(hit.e);
  const r = applyHit(hit.e, hit.zone, { type, power, pen: flat ? 0 : pen, knockdown: !!M.knock && !!two && sp > 0.85, dir, point: hit.point, knock: w.def.mass > 1.3 ? 1.2 : 0.5 });
  onEnemyHit(hit, r, { type, flat });
  kickWeapon(w, r.armor ? 0.22 : 0.08);
  if (h) pulse(h, r.killed ? 1 : r.armor ? 0.9 : 0.4 + 0.4 * sp / 1.7, r.killed ? 100 : 55);
  if (w.second) pulse(w.second, 0.6, 50);
  useStamina(power > 30 ? 4 : 2);
}
// Bindung: Klinge liegt an der gegnerischen Waffe und wird langsam gedrückt → seine Deckung wird mitgeschoben
function bindUpdate(w, s, dt, h) {
  if (!s || w.def.melee.kind === 'blunt' || w.tipSpeed < 0.15 || dt <= 0) return;
  const b = bindTest(s.base, s.tip);
  if (!b) { w.binding = null; return; }
  if (!w.binding) { w.binding = b.e; SFX.click(2600, 0.25, 0.05); if (h) pulse(h, 0.4, 30); } // Klingen berühren sich
  const push = w.tipVel.clone().multiplyScalar(dt * (w.twoHand ? 1.4 : 1));
  if ((frameNo & 3) === 0 && h) pulse(h, 0.15, 15);
  if (bindPush(b.e, push, dt) === 'beaten') { SFX.clang(); if (h) pulse(h, 0.8, 60); teamOpening(null); }
}
// Morgenstern: die Kugel trifft, wenn sie schnell genug schwingt – auch über den Rand von Schilden hinweg
function flailUpdate(w, dt, h) {
  const seg = updateChain(w, dt, scene);
  if (!seg || !(w.holder || w.desk) || state === 'setup' || dt <= 0) return;
  const F = w.def.flail, speed = seg.a.distanceTo(seg.b) / dt;
  w.flailSpeed = speed;
  w.ballSlow = speed < 1.5 ? (w.ballSlow || 0) + dt : 0;
  if (w.ballSlow > 0.15 || !w.ballHits) w.ballHits = new Set();
  if (speed < F.minSpeed || speed > 30) return;
  if (speed > F.minSpeed * 1.4 && !w.ballWhoosh) { w.ballWhoosh = true; SFX.whoosh(); } else if (speed < F.minSpeed) w.ballWhoosh = false;
  const hit = strikeTest(seg.a, seg.b, F.ballR + 0.015, true);
  if (!hit || w.ballHits.has(hit.e)) return;
  w.ballHits.add(hit.e);
  const dir = seg.b.clone().sub(seg.a).normalize(), power = F.blunt * clamp(speed / 6, 0.4, 1.7) * (player.stam < 15 ? 0.75 : 1);
  if (hit.kind === 'shield') { // schlägt über den Rand: Schild nimmt Schaden, dahinter trifft es gedämpft
    enemyBlocked(hit, h, F.shield * clamp(speed / 6, 0.4, 1.5), power, dir, w);
    const r = applyHit(hit.e, 'torso', { type: 'blunt', power: power * 0.5, pen: F.pen, dir, point: hit.point, knock: 1 });
    onEnemyHit({ e: hit.e, zone: 'torso', point: hit.point }, r, { type: 'blunt' });
    if (settings.popups && !r.killed) floatingText('Über den Schild!', hit.point.clone().add(new THREE.Vector3(0, 0.3, 0)), '#7dffa8');
  } else if (hit.kind !== 'body') enemyBlocked(hit, h, 3, power, dir, w);
  else {
    const r = applyHit(hit.e, hit.zone, { type: 'blunt', power, pen: F.pen, dir, point: hit.point, knock: 1.4 });
    onEnemyHit(hit, r, { type: 'blunt' });
    // Kugel prallt ab
    const C = w.chain, P = C.pts[C.n], Q = C.prev[C.n]; Q.lerp(P, 0.7);
  }
  if (h) pulse(h, 1, 70);
}
// Knaufschlag: Griffende kräftig nach hinten/vorne gestoßen trifft stumpf (Schwert, Dolch, Stielwaffen)
const _pm = new THREE.Vector3();
function pommelStrike(w, dt, h) {
  if (!w.grip2) return;
  const p = w.root.localToWorld(_pm.copy(w.grip2).multiplyScalar(w.def.melee.kind === 'blade' ? 1.25 : 1));
  const prev = w.prevPommel;
  w.prevPommel = p.clone();
  if (!prev || w.swingBlocked) return;
  const v = p.clone().sub(prev).divideScalar(dt), speed = v.length();
  if (speed < 2.2) return;
  const back = w.tip.clone().sub(w.base).normalize().transformDirection(w.root.matrixWorld).negate();
  if (v.dot(back) < speed * 0.5) return; // nur wenn der Knauf voran geht
  const hit = strikeTest(prev, p, 0.03);
  if (!hit || w.swingHits.has(hit.e)) return;
  w.swingHits.add(hit.e);
  if (hit.kind !== 'body') { enemyBlocked(hit, h, 2, 8, v.clone().normalize(), w); w.swingBlocked = true; return; }
  const r = applyHit(hit.e, hit.zone, { type: 'blunt', power: 11 * clamp(speed / 3, 0.6, 1.6), dir: v.clone().normalize(), point: hit.point, knock: 1 });
  onEnemyHit(hit, r, { type: 'blunt' });
  if (settings.popups && !r.killed && !r.notes.length) floatingText('Knaufschlag!', hit.point.clone().add(new THREE.Vector3(0, 0.2, 0)), '#ffd36a');
  if (h) pulse(h, 0.8, 50);
}
// Freie Hand: Faustschlag (schnell) oder Wegdrücken (langsam gegen den Körper des Gegners)
const _fh = new THREE.Vector3();
function freeHandUpdate(h, dt) {
  const prev = h.prevFist;
  h.prevFist = h.point.clone();
  if (!prev || h.held || h.drawing || h.grip2 || h.pull || h.arrow || state === 'setup' || dt <= 0) return;
  const v = _fh.subVectors(h.point, prev).divideScalar(dt), speed = v.length();
  if (speed > 25) return;
  if (speed > 2.4) { // Faustschlag
    if (elapsed < (h.fistReady || 0)) return;
    const hit = strikeTest(prev, h.point, 0.05);
    if (!hit) return;
    h.fistReady = elapsed + 0.35;
    if (hit.kind !== 'body') { SFX.thud(0.5); pulse(h, 1, 60); playerHit({ dmg: 2, zone: 'arm', type: 'blunt', name: 'Faust gegen Stahl' }); return; }
    const r = applyHit(hit.e, hit.zone, { type: 'blunt', power: 7 * clamp(speed / 3, 0.7, 1.6), dir: v.clone().normalize(), point: hit.point, knock: 1.2 });
    onEnemyHit(hit, r, { type: 'blunt' });
    pulse(h, 0.9, 60);
    useStamina(3);
  } else if (speed > 0.25) { // Wegdrücken: Hand am Rumpf des Gegners und in seine Richtung bewegt
    for (const e of enemies) {
      if (e.state !== 'fight' || e.down) continue;
      const c = e.torso.localToWorld(_pm.set(0, 0.25, 0));
      if (c.distanceTo(h.point) > 0.24) continue;
      const toE = c.clone().sub(h.point).setY(0).normalize();
      const push = v.clone().setY(0).dot(toE);
      if (push > 0.2) { pushEnemy(e, toE, push * dt); if ((frameNo & 3) === 0) pulse(h, 0.3, 20); }
    }
  }
}
// Ausdauer des Spielers: Blocks und Treffer kosten etwas; sie kommt schnell zurück
function useStamina(n) { player.stam = Math.max(0, player.stam - n); staminaT = 1.0; }
let staminaT = 0;
// Der Gegner hat mit Schild oder Klinge abgefangen
function enemyBlocked(hit, h, shieldDmg = 3, power = 10, dir = null, w = null) {
  SFX.clang();
  sparks(hit.point, tmpV.subVectors(headPos, hit.point).normalize(), 8);
  if (h) pulse(h, 1, 80);
  let text = null, color = '#cfd8e3';
  if (hit.kind === 'weapon') { // Klinge an Klinge: Waffe des Gegners wegschlagen, oder es prallt ab
    const res = beatWeapon(hit.e, power, dir || tmpV2.subVectors(hit.point, headPos).normalize());
    if (res === 'disarmed') { text = 'Entwaffnet!'; color = '#7dffa8'; }
    else if (res === 'beaten') { text = 'Klinge weggeschlagen!'; color = '#7dffa8'; }
    else if (res === 'clash') text = 'Klingen prallen aufeinander';
    else { text = 'Abgelenkt'; if (w) kickWeapon(w, 0.35); }
    useStamina(3);
  } else {
    // Schild nimmt Schaden – Äxte und Hämmer zertrümmern ihn
    const broke = hit.kind === 'shield' && hitShield(hit.e, shieldDmg, hit.point);
    if (!broke) text = hit.kind === 'shield' ? (shieldDmg >= 20 ? 'Schild splittert!' : 'Schild!') : 'Pariert!';
    if (hit.e.cool > 0.25 && Math.random() < 0.6) hit.e.cool = 0.25; // er nutzt die Gelegenheit zum Gegenangriff …
    teamOpening(hit.e);                                              // … und seine Verbündeten ebenfalls
  }
  if (text && settings.popups) floatingText(text, hit.point.clone().add(new THREE.Vector3(0, 0.2, 0)), color);
}
// Treffer-Rückmeldung (Nahkampf, Pfeil, Wurf, Schildstoß)
function onEnemyHit(hit, r, info = {}) {
  if (r.armor) SFX.clang(); else SFX.thunk();
  SFX.marker(r.killed, hit.zone === 'head');
  if (!settings.popups || r.killed || r.notes.length) return;
  const at = hit.point.clone().add(new THREE.Vector3(0, 0.2, 0));
  if (r.armor) floatingText(info.type === 'slash' ? 'Hieb gleitet an der Rüstung ab' : 'Rüstung hält', at, '#cfd8e3');
  else if (info.flat) floatingText('Flache Seite', at, '#cfd8e3');
}
// ---- Schild des Spielers: Schildstoß (schnell nach vorne gestoßen) ---------------------------------
function shieldUpdate(w, dt, h) {
  const c = w.root.localToWorld(w.center.clone());
  if (w.prevC && dt > 0) w.cVel.copy(c).sub(w.prevC).divideScalar(dt);
  w.prevC = c;
  if (state === 'setup' || elapsed < w.bashUntil) return;
  const n = w.normal.clone().transformDirection(w.root.matrixWorld);
  const v = w.cVel.dot(n);
  if (v < (w.def.shield.buckler ? 1.2 : 1.6)) return;
  for (const e of enemies) {
    if (e.state === 'dead') continue;
    const chest = e.torso.localToWorld(new THREE.Vector3(0, 0.3, 0));
    if (chest.distanceTo(c) > 0.55 || n.dot(tmpV3.subVectors(chest, c)) < 0.05) continue;
    w.bashUntil = elapsed + 0.6;
    if (e.shield && e.shield.getWorldPosition(tmpV3).distanceTo(c) < 0.5) { // Schild auf Schild
      SFX.clang(); e.stagger = Math.max(e.stagger, 0.35);
      sparks(c, n, 6);
    } else {
      const r = shoveEnemy(e, n.clone().setY(0).normalize(), clamp(v / 2, 0.8, 1.6), chest);
      SFX.thud(0.6);
      onEnemyHit({ e, zone: 'torso', point: chest }, r, { type: 'blunt' });
    }
    if (h) pulse(h, 1, 90);
    break;
  }
}

// ---- Bogen: Sehne mit der freien Hand greifen, ziehen, loslassen ----------------------
function bowUpdate(h) {
  const w = h.drawing;
  if (w.def.crossbow) { // Armbrust: Sehne zurückziehen, bis sie einrastet
    const pull = xbowPull(w, h.point);
    if (Math.floor(pull * 6) !== Math.floor(w.draw * 6) && pull > w.draw) { pulse(h, 0.3 + pull * 0.5, 25); SFX.click(250 + pull * 300, 0.15, 0.03); }
    w.draw = pull;
    if (pull >= 0.97) { w.loaded = true; h.drawing = null; w.draw = 0; SFX.click(1400, 0.4, 0.04); SFX.thunk(); pulse(h, 1, 60); if (w.holder) pulse(w.holder, 0.6, 40); }
    setXbowString(w, w.loaded ? 1 : pull);
    return;
  }
  const gripW = w.root.localToWorld(w.grip.clone());
  const dist = h.point.distanceTo(gripW);
  const draw = clamp((dist - 0.12) / 0.5, 0, 1);
  if (Math.floor(draw * 8) !== Math.floor(w.draw * 8) && draw > w.draw) { pulse(h, 0.15 + draw * 0.3, 15); SFX.click(300 + draw * 400, 0.12, 0.02); }
  w.draw = draw;
  setBowString(w, h.point);
}
function bowRelease(h) {
  const w = h.drawing;
  h.drawing = null;
  if (!w) return;
  if (w.def.crossbow) { w.draw = 0; setXbowString(w, w.loaded ? 1 : 0); return; }
  const gripW = w.root.localToWorld(w.grip.clone());
  const dir = gripW.clone().sub(h.point).normalize();
  if (w.draw > 0.12) {
    shootArrow(h.point.clone(), dir, 8 + 34 * w.draw);
    notifyShot(h.point, dir);
    if (w.holder) pulse(w.holder, 0.5, 40);
  }
  w.draw = 0;
  setBowString(w, null);
}
// Armbrust abdrücken: schwerer Bolzen, durchschlägt einen Teil der Rüstung
function fireCrossbow(w, h, o = null, d = null) {
  if (!w.loaded) return;
  o = o || w.root.localToWorld(w.muzzle.clone());
  d = d || new THREE.Vector3(0, 0, -1).transformDirection(w.root.matrixWorld);
  shootArrow(o, d, 46, { bolt: true, power: 62, pen: 0.45 });
  notifyShot(o, d);
  w.loaded = false;
  setXbowString(w, 0);
  SFX.thunk();
  if (h) pulse(h, 1, 90);
}

// ---- Spieler: Leben, Treffer, Block-Rückmeldung ----------------------------------------------
let playerHp = 100, regenT = 0, hurtFlash = 0, kills = 0, roundT = 0, lastResult = null, heartT = 0;
const hurtMesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xaa0000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, toneMapped: false }));
hurtMesh.renderOrder = 2000;
hurtMesh.visible = false;
camera.add(hurtMesh);
// Richtungsanzeige: roter Bogen zeigt, von wo der Treffer kam
const dirIndicator = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 80, 128, 128, 126);
  g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(0.6, 'rgba(255,20,20,0.9)'); g.addColorStop(1, 'rgba(255,0,0,0)');
  ctx.strokeStyle = g; ctx.lineWidth = 40;
  ctx.beginPath(); ctx.arc(128, 128, 104, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.stroke();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
  m.position.set(0, 0, -0.5);
  m.renderOrder = 2002;
  m.visible = false;
  camera.add(m);
  return m;
})();
function showHitDirection(from) {
  const v = from.clone();
  getViewCamera().worldToLocal(v);
  dirIndicator.rotation.z = Math.atan2(-v.x, -v.z);
  dirIndicator.material.opacity = 1;
  dirIndicator.visible = true;
}
// Bodenhöhe unter dem Spieler (steht er auf dem Bett/Tisch?)
function playerFloor() {
  const g = groundAt(headPos.x, headPos.z);
  return g > 0 && headPos.y - g > 1.0 ? g : 0;
}
// Ein Angriff hat den Spieler getroffen. info: { dmg, zone, e, type, name, point, from }
function playerHit(info) {
  if (state !== 'playing' && state !== 'menu') return;
  if (info.from) showHitDirection(info.from);
  hurtFlash = info.zone === 'head' ? 1.4 : 1;
  regenT = 5;
  SFX_PLAYER.hurt();
  if (info.type === 'blunt') SFX.thud(0.7);
  for (const h of hands) pulse(h, 1, info.zone === 'head' ? 220 : 150);
  if (settings.popups && info.name) floatingText(`${info.name}${info.zone === 'head' ? ' – Kopf!' : info.zone === 'legs' ? ' – Bein' : ''}`, inFront(0.9, 0, headPos.y - 0.28), '#ff8a7a');
  playerHp -= info.dmg;
  if (playerHp > 0) return;
  if (state === 'menu') { // Übung/Duell im Menü: niemand stirbt
    playerHp = 100;
    floatingText('Das wäre dein Ende gewesen', inFront(1, 0, headPos.y), '#ff6a5a');
    for (const e of enemies) e.stagger = Math.max(e.stagger, 1.2);
    return;
  }
  playerHp = 0;
  later(0, () => endRound(true));
}
// Ein Angriff wurde vom Spieler abgefangen. how: shield | parry (aktiv) | block (nur hingehalten) | weak | deflect
function playerBlocked(info) {
  const w = info.w, h = w && w.holder;
  const n = tmpV.subVectors(headPos, info.point).normalize();
  kickWeapon(w, info.how === 'weak' ? 0.4 : 0.25);
  const pw = info.power || 12;
  if (info.how === 'shield') {
    SFX.clang(); SFX.thud(0.5); sparks(info.point, n, 10); pulse(h, info.heavy ? 1 : 0.85, info.heavy ? 150 : 90);
    useStamina(info.perfect ? 2 : pw * (info.heavy ? 0.9 : 0.6));
    if (info.perfect && settings.popups) floatingText('Schild-Parade!', info.point.clone().add(new THREE.Vector3(0, 0.15, 0)), '#7dffa8');
  } else if (info.how === 'parry') {
    SFX.clang(); SFX.pin(); sparks(info.point, n, info.perfect ? 22 : 14); pulse(h, 1, info.perfect ? 110 : 70);
    useStamina(info.perfect ? 0 : pw * 0.35);
    if (settings.popups) floatingText(info.perfect ? 'Perfekte Parade!' : 'Parade!', info.point.clone().add(new THREE.Vector3(0, 0.15, 0)), '#7dffa8');
  } else if (info.how === 'block') { SFX.clang(); sparks(info.point, n, 6); pulse(h, 0.75, 60); useStamina(pw * 0.8); kickWeapon(w, 0.4); }
  else if (info.how === 'weak') {
    SFX.clang(); SFX.thud(0.6); pulse(h, 1, 140); useStamina(pw);
    if (settings.popups) floatingText('Durchgeschlagen!', info.point.clone().add(new THREE.Vector3(0, 0.15, 0)), '#ffb04a');
  } else if (info.how === 'deflect') { SFX.clang(); sparks(info.point, n, 6); pulse(h, 0.7, 40); }
  else if (info.how === 'kicked') { // Tritt gegen den Schild: er deckt einen Moment lang nicht
    SFX.thud(0.8); pulse(h, 1, 200);
    if (settings.popups) floatingText('Schild weggetreten!', info.point.clone().add(new THREE.Vector3(0, 0.2, 0)), '#ffb04a');
  }
  if (w && w.second) pulse(w.second, 0.7, 60);
}
Object.assign(player, {
  hit: playerHit,
  blocked: playerBlocked,
  arrowStuck(obj, w) { // Pfeil bleibt im Schild stecken
    w.root.attach(obj);
    w.stuck.push(obj);
    if (w.stuck.length > 6) w.root.remove(w.stuck.shift());
    SFX.thunk();
    pulse(w.holder, 0.8, 60);
  },
  defeated(e, how) {
    kills++;
    if (how === 'fled' && settings.popups) floatingText(`${e.name} ist geflohen`, inFront(1.2, 0, headPos.y), '#9ad');
  }
});
// Kopf, Schilde und Klingen des Spielers für die Gegner bereitstellen (jedes Bild)
const lastHead = new THREE.Vector3();
function updateDefense(dt) {
  if (dt > 0) player.vel.lerp(tmpV.subVectors(headPos, lastHead).divideScalar(dt), 0.2);
  lastHead.copy(headPos);
  player.head.copy(headPos);
  player.floor = playerFloor();
  player.shields.length = 0; player.blades.length = 0;
  for (const w of arsenal) {
    if (!(w.holder || w.desk)) continue;
    if (w.def.shield) player.shields.push({ c: w.root.localToWorld(w.center.clone()), n: w.normal.clone().transformDirection(w.root.matrixWorld), r: w.def.shield.r, w });
    else if (w.def.melee && w.prevTip) player.blades.push({ a: w.gA, b: w.gB, vel: w.tipVel, speed: w.desk ? (deskGuard && elapsed - deskGuardT < 0.4 ? 2 : 0) : w.tipSpeed, twoHand: w.twoHand, w });
  }
  // Zielt der Spieler mit Bogen oder Armbrust? (Gegner heben dann den Schild oder laufen im Zickzack)
  player.aim = null; player.ranged = false;
  getViewCamera().getWorldDirection(player.look);
  for (const w of arsenal) {
    if (!(w.holder || w.desk) || !w.def.bow) continue;
    player.ranged = true;
    if (w.desk) { if (w.def.crossbow ? w.loaded : deskDrawing && deskDraw > 0.3) { raycaster.setFromCamera(mouseNdc, camera); player.aim = { o: raycaster.ray.origin.clone(), d: raycaster.ray.direction.clone() }; } }
    else if (w.def.crossbow) { if (w.loaded) player.aim = { o: w.root.localToWorld(w.muzzle.clone()), d: new THREE.Vector3(0, 0, -1).transformDirection(w.root.matrixWorld) }; }
    else { const h = hands.find(x => x.drawing === w); if (h && w.draw > 0.3) player.aim = { o: h.point.clone(), d: w.root.localToWorld(w.grip.clone()).sub(h.point).normalize() }; }
  }
  // PC: der Klick-Schwung zählt als heranfliegende Klinge (damit Gegner darauf reagieren können)
  if (deskW && deskW.deskHitT > 0 && deskW.deskRay) {
    const R = deskW.deskRay, reach = deskW.def.reach * (1 - deskW.deskHitT / 0.2 * 0.45);
    player.blades.push({ a: R.o.clone().addScaledVector(R.d, 0.25), b: R.o.clone().addScaledVector(R.d, reach), vel: R.d.clone().multiplyScalar(5), speed: 5, twoHand: false, w: deskW });
  }
}
function updatePlayer(dt) {
  hurtFlash = Math.max(0, hurtFlash - dt * 1.5);
  const low = state === 'playing' && playerHp < 35 ? (0.35 - playerHp / 100) * (0.6 + 0.4 * Math.sin(elapsed * 6)) : 0;
  hurtMesh.material.opacity = Math.min(0.6, hurtFlash * 0.45 + low);
  hurtMesh.visible = hurtMesh.material.opacity > 0.01;
  if (dirIndicator.visible) { dirIndicator.material.opacity -= dt * 0.9; if (dirIndicator.material.opacity <= 0) dirIndicator.visible = false; }
  if (state !== 'playing' && state !== 'menu') return;
  regenT -= dt;
  if (regenT <= 0 && playerHp < 100) playerHp = Math.min(100, playerHp + dt * 3);
  staminaT -= dt;
  if (staminaT <= 0) player.stam = Math.min(100, player.stam + dt * 22);
  if (state === 'playing' && playerHp < 35) { heartT -= dt; if (heartT <= 0) { heartT = 0.9; SFX_PLAYER.heartbeat(); } }
}

// ---- Anzeige: Leben & besiegte Gegner (VR: am Handgelenk, PC: unten links) --------
const hud = makePanel(0.13, 0.05, 2400);
hud.mesh.renderOrder = 6;
hud.mesh.visible = false;
scene.add(hud.mesh);
let hudKey = '';
let fpsEma = 0, fpsShown = 0;
function updateHud() {
  const show = state === 'playing' || settings.fps;
  if (prof.lastDt > 0) fpsEma += (1 / prof.lastDt - fpsEma) * 0.05;
  if (Math.abs(fpsEma - fpsShown) >= 1) fpsShown = Math.round(fpsEma);
  const txt = `❤ ${Math.ceil(playerHp)}  ⚡ ${Math.round(player.stam)}  ⚔ ${kills}` + (settings.fps ? `  ${fpsShown} fps` : '');
  if (!renderer.xr.isPresenting) {
    statusEl.style.display = show || enemies.length ? 'block' : 'none';
    statusEl.textContent = `${txt}\n${deskW ? deskW.def.icon + ' ' + deskW.def.name : 'keine Waffe'}${deskShield ? ' + 🛡 Schild' : ''}\n1–9, 0 Waffen · Klick Hieb/Schlag · E Stich · Leertaste Deckung · F werfen · Q Waffen-Menü`;
    hud.mesh.visible = false;
    return;
  }
  statusEl.style.display = 'none';
  const h = hands.find(x => x.src && x.handedness === 'left') || hands.find(x => x.src);
  hud.mesh.visible = show && !!h;
  if (!hud.mesh.visible) return;
  hud.mesh.position.copy(h.point).add(tmpV.set(0, 0.07, 0.05).applyQuaternion(h.quat));
  hud.mesh.lookAt(headPos);
  if (txt === hudKey) return;
  hudKey = txt;
  hud.draw((ctx, cw, ch) => { panelBg(ctx, cw, ch, 22, playerHp < 35 ? '#ff5a5a' : '#ffcc33'); text(ctx, txt, cw / 2, ch / 2 + 4, 64, '#fff', 'center', true); });
}

// ---- Waffen jedes Bild aktualisieren ---------------------------------------------------
// ---- Haltung der Waffe in der Hand ---------------------------------------------------------------
// Nahkampfwaffen sitzen im Griff-Raum der Hand (Handfläche, Klinge verlängert die Faust) – mit einstellbarem
// Griffwinkel. Bogen, Armbrust und Schild richten sich nach dem Zeigestrahl.
const _hm = new THREE.Matrix4(), _hr = new THREE.Matrix4(), _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _ax = new THREE.Vector3();
function holdTarget(w, h) {
  const ang = THREE.MathUtils.degToRad(settings.gripAngle || 0);
  // Der Raum (Handfläche oder Zeigestrahl) wird beim Greifen festgelegt – fällt er kurz aus, bleibt die Waffe stehen
  const useGrip = w.gripMode === 'grip';
  if (useGrip ? !h.grip.visible : !h.ray.visible) { w.lost = true; return false; }
  if (w.def.melee && useGrip) _hm.copy(h.grip.matrixWorld).multiply(_hr.makeRotationX(-w.tilt0 + ang));
  else { _hm.multiplyMatrices(h.ray.matrixWorld, HOLD_OFFSET); if (w.def.melee && ang) _hm.multiply(_hr.makeRotationX(ang)); }
  if (w.slide) { _ax.copy(w.gb).sub(w.ga).normalize().multiplyScalar(-w.slide); _hm.multiply(_hr.makeTranslation(_ax.x, _ax.y, _ax.z)); }
  _hm.decompose(_hp, _hq, tmpS);
  return true;
}
function poseHeld(w, dt) {
  const h = w.holder;
  if (!holdTarget(w, h)) { w.prevTip = w.prevBase = w.prevPommel = null; return; }
  // Gewicht: schwere Waffen folgen der Drehung der Hand etwas träge (beidhändig doppelt so schnell)
  const wt = settings.weight * (w.def.melee ? 1 : 0.4);
  if (wt > 0 && w.smoothQ && dt > 0) {
    const mass = w.def.mass * (w.def.oneHandWeak && !w.twoHand ? 1.6 : 1);
    const rate = 32 / (mass * wt) * (w.twoHand ? 2 : 1);
    w.smoothQ.slerp(_hq, 1 - Math.exp(-dt * rate));
  } else w.smoothQ = (w.smoothQ || new THREE.Quaternion()).copy(_hq);
  w.root.position.copy(_hp);
  w.root.quaternion.copy(w.smoothQ);
  // Kontakt: trifft die Klinge Schild oder Waffe, bleibt sie dort kurz stehen und folgt der Hand dann federnd –
  // die echte Hand bewegt sich frei weiter, nur die virtuelle Waffe wird begrenzt
  if (w.contactT > 0 && w.contactQ) {
    w.contactT = Math.max(0, w.contactT - dt);
    const k = 1 - w.contactT / 0.18;
    w.root.quaternion.copy(w.contactQ).slerp(w.smoothQ, k * k);
    if (w.smoothQ) w.smoothQ.copy(w.root.quaternion);
  }
  // zweite Hand: Schwert, Hammer, Speer beidhändig – die Waffe zeigt von der hinteren zur vorderen Hand
  if (w.second) {
    const d1 = tmpV.subVectors(h.point, w.second.point), len = d1.length();
    w.twoHand = len > 0.07;
    if (w.twoHand) {
      d1.divideScalar(len);
      const d0 = tmpV2.subVectors(w.tip, w.base).normalize().applyQuaternion(w.root.quaternion);
      if (d0.dot(d1) < 0) d1.negate();
      w.root.quaternion.premultiply(tmpQ.setFromUnitVectors(d0, d1));
      w.smoothQ.copy(w.root.quaternion);
    }
  }
  // Rückprall nach einem Treffer oder Block: die Klinge federt kurz zurück
  if (w.kickT > 0) { w.kickT = Math.max(0, w.kickT - dt); w.root.rotateX(w.kickAmt * Math.sin(w.kickT / 0.16 * Math.PI)); }
  w.root.updateMatrixWorld(true);
}
const kickWeapon = (w, amt) => { if (w) { w.kickT = 0.16; w.kickAmt = amt; } };
const stopWeapon = (w) => { if (w && w.holder) { w.contactQ = w.root.quaternion.clone(); w.contactT = 0.18; } };

// ---- Schwung-Spur und Schwung-Geräusch --------------------------------------------------------------
const TRAIL_N = 9;
const trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
function makeTrail() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
  const col = new Float32Array(TRAIL_N * 2 * 3);
  for (let k = 0; k < TRAIL_N; k++) { const a = 0.6 * (k / (TRAIL_N - 1)) ** 1.3; for (const j of [0, 1]) col.set([a, a, a * 1.1], (k * 2 + j) * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const idx = [];
  for (let k = 0; k < TRAIL_N - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  const m = new THREE.Mesh(g, trailMat);
  m.frustumCulled = false; m.renderOrder = 8; m.visible = false;
  scene.add(m);
  return { mesh: m, pts: [] };
}
function trailUpdate(w, h) {
  const fast = w.tipSpeed > w.def.melee.minSpeed * 1.15;
  // Geräusch und leichtes Vibrieren beim kräftigen Schwung
  if (w.tipSpeed > w.def.melee.minSpeed * 1.5 && !w.whoosh) { w.whoosh = true; SFX.whoosh(); }
  else if (w.tipSpeed < w.def.melee.minSpeed * 0.8) w.whoosh = false;
  if (fast && h && (frameNo & 1)) pulse(h, Math.min(0.3, w.tipSpeed / 25), 12);
  if (!settings.trails || w.id === 'stone') return;
  const T = w.trail || (w.trail = makeTrail());
  if (fast && w.prevBase) T.pts.push([w.prevBase.clone(), w.prevTip.clone()]);
  else if (T.pts.length) T.pts.shift();
  while (T.pts.length > TRAIL_N) T.pts.shift();
  T.mesh.visible = T.pts.length > 1;
  if (!T.mesh.visible) return;
  const pos = T.mesh.geometry.attributes.position;
  for (let k = 0; k < TRAIL_N; k++) {
    const P = T.pts[Math.max(0, T.pts.length - TRAIL_N + k)] || T.pts[0];
    pos.setXYZ(k * 2, P[0].x, P[0].y, P[0].z); pos.setXYZ(k * 2 + 1, P[1].x, P[1].y, P[1].z);
  }
  pos.needsUpdate = true;
}
const hideTrail = (w) => { if (w.trail) { w.trail.pts.length = 0; w.trail.mesh.visible = false; } };

// ---- Waffen jedes Bild aktualisieren ---------------------------------------------------
let frameNo = 0;
function updateWeapons(dt) {
  frameNo++;
  for (const w of arsenal) if (w.chain) flailUpdate(w, dt, w.holder);
  for (const w of arsenal) {
    if (w.holstered) { hideTrail(w); continue; }
    if (w.floating) poseFloating(w, elapsed);
    else if (w.holder) {
      poseHeld(w, dt);
      if (w.def.melee) { meleeUpdate(w, dt, w.holder); if (!w.chain) trailUpdate(w, w.holder); }
      else if (w.def.shield) shieldUpdate(w, dt, w.holder);
      continue;
    } else if (w.desk) deskWeaponUpdate(w, dt);
    else if (w.embed && w.embed.e.state === 'dead') { // Gegner fällt: die Waffe rutscht aus der Wunde
      w.embed = null; scene.attach(w.root); makeLooseW(w, new THREE.Vector3(0, 0.5, 0));
    }
    hideTrail(w);
  }
  for (const h of hands) {
    if (h.arrow) { // Pfeil in der Hand: zeigt entlang des Controllers; nahe der Sehne wird er eingelegt
      h.arrow.position.copy(h.point); h.arrow.quaternion.copy(h.quat);
      const bw = otherHand(h).held;
      if (bw && bw.def.bow && !bw.def.crossbow && h.point.distanceTo(bw.model.localToWorld(bw.nock.clone())) < 0.14) {
        scene.remove(h.arrow); h.arrow = null; h.drawing = bw; bw.draw = 0; SFX.click(500, 0.3, 0.05); pulse(h, 0.5, 30); pulse(otherHand(h), 0.3, 20);
      }
    }
    if (h.drawing) bowUpdate(h);
    if (h.src) freeHandUpdate(h, dt);
  }
  // Pull: Waffe fliegt per Laser + Griff-Taste in die Hand
  for (const h of hands) {
    if (!h.pull) continue;
    const w = h.pull.w;
    if (w.phys) { removeDynamic(w.phys); w.phys = null; }
    if (w.embed) { scene.attach(w.root); }
    w.floating = false;
    w.root.position.lerp(h.point, Math.min(1, dt * 9));
    if (w.root.position.distanceTo(h.point) < 0.15) { h.pull = null; takeWeapon(w, h); }
  }
}
// Holster: Körper schätzen, Plätze hervorheben, wenn eine Hand mit passender Waffe (oder leer an einer belegten Stelle) nahe ist
function updateHolsterState(dt) {
  const pts = hands.filter(h => h.src).map(h => h.point);
  getViewCamera().getWorldDirection(tmpV);
  updateHolsters(holsters, dt, headPos, tmpV, pts, { height: settings.height, hipOffset: settings.hipOffset, quiver: settings.quiver, quiverSide: settings.leftHanded ? -1 : 1, show: true });
  for (const S of Object.values(holsters.slots)) {
    let hot = 0;
    for (const h of hands) {
      if (!h.src) continue;
      const d = S.anchor.position.distanceTo(h.point);
      if (S.def.kind === 'quiver') { if (settings.quiver && !h.held && !h.arrow && d < 0.3) hot = 1; continue; }
      if (h.held && fits(S, h.held) && d < 0.35) hot = 1;
      if (!h.held && S.weapon && d < 0.3) hot = 1;
      // spürbares Einrasten: kurze Vibration beim Erreichen der Zone
      const inZone = d < 0.19 && ((h.held && fits(S, h.held)) || (!h.held && (S.weapon || (S.def.kind === 'quiver' && settings.quiver))));
      if (inZone && h.zone !== S.id) { h.zone = S.id; pulse(h, 0.35, 25); }
      else if (!inZone && h.zone === S.id) h.zone = null;
    }
    S.hot = hot;
  }
}
// Sicherheitszone: nähern sich Kopf oder Hände einer eingezeichneten Wand oder einem Möbelstück, leuchtet es rot auf
// (die Linien sind nur ein Hinweis – sie schützen nicht vor dem echten Hindernis)
function updateSafety(dt) {
  const m = settings.safety;
  const pts = [headPos, ...hands.filter(h => h.src).map(h => h.point)];
  for (const s of room.surfaces) {
    if (s.type === 'door' || s.type === 'window') continue;
    let near = 9;
    if (m > 0 && state !== 'setup') for (const p of pts) near = Math.min(near, surfaceDistance(s, p));
    const k = m > 0 && near < m ? 1 - near / m : 0;
    setWarn(s, k);
    if (k > 0.6) for (const h of hands) if (h.src && surfaceDistance(s, h.point) < m * 0.4 && (frameNo & 7) === 0) pulse(h, 0.25, 20);
  }
}
// Waffen am Boden, die ein entwaffneter Gegner aufheben kann (nicht gehaltene, nicht fliegende)
const FLOOR_IDS = { sword: 'sword', dagger: 'dagger', mace: 'mace', axe: 'axe', spear: 'spear' };
player.floorWeapons = () => arsenal.filter(w => FLOOR_IDS[w.id] && w.phys && !w.holder && !w.thrown).map(w => ({
  id: FLOOR_IDS[w.id], pos: w.root.position,
  valid: () => arsenal.includes(w) && !!w.phys && !w.holder,
  take: () => { if (!arsenal.includes(w) || w.holder) return false; removeWeapon(w); return true; }
}));
// Waffen der Gegner, die zu Boden fallen, werden zu Waffen, die du aufheben kannst
const DROP_MAP = { sword: 'sword', dagger: 'dagger', mace: 'mace', club: 'mace', axe: 'axe', spear: 'spear', halberd: 'spear', bow: 'bow', shield: 'shield' };
player.dropped = (item, obj, vel) => {
  const id = DROP_MAP[item];
  if (!id || !arsenal.length && false) return false;
  const w = newWeapon(id);
  obj.getWorldPosition(w.root.position);
  obj.getWorldQuaternion(w.root.quaternion);
  if (!WEAPONS[id].shield) w.root.rotateX(Math.PI / 2); // Gegner-Waffen zeigen entlang +Y, eigene entlang -Z
  w.root.updateMatrixWorld(true);
  makeLooseW(w, vel);
  return true;
};

// =============================================================================
// Spielablauf: Menü → START → Skelette kommen durch Türen & Fenster → Pause/Hauptmenü
// =============================================================================
let state = 'menu';
let spawnT = 0, spawned = 0;

function enterMenu() {
  state = 'menu';
  menuView = 'main';
  clearEnemies();
  clearFlying();
  weaponPanel.visible = false;
  menuPanel.visible = true;
  menuPanel.place(Math.min(1.1, freeDistance(headPos, inFront(1, 0.2, headPos.y).sub(headPos), 1.4) - 0.15), 0.2, -0.15);
  refreshMenu();
}
function refreshMenu() {
  if (menuView === 'settings') { refreshSettings(); return; }
  if (paused) { menuPanel.visible = false; pausePanel.visible = true; refreshPause(); return; } // aus den Einstellungen zurück in die Pause
  const nDoor = surfacesOf('door').length, nWin = surfacesOf('window').length;
  menuPanel.set((ctx, w) => {
    const r = lastResult;
    if (r) text(ctx, `${r.died ? '💀 Du bist gefallen' : 'Runde beendet'} · ${r.kills} Gegner besiegt · ${r.time}`, w / 2, 420, 24, '#ffcc33', 'center', true);
    text(ctx, '🏰 Burg-Abwehr', w / 2, 48, 48, '#fff', 'center', true);
    text(ctx, 'Waffen holen: 🗡 Waffen-Menü (VR: A/X-Taste, PC: Q) – jederzeit, auch im Spiel', w / 2, 470, 20, '#cfd8e3');
    text(ctx, 'Schild/Klinge in den Schlag halten = Block · Klinge entgegenführen = Parade', w / 2, 500, 19, '#cfd8e3');
    text(ctx, 'Hieb mit der Schneide · Stich geht durch Rüstung · Schwert mit beiden Händen fassen', w / 2, 528, 19, '#cfd8e3');
    text(ctx, `Raum: ${surfacesOf('wall').length} Wände · ${nDoor} Türen · ${nWin} Fenster · ${surfacesOf('table', 'chair').length} Möbel`, w / 2, 104, 24, '#9ad', 'center', true);
    text(ctx, nDoor + nWin ? 'Die Angreifer kommen durch deine Türen und Fenster.' : '⚠ Keine Türen/Fenster eingezeichnet – Angreifer tauchen im Raum auf.', w / 2, 140, 22, nDoor + nWin ? '#cfd8e3' : '#ffb04a');
    text(ctx, `Version ${VERSION}`, w - 24, 664, 18, '#6b7a90', 'right');
  }, [
    ...row(180, 70, [{ id: 'start', label: '▶ START', font: 42, onClick: startPressed }], 792, 200),
    ...row(272, 60, [{ id: 'wmenu', label: '🗡 Waffen-Menü', font: 32, onClick: openWeaponMenu }], 792, 200),
    ...row(346, 58, [
      { id: 'room', label: '🧱 Raum einrichten', onClick: enterSetup },
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
  clearEnemies();
  clearFlying();
  clearDebris();
  prepareNav(headPos);
  spawnT = 3; spawned = 0;
  playerHp = 100; kills = 0; roundT = 0; lastResult = null; hudKey = '';
  SFX.ui();
  speak('Sie kommen');
  if (!arsenal.some(w => w.holder || w.desk)) openWeaponMenu(); // noch keine Waffe in der Hand: gleich aussuchen
  else floatingText('Waffen-Menü: A/X (PC: Q) · Pause: Stick oder B/Y (PC: Esc)', inFront(1.2, 0, headPos.y - 0.1), '#ffd36a');
}
function updateGame(dt) {
  updatePlayer(dt);
  updateDefense(dt);
  if (weaponPanel.visible) return; // Waffen-Menü offen: alles steht still
  if (state === 'menu') { updateEnemies(dt); return; } // Übungsgegner und Duelle im Menü
  if (state !== 'playing') return;
  roundT += dt;
  // langsam schwerer: mehr und gefährlichere Gegner, später greifen zwei gleichzeitig an
  combatOpts.tokens = roundT < 50 ? 1 : 2;
  const maxAlive = Math.min(6, 2 + Math.floor(roundT / 40));
  spawnT -= dt;
  if (spawnT <= 0 && aliveCount() < maxAlive) {
    spawnEnemy(headPos, { type: pickType(roundT) });
    spawned++;
    spawnT = THREE.MathUtils.randFloat(4, 7) * Math.max(0.5, 1 - roundT / 280);
  }
  updateEnemies(dt);
}
function endRound(died) {
  if (state !== 'playing') return;
  const m = Math.floor(roundT / 60), sec = Math.floor(roundT % 60);
  lastResult = { died, kills, time: `${m}:${String(sec).padStart(2, '0')} min` };
  speak(died ? 'Du bist gefallen' : 'Runde beendet');
  if (died) SFX.jingle([392, 370, 349, 330, 196], 0.4);
  hurtFlash = died ? 1.5 : 0;
  enterMenu();
}

// =============================================================================
// Waffen-Menü (Untermenü): Waffe aussuchen → kommt in die Hand. Jederzeit über A/X bzw. Q.
// =============================================================================
const weaponPanel = new UIPanel(1.0, 0.98, 760);
weaponPanel.border = '#ffb347';
weaponPanel.visible = false;
let uiClickHand = null; // welche Hand gerade einen Knopf drückt (dorthin kommt die Waffe)
let weaponMsg = '', trainType = 'soldier';
function openWeaponMenu() {
  if (state !== 'playing' && state !== 'menu') return;
  menuPanel.visible = false;
  weaponPanel.visible = true;
  weaponPanel.place(0.75, 0, -0.2);
  weaponMsg = '';
  refreshWeaponMenu();
}
function closeWeaponMenu() {
  weaponPanel.visible = false;
  if (state === 'menu') { menuPanel.visible = true; refreshMenu(); }
  clock.getDelta();
}
function toggleWeaponMenu() { if (weaponPanel.visible) closeWeaponMenu(); else openWeaponMenu(); }
function refreshWeaponMenu() {
  const W = 760, T = ENEMY_TYPES[trainType], xr = renderer.xr.isPresenting;
  weaponPanel.set((ctx, w) => {
    text(ctx, '🗡 Waffen-Menü', w / 2, 36, 38, '#fff', 'center', true);
    text(ctx, xr ? 'Waffe anklicken → sie kommt in die Hand, mit der du klickst. Loslassen an Hüfte/Schulter = ins Holster.' : 'Waffe anklicken → du hast sie in der Hand (Schild links).', w / 2, 76, 17, '#cfd8e3');
    text(ctx, xr ? 'Griff-Taste loslassen = fallen lassen · im Schwung loslassen = werfen · Menü: A/X' : 'Menü auf/zu: Q · Waffen auch mit 1–9, 0 · F = werfen', w / 2, 100, 17, '#9ad');
    text(ctx, 'Übungsgegner – „Passiv“ steht still, „Duell“ kämpft gegen dich:', w / 2, 428, 18, '#9ad');
    if (weaponMsg) text(ctx, weaponMsg, w / 2, 610, weaponMsg.length > 70 ? 14 : 17, '#7dffa8', 'center', true);
    text(ctx, `${arsenal.length} Waffen · ${enemies.length} Gegner im Raum`, w - 24, 718, 15, '#6b7a90', 'right');
  }, [
    ...[0, 1, 2, 3].flatMap(r => row(118 + r * 74, 64, WEAPON_ORDER.slice(r * 4, r * 4 + 4).map(id => ({ id: 'w_' + id, label: `${WEAPONS[id].icon} ${WEAPONS[id].name}`, font: 19, onClick: () => pickWeapon(id) })), W, 24, 10)),
    ...row(442, 52, [
      { id: 'ttype', label: `◀ ${T.name} ▶`, font: 23, onClick: () => { trainType = TYPE_ORDER[(TYPE_ORDER.indexOf(trainType) + 1) % TYPE_ORDER.length]; weaponMsg = ''; refreshWeaponMenu(); } },
      { id: 'dummy', label: '🎯 Passiv', font: 23, onClick: () => { spawnTrainer(true); weaponMsg = `${T.name} steht vor dir – wehrt sich nicht`; refreshWeaponMenu(); } },
      { id: 'duel', label: '⚔ Duell', font: 23, onClick: () => { spawnTrainer(false); weaponMsg = `${T.name} fordert dich – Menü schließen, dann geht es los`; refreshWeaponMenu(); } }
    ], W, 30, 12),
    ...row(504, 48, [
      { id: 'loadout', label: '🎒 Ausrüstung anlegen', font: 20, disabled: !xr || !settings.holsters, onClick: () => { equipLoadout(); weaponMsg = 'Schwert linke Hüfte, Dolch rechte Hüfte, Schild und Bogen auf dem Rücken, Köcher'; refreshWeaponMenu(); } },
      { id: 'fetch', label: '🧲 Waffen herholen', font: 20, disabled: !arsenal.length, onClick: () => { placeOnRack(false); weaponMsg = 'Waffen schweben vor dir'; refreshWeaponMenu(); } }
    ], W, 30, 12),
    ...row(560, 40, [
      { id: 'clearw', label: '🧹 Waffen weg', font: 19, disabled: !arsenal.length, onClick: () => { clearWeapons(); weaponMsg = 'Alle Waffen weggeräumt'; refreshWeaponMenu(); } },
      { id: 'cleare', label: '🧹 Gegner weg', font: 19, disabled: !enemies.length || state === 'playing', onClick: () => { clearEnemies(); weaponMsg = 'Alle Gegner entfernt'; refreshWeaponMenu(); } }
    ], W, 30, 12),
    ...row(636, 58, [{ id: 'close', label: state === 'playing' ? '✔ Los geht’s' : '◀ Zurück', font: 30, onClick: closeWeaponMenu }], W, 230)
  ]);
}
// Standard-Ausrüstung in die Holster legen (Rechtshänder: Schwert links zum Ziehen über Kreuz)
function equipLoadout() {
  const L = settings.leftHanded;
  const put = (id, slot) => { const S = holsters.slots[slot]; if (S.weapon) return; holster(newWeapon(id), S); };
  put('sword', L ? 'hipR' : 'hipL'); put('dagger', L ? 'hipL' : 'hipR'); put('shield', 'backL'); put('bow', 'backR');
}
function pickWeapon(id) {
  const h = uiClickHand;
  giveWeapon(id, h);
  SFX.grab();
  weaponMsg = WEAPONS[id].tip;
  refreshWeaponMenu();
}
// Übungsgegner: „passiv“ steht vor dir und wehrt sich nicht · sonst ein Duell gegen einen kämpfenden Gegner
function spawnTrainer(passive) {
  prepareNav(headPos);
  const p = inFront(passive ? 1.5 : 2.7, -0.5, 0); // etwas rechts (das Menü hängt links)
  return spawnEnemy(headPos, { type: trainType, at: p, passive });
}

// =============================================================================
// Steuerung am PC (zum Testen ohne Brille)
// =============================================================================
const mouseNdc = new THREE.Vector2();
let camYaw = 0, camPitch = -0.2, lookYaw = 0, lookPitch = -0.2, rightDrag = false, lastX = 0, lastY = 0;
const keys = new Set();
let deskW = null, deskShield = null, deskDraw = 0, deskDrawing = false, deskGuard = false, deskGuardT = -9;
// PC: Waffe vor die Kamera nehmen (Schild in die linke Hand, andere Waffen rechts)
function equipDesk(idOrW) {
  const w = typeof idOrW === 'string' ? (arsenal.find(x => x.id === idOrW && !x.thrown) || newWeapon(idOrW)) : idOrW;
  if (!w) return;
  if (w.def.shield) {
    if (deskShield === w) { deskShield = null; placeOnRackOne(w); return; }
    if (deskShield) { const old = deskShield; deskShield = null; placeOnRackOne(old); }
    freeWeapon(w); w.floating = false; w.desk = true; w.root.visible = true;
    camera.add(w.root); w.root.position.set(-0.42, -0.42, -0.62); w.root.rotation.set(0, 0.45, 0);
    deskShield = w; SFX.grab(); return;
  }
  if (deskW) { const old = deskW; deskW = null; placeOnRackOne(old); if (old === w) return; }
  freeWeapon(w); w.floating = false; w.desk = true; w.root.visible = true;
  camera.add(w.root);
  w.root.position.set(0.25, -0.28, -0.45);
  w.root.rotation.set(0, 0, 0);
  w.deskSwing = 0;
  deskW = w;
  SFX.grab();
}
function placeOnRackOne(w, fresh = false) {
  freeWeapon(w);
  w.floating = true;
  w.root.visible = true;
  if (!w.home || fresh) { // freier Platz vor dir (leicht versetzt, falls dort schon etwas schwebt)
    const n = arsenal.filter(x => x.floating && x !== w).length;
    const xr = renderer.xr.isPresenting;
    w.home = inFront(xr ? 0.45 : 1.1, ((n % 5) - 2) * 0.22, xr ? Math.max(0.9, headPos.y - 0.45) : 1.2);
    w.homeYaw = headYaw();
  }
  poseFloating(w, elapsed);
}
// PC-Angriff: Klick = Hieb, E = Stich – jeweils dorthin, wo das Fadenkreuz hinzeigt (Kopf, Arm, Bein …)
function deskAttack(thrust = false) {
  const w = deskW;
  if (!w || !w.def.melee || w.deskSwing > 0) return;
  w.deskSwing = 0.32; w.deskThrust = thrust; w.deskHitT = 0.2;
  raycaster.setFromCamera(mouseNdc, camera);
  w.deskRay = { o: raycaster.ray.origin.clone(), d: raycaster.ray.direction.clone() };
  SFX.whoosh();
}
function deskStrike(w) { // Treffer-Moment des PC-Schwungs
  const R = w.deskRay, M = w.def.flail ? { kind: 'blunt', blunt: w.def.flail.blunt, pen: w.def.flail.pen, shield: w.def.flail.shield } : w.def.melee, kind = M.kind;
  const hit = strikeTest(R.o.clone().addScaledVector(R.d, 0.25), R.o.clone().addScaledVector(R.d, w.def.reach), kind === 'blunt' || w.id === 'sword' ? 0.06 : 0.04, true);
  if (!hit) return;
  const thrust = kind === 'spear' || (kind === 'blade' && w.deskThrust);
  const type = thrust ? 'thrust' : kind === 'blunt' ? 'blunt' : 'slash';
  const power = (thrust ? M.thrust : kind === 'blunt' ? M.blunt * (w.def.needTwo ? 1.25 : 1) : M.slash) * 1.1 * (player.stam < 15 ? 0.75 : 1); // am PC gilt der Hammer als beidhändig geführt
  if (hit.kind !== 'body') { enemyBlocked(hit, null, M.shield || 3, power, R.d.clone(), w); return; }
  const r = applyHit(hit.e, hit.zone, { type, power, pen: M.pen || 0, knockdown: !!M.knock, dir: R.d.clone(), point: hit.point, knock: w.def.mass > 1.3 ? 1.2 : 0.5 });
  onEnemyHit(hit, r, { type });
}
// PC: Haltung der Waffen an der Kamera – Grundstellung, Schwung/Stich, Deckung (Leertaste)
function deskWeaponUpdate(w, dt) {
  if (w.def.shield) {
    if (deskGuard) { w.root.position.lerp(tmpV.set(-0.04, -0.17, -0.46), Math.min(1, dt * 18)); w.root.rotation.set(0, 0, 0); }
    else { w.root.position.lerp(tmpV.set(-0.42, -0.42, -0.62), Math.min(1, dt * 12)); w.root.rotation.set(0, 0.45, 0); }
    // frisch gedrückte Leertaste = Schild dem Schlag entgegenstoßen (für Buckler und Schild-Parade)
    if (deskGuard && elapsed - deskGuardT < 0.3) w.cVel.set(0, 0, -1.6).transformDirection(w.root.matrixWorld).multiplyScalar(1.6); else w.cVel.set(0, 0, 0);
  } else if (w.def.melee) {
    if (w.deskHitT > 0) { w.deskHitT -= dt; if (w.deskHitT <= 0) deskStrike(w); }
    if (w.deskSwing > 0) {
      w.deskSwing -= dt;
      const k = 1 - Math.max(0, w.deskSwing) / 0.32, s = Math.sin(k * Math.PI);
      if (w.deskThrust) { w.root.position.set(0.2, -0.24, -0.45 - 0.4 * s); w.root.rotation.set(-0.5, 0, 0); }
      else { w.root.position.set(0.25, -0.28, -0.45); w.root.rotation.set(-1.4 * s, 0, 0.5 * s); }
    } else if (deskGuard && !deskShield) { w.root.position.lerp(tmpV.set(0.32, 0.2, -0.3), Math.min(1, dt * 18)); w.root.rotation.set(0, Math.PI / 2, 0); } // „Dach“: Klinge quer über dem Kopf
    else { w.root.position.lerp(tmpV.set(0.25, -0.28, -0.45), Math.min(1, dt * 12)); w.root.rotation.set(0, 0, 0); }
  } else return;
  w.root.updateWorldMatrix(true, true);
  if (w.def.melee) bladeState(w, dt);
}
// PC: F wirft die Waffe in der Hand dorthin, wo das Fadenkreuz zeigt
function deskThrow() {
  const w = deskW || deskShield;
  if (!w) return;
  if (w === deskW) deskW = null; else deskShield = null;
  freeWeapon(w);
  raycaster.setFromCamera(mouseNdc, camera);
  w.root.position.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 0.4);
  w.root.updateMatrixWorld(true);
  launch(w, raycaster.ray.direction.clone().multiplyScalar(12).add(new THREE.Vector3(0, 1, 0)), null);
}
function updateDesktopBow(dt) {
  const w = deskW;
  if (!w || !w.def.bow) return;
  if (w.def.crossbow) { // Klick: spannen (dauert) bzw. schießen
    w.root.position.set(0.2, -0.2, -0.45);
    w.root.rotation.set(0, 0, 0);
    if (w.reloadT > 0) { w.reloadT -= dt; if (w.reloadT <= 0) { w.loaded = true; SFX.click(1400, 0.4, 0.04); } }
    setXbowString(w, w.loaded ? 1 : w.reloadT > 0 ? 1 - w.reloadT / 1.2 : 0);
    return;
  }
  if (deskDrawing) deskDraw = Math.min(1, deskDraw + dt / 0.8);
  w.root.position.set(0.3, -0.3, -0.8);
  w.root.rotation.set(0, 0, 0.3);
  setBowString(w, deskDrawing ? w.model.localToWorld(new THREE.Vector3(0, 0, 0.13 + deskDraw * 0.35)) : null);
}
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
  if (!deskW) { // schwebende Waffe anklicken = nehmen
    const ws = arsenal.filter(w => w.floating && w.root.visible);
    const hit = raycaster.intersectObjects(ws.map(w => w.root), true)[0];
    if (hit) { const w = ws.find(x => { let o = hit.object; while (o) { if (o === x.root) return true; o = o.parent; } return false; }); if (w) { equipDesk(w.id); return; } }
  }
  if (deskW && deskW.def.crossbow) {
    if (deskW.loaded) { raycaster.setFromCamera(mouseNdc, camera); fireCrossbow(deskW, null, raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 0.4), raycaster.ray.direction.clone()); }
    else if (!(deskW.reloadT > 0)) { deskW.reloadT = 1.2; SFX.click(300, 0.3, 0.05); }
    return;
  }
  if (deskW && deskW.def.bow) { deskDrawing = true; deskDraw = 0; SFX.click(500, 0.3, 0.05); return; }
  if (state === 'playing' || state === 'menu') deskAttack(false);
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 2) rightDrag = false;
  if (e.button === 0 && setup.drag && setup.drag.src === 'mouse') setupTriggerUp();
  if (e.button === 0 && deskDrawing) {
    deskDrawing = false;
    if (deskW && deskW.def.bow && !deskW.def.crossbow && deskDraw > 0.12) { raycaster.setFromCamera(mouseNdc, camera); shootArrow(raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 0.3), raycaster.ray.direction.clone(), 8 + 34 * deskDraw); notifyShot(raycaster.ray.origin, raycaster.ray.direction); }
    deskDraw = 0;
  }
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (renderer.xr.isPresenting) return;
  if (e.code === 'Escape') { if (paused) setPaused(false); else if (state === 'playing') setPaused(true); return; }
  if (paused) return; // in der Pause keine Spiel-Tasten
  keys.add(e.code);
  if (e.key === 'Enter') startPressed();
  if (state !== 'setup') {
    const n = parseInt(e.key, 10);
    if (n >= 0 && n <= 9 && e.key.length === 1) equipDesk(WEAPON_ORDER[n === 0 ? 9 : n - 1]);
    if (e.key === 'f' || e.key === 'F') deskThrow();
    if (e.key === 'e' || e.key === 'E') deskAttack(true);
    if (e.code === 'Space' && !deskGuard) { deskGuard = true; deskGuardT = elapsed; e.preventDefault(); }
    if ((e.key === 'q' || e.key === 'Q') && (state === 'playing' || state === 'menu')) toggleWeaponMenu();
  }
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'Space') deskGuard = false; });
// PC: mit WASD durch den Raum gehen
function updateDesktopMove(dt) {
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0), s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!f && !s) return;
  const sp = 2 * dt;
  camera.position.x += (-Math.sin(lookYaw) * f + Math.cos(lookYaw) * s) * sp;
  camera.position.z += (-Math.cos(lookYaw) * f - Math.sin(lookYaw) * s) * sp;
}
// PC: auf einen Tisch/ein Bett laufen = draufsteigen (zum Testen des Kletterns)
function updateDesktopHeight(dt) {
  const g = groundAt(camera.position.x, camera.position.z);
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, 1.6 + g, Math.min(1, dt * 8));
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
  clearEnemies();
  deskW = deskShield = null;
  for (const w of arsenal) { freeWeapon(w); w.root.visible = false; w.floating = false; }
  room.desktop = false;
  baseRefSpace = renderer.xr.getReferenceSpace();
  // Neu zentriert (Oculus-Taste lang gedrückt): Ursprung springt – Bodenhöhe neu anwenden, keine Schein-Treffer
  if (baseRefSpace && baseRefSpace.addEventListener) baseRefSpace.addEventListener('reset', () => {
    applyFloorOffset();
    for (const w of arsenal) w.lost = true;
    for (const h of hands) { h.hist.length = 0; h.velHist.length = 0; h.prevFist = null; }
    later(0.3, () => floatingText('Ansicht neu zentriert – passt der Raum nicht mehr: Raum einrichten → Ausrichten', inFront(1.2, 0, headPos.y), '#ffd36a'));
  });
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
  for (const h of hands) releaseHand(h);
  clearEnemies();
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
    text(ctx, `❤ ${Math.ceil(playerHp)} · ⚔ ${kills} besiegt`, w / 2, 96, 24, '#cfd8e3');
    text(ctx, 'Pause/weiter: Stick drücken oder Y/B (PC: Esc)', w / 2, 398, 18, '#8796ad');
  }, [
    ...row(120, 70, [{ id: 'resume', label: '▶ Weiter', font: 36, onClick: () => setPaused(false) }], 630, 60),
    ...row(206, 62, [{ id: 'psettings', label: '⚙ Einstellungen', font: 28, onClick: () => { pausePanel.visible = false; menuView = 'settings'; menuPanel.visible = true; menuPanel.place(0.95, 0, -0.1); refreshMenu(); } }], 630, 60),
    ...row(284, 62, [
      { id: 'rack', label: '🗡 Waffen-Menü', font: 26, onClick: () => { setPaused(false); openWeaponMenu(); } },
      { id: 'quit', label: '🏠 Runde beenden', font: 26, onClick: () => { setPaused(false); endRound(false); } }
    ], 630, 40)
  ]);
}
const clock = new THREE.Clock();
function setPaused(on) {
  if (on === paused) return;
  if (on && state !== 'playing') return;
  paused = on;
  setAudioPaused(on);
  if (on) {
    weaponPanel.visible = false;
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
// Vorwärmen: Gegner, Waffen, Gesichter, Texte einmal erzeugen und die Shader übersetzen – kein Ruckeln beim ersten Auftauchen
(function warmup() {
  const g = warmupGroup();
  for (const id of WEAPON_ORDER) g.add(createWeapon(id).root);
  g.position.set(0, -50, 0);
  scene.add(g);
  warmText();
  scene.updateMatrixWorld();
  try { renderer.compile(scene, camera); g.traverse(o => { if (o.material && o.material.map) renderer.initTexture(o.material.map); }); } catch { /* egal */ }
  scene.remove(g);
})();

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
// Messung der Rechenzeit (für Tests und die Leistungsanzeige): js = Spiel-Logik, parts = einzelne Bereiche
let trackLostT = 0;
const prof = { js: 0, n: 0, max: 0, parts: {}, lastDt: 0 };
const timed = (name, fn) => { const t = performance.now(); fn(); prof.parts[name] = (prof.parts[name] || 0) + performance.now() - t; };
function frameInner() {
  if (paused) { pauseFrame(renderer.xr.isPresenting); return; }
  const _t0 = performance.now();
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  prof.lastDt = rawDt;
  autoPerf(rawDt);
  elapsed += dt;
  const xr = renderer.xr.isPresenting;
  if (!xr) {
    updateDesktopMove(dt); if (state === 'playing') updateDesktopHeight(dt);
    camYaw += (lookYaw - camYaw) * Math.min(1, dt * 22); camPitch += (lookPitch - camPitch) * Math.min(1, dt * 22); // weich nachgeführt
    camera.rotation.set(camPitch, camYaw, 0, 'YXZ'); updateDesktopBow(dt);
  }
  camera.updateMatrixWorld(true);
  getViewCamera().getWorldPosition(headPos);
  for (const h of hands) { h.ray.updateMatrixWorld(true); h.grip.updateMatrixWorld(true); }
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
    // Schutz bei Tracking-Verlust: Brille verliert die Position oder beide Controller sind weg → Pause
    const xf = renderer.xr.getFrame && renderer.xr.getFrame(), pose = xf && baseRefSpace ? xf.getViewerPose(renderer.xr.getReferenceSpace()) : true;
    const srcs = hands.filter(h => h.src);
    const lost = !pose || pose.emulatedPosition === true || (srcs.length > 0 && srcs.every(h => !h.ray.visible && !h.grip.visible));
    trackLostT = lost ? trackLostT + rawDt : 0;
    if (state === 'playing' && trackLostT > 0.6) { trackLostT = 0; setPaused(true); floatingText('Tracking verloren – Pause', inFront(1, 0, headPos.y), '#ff8a7a'); pauseFrame(true); return; }
    // Bedienfelder folgen, wenn man sich weit entfernt
    for (const p of [setupPanel, menuPanel]) if (p.visible && headPos.distanceTo(p.anchor) > 1.3) p === menuPanel ? enterMenu() : p.place(0.85, 0.65, -0.4);
    updateHandsXR(dt);
  }
  if (state === 'setup') updateSetup(dt);
  timed('physik', () => stepPhysics(dt));
  if (xr && settings.holsters) updateHolsterState(dt);
  timed('waffen', () => { updateWeapons(dt); updateFlying(dt); });
  if (xr) updateSafety(dt);
  timed('gegner', () => updateGame(dt));
  updateDust(dt);
  updateAtmosphere(dt);
  getViewCamera().getWorldDirection(tmpV);
  setListener(headPos, tmpV, UP.clone().applyQuaternion(getViewCamera().getWorldQuaternion(tmpQ)));
  updateEffects(dt);
  updateDebris(dt);
  updateHud();
  timed('matrizen', () => scene.updateMatrixWorld());
  const js = performance.now() - _t0;
  prof.js += js; prof.n++; prof.max = Math.max(prof.max, js);
  renderer.render(scene, camera);
}

// Für automatisierte Tests
applySettings();
window.__cam = camera;
window.__game = {
  prof,
  renderer, room, hands, enemies, arsenal, uiPanels, get playerHp() { return playerHp; }, set playerHp(v) { playerHp = v; }, get kills() { return kills; }, placeOnRack, equipDesk, giveWeapon, openWeaponMenu, closeWeaponMenu, get weaponPanel() { return weaponPanel; }, deskAttack, spawnTrainer, player, combatOpts, enemyWeaponSeg, segSegDist: (a, b, c, d) => segSeg(a, b, c, d), holsters, holster, equipLoadout, updateHolsterState, updateSafety, releaseHand, takeWeapon, take: (id, i) => { const w = newWeapon(id); takeWeapon(w, hands[i]); return w; }, get roundT() { return roundT; }, set roundT(v) { roundT = v; }, spawn: (type, at, passive) => spawnEnemy(headPos, { type, at, passive }), set trainType(v) { trainType = v; }, teleport: (x, z) => { camera.position.x = x; camera.position.z = z; }, settings, setup, menuPanel, setupPanel, pausePanel,
  get state() { return state; }, get paused() { return paused; }, get errors() { return errorCount; }, get floorOffset() { return floorOffset; },
  startPressed, enterMenu, enterSetup, finishSetup, setPaused, spawnEnemy: () => spawnEnemy(headPos), setTool, setupTriggerDown, setupTriggerUp,
  alignToLine, loadSlot, saveSlot, serializeRoom, surfaceAt, updateSetup
};
