import * as THREE from 'three';
import { hitTest, damageEnemy } from './enemies.js?v=5';
import { roomOccluders } from './room.js?v=5';
import { SFX } from './sfx.js?v=5';
import { sparks, puff } from './effects.js?v=5';

// =============================================================================
// Waffen: Dolch, Langschwert, Schild, Bogen (+ Pfeile).
// Jede Waffe ist eine Gruppe mit dem Griff im Ursprung; nach vorne (Zeigerichtung des Controllers) = -Z.
// =============================================================================
export const WEAPON_ORDER = ['dagger', 'sword', 'bow', 'shield'];
export const WEAPONS = {
  dagger: { name: 'Dolch', icon: '🗡', melee: { dmg: 34, minSpeed: 1.3, base: 0.03, len: 0.22 }, throwable: true, mass: 0.4 },
  sword: { name: 'Langschwert', icon: '⚔', melee: { dmg: 55, minSpeed: 1.6, base: 0.06, len: 0.88 }, mass: 1.4 },
  bow: { name: 'Bogen', icon: '🏹', bow: true, mass: 0.8 },
  shield: { name: 'Schild', icon: '🛡', shield: { r: 0.3 }, mass: 2.5 }
};
const TILT = 0.55; // Klingen zeigen etwas nach oben (natürliche Handhaltung)

const steel = new THREE.MeshStandardMaterial({ color: 0xd6dae2, metalness: 0.55, roughness: 0.3, emissive: 0x1c1f24 });
const darkSteel = new THREE.MeshStandardMaterial({ color: 0x6a6e75, metalness: 0.5, roughness: 0.45 });
const leather = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.9 });
const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.8 });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.85 });
const brass = new THREE.MeshStandardMaterial({ color: 0xc09a4a, metalness: 0.5, roughness: 0.4 });
const stringMat = new THREE.LineBasicMaterial({ color: 0xeee8d8 });
const feather = new THREE.MeshStandardMaterial({ color: 0xb02a20, roughness: 0.9, side: THREE.DoubleSide });
const m = (g, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); o.castShadow = true; return o; };

// Klinge entlang -Z: flacher Keil mit Spitze
function bladeGeo(len, w, thick) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2 * 0.8, len * 0.85); s.lineTo(0, len); s.lineTo(-w / 2 * 0.8, len * 0.85); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: w * 0.12, bevelSegments: 1 });
  g.translate(0, 0, -thick / 2);
  g.rotateX(-Math.PI / 2); // +Y → -Z
  return g;
}
function bladed(id, { len, w, thick, guardW, grip, pommel }) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.x = TILT;
  root.add(model);
  const blade = m(bladeGeo(len, w, thick), steel, 0, 0, -0.03);
  model.add(blade);
  model.add(m(new THREE.BoxGeometry(guardW, 0.022, 0.03), brass, 0, 0, -0.025));
  const g = m(new THREE.CylinderGeometry(0.016, 0.017, grip, 10).rotateX(Math.PI / 2), leather, 0, 0, grip / 2 - 0.02);
  model.add(g);
  model.add(m(new THREE.SphereGeometry(pommel, 10, 8), brass, 0, 0, grip - 0.01));
  // Messpunkte der Klinge (lokal in root): Ansatz und Spitze
  const base = new THREE.Vector3(0, 0, -0.03 - WEAPONS[id].melee.base).applyEuler(model.rotation);
  const tip = new THREE.Vector3(0, 0, -0.03 - len).applyEuler(model.rotation);
  return { root, model, base, tip };
}
function buildShield() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  // runder Holzschild mit Eisenrand und Buckel, Vorderseite zeigt nach -Z
  const face = m(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 32).rotateX(Math.PI / 2), wood, 0, 0, -0.07);
  model.add(face);
  for (let i = -2; i <= 2; i++) model.add(m(new THREE.BoxGeometry(0.004, 0.58 - Math.abs(i) * 0.08, 0.004), darkWood, i * 0.11, 0, -0.084)); // Bretterfugen
  model.add(m(new THREE.TorusGeometry(0.3, 0.012, 6, 40), darkSteel, 0, 0, -0.07));
  model.add(m(new THREE.SphereGeometry(0.07, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2), darkSteel, 0, 0, -0.083));
  model.add(m(new THREE.BoxGeometry(0.03, 0.14, 0.03), leather, 0, 0, -0.04)); // Griff hinten
  return { root, model, center: new THREE.Vector3(0, 0, -0.07), normal: new THREE.Vector3(0, 0, -1) };
}
// Bogen: senkrecht in der Hand, Wurfarme biegen sich nach vorne, Sehne hinten
const BOW_HALF = 0.62, STRING_Z = 0.13;
function buildBow() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -BOW_HALF, STRING_Z), new THREE.Vector3(0, 0, -0.14), new THREE.Vector3(0, BOW_HALF, STRING_Z));
  model.add(m(new THREE.TubeGeometry(curve, 24, 0.014, 6), darkWood));
  model.add(m(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), leather, 0, 0, -0.07)); // Griff
  const tipA = new THREE.Vector3(0, BOW_HALF, STRING_Z), tipB = new THREE.Vector3(0, -BOW_HALF, STRING_Z);
  const strGeo = new THREE.BufferGeometry().setFromPoints([tipA, new THREE.Vector3(0, 0, STRING_Z), tipB]);
  const str = new THREE.Line(strGeo, stringMat);
  model.add(str);
  // eingelegter Pfeil (nur beim Spannen sichtbar)
  const nocked = makeArrowMesh();
  nocked.visible = false;
  model.add(nocked);
  return { root, model, string: str, tipA, tipB, nock: new THREE.Vector3(0, 0, STRING_Z), grip: new THREE.Vector3(0, 0, -0.07), nocked };
}
// Pfeil: Spitze bei -Z, Länge 0.75
const ARROW_LEN = 0.75;
export function makeArrowMesh() {
  const g = new THREE.Group();
  g.add(m(new THREE.CylinderGeometry(0.0045, 0.0045, ARROW_LEN, 6).rotateX(Math.PI / 2), wood, 0, 0, -ARROW_LEN / 2));
  g.add(m(new THREE.ConeGeometry(0.012, 0.05, 6).rotateX(-Math.PI / 2), darkSteel, 0, 0, -ARROW_LEN - 0.02));
  for (let i = 0; i < 3; i++) {
    const f = m(new THREE.PlaneGeometry(0.02, 0.09), feather, 0, 0, -0.06);
    f.rotation.set(Math.PI / 2, i * Math.PI * 2 / 3, 0);
    f.position.set(Math.cos(i * 2.09) * 0.01, Math.sin(i * 2.09) * 0.01, -0.06);
    g.add(f);
  }
  return g;
}

export function createWeapon(id) {
  const def = WEAPONS[id];
  const parts = id === 'dagger' ? bladed(id, { len: 0.22, w: 0.032, thick: 0.006, guardW: 0.07, grip: 0.1, pommel: 0.016 })
    : id === 'sword' ? bladed(id, { len: 0.88, w: 0.05, thick: 0.008, guardW: 0.2, grip: 0.22, pommel: 0.024 })
    : id === 'bow' ? buildBow() : buildShield();
  parts.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { id, def, ...parts, holder: null, phys: null, prevTip: null, lastHit: new Map(), draw: 0 };
}

// Bogen-Sehne zeichnen: hand = Position der Zughand (Welt) oder null (entspannt)
export function setBowString(w, handWorld) {
  const pos = w.string.geometry.attributes.position;
  let nock = w.nock;
  if (handWorld) { nock = w.model.worldToLocal(handWorld.clone()); nock.x *= 0.3; }
  pos.setXYZ(1, nock.x, nock.y, nock.z);
  pos.needsUpdate = true;
  w.nocked.visible = !!handWorld;
  if (handWorld) { // Pfeil liegt zwischen Sehne und Griff
    w.nocked.position.copy(nock);
    w.nocked.lookAt(w.model.localToWorld(w.grip.clone()));
    w.nocked.rotateY(Math.PI); // Spitze (-Z) zum Griff
  }
}

// ---- fliegende Pfeile und geworfene Dolche ----------------------------------------
const flying = []; // { obj, vel, spin, kind, dmg, life, stuck, onDone }
const raycaster = new THREE.Raycaster();
let scene = null, onHit = () => {};
export function initWeapons(s, hitCallback) { scene = s; onHit = hitCallback; }
export function shootArrow(from, dir, speed) {
  const obj = makeArrowMesh();
  obj.position.copy(from);
  scene.add(obj);
  flying.push({ obj, vel: dir.clone().normalize().multiplyScalar(speed), kind: 'arrow', dmg: 25 + speed * 2.2, life: 6, stuck: false });
  SFX.whoosh();
}
// Dolch fliegt mit der Spitze voran; onDone(w, hitEnemy) wenn er landet
export function throwBlade(w, vel, onDone) {
  scene.attach(w.root);
  flying.push({ obj: w.root, w, vel: vel.clone(), kind: 'blade', dmg: w.def.melee.dmg * 1.8, life: 3, stuck: false, onDone });
  SFX.whoosh();
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), FWD = new THREE.Vector3(0, 0, -1);
export function updateFlying(dt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    f.life -= dt;
    if (f.stuck) { // steckender Pfeil verschwindet nach einer Weile
      if (f.life <= 0) { scene.remove(f.obj); flying.splice(i, 1); }
      continue;
    }
    f.vel.y -= 9.81 * dt * (f.kind === 'arrow' ? 0.5 : 1);
    const a = tmpA.copy(f.obj.position);
    const b = tmpB.copy(a).addScaledVector(f.vel, dt);
    // Ausrichtung entlang der Flugbahn
    const q = new THREE.Quaternion().setFromUnitVectors(FWD, f.vel.clone().normalize());
    if (f.kind === 'arrow') f.obj.quaternion.copy(q);
    else f.obj.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -TILT));
    const tipOff = f.kind === 'arrow' ? ARROW_LEN : 0.2;
    const tipA = a.clone().addScaledVector(f.vel.clone().normalize(), tipOff), tipB = b.clone().addScaledVector(f.vel.clone().normalize(), tipOff);
    // Skelett getroffen?
    const h = hitTest(tipA, tipB, 0.02);
    if (h) {
      const r = damageEnemy(h.e, f.dmg, h.zone, h.point, f.vel.clone().setY(0).normalize(), 0.6);
      onHit(h, r, f.kind);
      if (f.kind === 'arrow') { scene.remove(f.obj); flying.splice(i, 1); }
      else { flying.splice(i, 1); f.onDone && f.onDone(f.w, f.vel.clone().multiplyScalar(0.15)); }
      continue;
    }
    // Wand/Möbel/Boden getroffen? → stecken bleiben (Pfeil) bzw. herunterfallen (Dolch)
    const len = tipA.distanceTo(tipB);
    raycaster.set(tipA, tipB.clone().sub(tipA).normalize());
    raycaster.far = len;
    const wall = len > 0 ? raycaster.intersectObjects(roomOccluders(), false)[0] : null;
    const floorHitY = tipB.y <= 0.005;
    if (wall || floorHitY || f.life <= 0) {
      const p = wall ? wall.point : tipB.clone().setY(Math.max(0.005, tipB.y));
      if (wall || floorHitY) { sparks(p, wall && wall.face ? wall.face.normal : new THREE.Vector3(0, 1, 0), 4); puff(p, 0x9a8a70, 0.06, 0.5, 0.1, 0.4); SFX.thud(0.25); }
      if (f.kind === 'arrow') { f.obj.position.add(p.clone().sub(tipA)); f.stuck = true; f.life = 8; }
      else { flying.splice(i, 1); f.onDone && f.onDone(f.w, f.vel.clone().multiplyScalar(0.1)); }
      continue;
    }
    f.obj.position.copy(b);
  }
}
export function clearFlying() {
  for (const f of flying.splice(0)) { if (f.kind === 'arrow') scene.remove(f.obj); else if (f.onDone) f.onDone(f.w, new THREE.Vector3()); }
}
