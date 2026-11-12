import * as THREE from 'three';
import { strikeTest, applyHit, boneOf } from './enemies.js?v=8';
import { roomOccluders } from './room.js?v=8';
import { SFX } from './sfx.js?v=8';
import { sparks, puff } from './effects.js?v=8';
import { makeArrowMesh, ARROW_LEN } from './arrow.js?v=8';
export { makeArrowMesh };

// =============================================================================
// Waffen des Spielers: Dolch, Langschwert, Schild, Bogen (+ Pfeile).
// Jede Waffe ist eine Gruppe mit dem Griff im Ursprung; nach vorne (Zeigerichtung des Controllers) = -Z.
// Klingen haben eine Schneide (zeigt in der Hand nach „unten/vorne“, wie beim Hacken): Hiebe mit der
// Schneide wirken voll, mit der flachen Seite nur halb. Stiche (Bewegung entlang der Klinge) zählen
// eigens – sie gehen besser durch Rüstung.
// =============================================================================
export const WEAPON_ORDER = ['dagger', 'sword', 'mace', 'axe', 'hammer', 'spear', 'bow', 'crossbow', 'shield'];
// melee.kind: blade (Hieb + Stich) · blunt (stumpf) · axe (Hieb mit Durchschlag) · spear (Stich)
// pen = Durchschlag: Anteil der Rüstung, der ignoriert wird · shield = Schaden an gegnerischen Schilden
export const WEAPONS = {
  dagger: { name: 'Dolch', icon: '🗡', melee: { kind: 'blade', slash: 14, thrust: 30, minSpeed: 1.3, base: 0.03, len: 0.22, shield: 2 }, throwable: true, mass: 0.4, reach: 1.15,
    tip: 'Dolch: schneller Stich – gut gegen Stoff, Gambeson und Kette; werfbar' },
  sword: { name: 'Langschwert', icon: '⚔', melee: { kind: 'blade', slash: 40, thrust: 34, minSpeed: 1.6, base: 0.06, len: 0.88, shield: 4 }, twoHand: true, mass: 1.4, reach: 1.75,
    tip: 'Langschwert: Hieb gegen Ungepanzerte, Stich gegen Gambeson/Kette – an Platte gleitet es ab' },
  mace: { name: 'Streitkolben', icon: '🔨', melee: { kind: 'blunt', blunt: 34, minSpeed: 1.5, shield: 10 }, mass: 1.6, reach: 1.45,
    tip: 'Streitkolben: stumpfe Wucht – wirkt durch Kette und Platte, betäubt am Helm' },
  axe: { name: 'Streitaxt', icon: '🪓', melee: { kind: 'axe', slash: 48, pen: 0.3, minSpeed: 1.6, shield: 28 }, mass: 1.8, reach: 1.5,
    tip: 'Streitaxt: schwerer Hieb, schlägt teils durch Rüstung und zertrümmert Schilde' },
  hammer: { name: 'Kriegshammer', icon: '⚒', melee: { kind: 'blunt', blunt: 52, pen: 0.25, minSpeed: 1.5, shield: 22, knock: true }, twoHand: true, needTwo: true, mass: 3, reach: 1.8,
    tip: 'Kriegshammer (beidhändig!): zertrümmert Platte, wirft Gegner zu Boden – einhändig schwach' },
  spear: { name: 'Speer', icon: '🔱', melee: { kind: 'spear', thrust: 38, slash: 12, minSpeed: 1.6, shield: 3 }, twoHand: true, mass: 1.5, reach: 2.3,
    tip: 'Speer: große Reichweite, Stiche gegen Gambeson und Kette – hält Gegner auf Abstand' },
  bow: { name: 'Bogen', icon: '🏹', bow: true, mass: 0.8, tip: 'Bogen: schnell, gut gegen leichte Rüstung – Schilde fangen Pfeile ab' },
  crossbow: { name: 'Armbrust', icon: '🎯', bow: true, crossbow: true, mass: 2.6, tip: 'Armbrust: Sehne zurückziehen bis sie einrastet, Abzug schießt – Bolzen durchschlagen Rüstung' },
  shield: { name: 'Schild', icon: '🛡', shield: { r: 0.3 }, mass: 2.5, tip: 'Schild: blocken, Pfeile abfangen, Schildstoß' }
};
export const TILT = 0.55; // Klingen zeigen etwas nach oben (natürliche Handhaltung)

const steel = new THREE.MeshStandardMaterial({ color: 0xd6dae2, metalness: 0.55, roughness: 0.3, emissive: 0x1c1f24 });
const darkSteel = new THREE.MeshStandardMaterial({ color: 0x6a6e75, metalness: 0.5, roughness: 0.45 });
const leather = new THREE.MeshStandardMaterial({ color: 0x4a2e1a, roughness: 0.9 });
const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.8 });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.85 });
const brass = new THREE.MeshStandardMaterial({ color: 0xc09a4a, metalness: 0.5, roughness: 0.4 });
const stringMat = new THREE.LineBasicMaterial({ color: 0xeee8d8 });
const m = (g, mat, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, mat); o.position.set(x, y, z); o.castShadow = true; return o; };

// Klinge entlang -Z, Schneiden bei ±Y (hochkant in der Hand), flache Seiten bei ±X
function bladeGeo(len, w, thick) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w / 2 * 0.8, len * 0.85); s.lineTo(0, len); s.lineTo(-w / 2 * 0.8, len * 0.85); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: w * 0.12, bevelSegments: 1 });
  g.translate(0, 0, -thick / 2);
  g.rotateX(-Math.PI / 2); // Länge: +Y → -Z
  g.rotateZ(Math.PI / 2);  // Breite: X → Y (Schneide hochkant)
  return g;
}
function bladed(id, { len, w, thick, guardW, grip, pommel }) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.rotation.x = TILT;
  root.add(model);
  model.add(m(bladeGeo(len, w, thick), steel, 0, 0, -0.03));
  model.add(m(new THREE.BoxGeometry(0.03, guardW, 0.022), brass, 0, 0, -0.025));
  model.add(m(new THREE.CylinderGeometry(0.016, 0.017, grip, 10).rotateX(Math.PI / 2), leather, 0, 0, grip / 2 - 0.02));
  model.add(m(new THREE.SphereGeometry(pommel, 10, 8), brass, 0, 0, grip - 0.01));
  // Messpunkte (lokal in root): Klingenansatz, Spitze, Schneidenrichtung, Platz für die zweite Hand
  const base = new THREE.Vector3(0, 0, -0.03 - WEAPONS[id].melee.base).applyEuler(model.rotation);
  const tip = new THREE.Vector3(0, 0, -0.03 - len).applyEuler(model.rotation);
  const edge = new THREE.Vector3(0, 1, 0).applyEuler(model.rotation);
  const grip2 = new THREE.Vector3(0, 0, grip - 0.06).applyEuler(model.rotation);
  return { root, model, base, tip, ga: base.clone(), gb: tip.clone(), edge, grip2 };
}
// Stielwaffe: Schaft entlang -Z (von +back bis -len), head(model) baut den Kopf.
// hit = [z0, z1, y]: Trefferbereich am Kopf · der ganze Schaft kann Schläge abfangen (ga..gb)
function hafted({ tilt, back, len, r, hit, twoGrip = null, head }) {
  const root = new THREE.Group(), model = new THREE.Group();
  model.rotation.x = tilt;
  root.add(model);
  model.add(m(new THREE.CylinderGeometry(r, r, back + len, 8).rotateX(Math.PI / 2), wood, 0, 0, (back - len) / 2));
  model.add(m(new THREE.CylinderGeometry(r + 0.003, r + 0.003, 0.15, 8).rotateX(Math.PI / 2), leather, 0, 0, 0.02));
  head(model);
  const E = model.rotation, P = (x, y, z) => new THREE.Vector3(x, y, z).applyEuler(E);
  return { root, model, base: P(0, hit[2], -hit[0]), tip: P(0, hit[2], -hit[1]), ga: P(0, 0, back), gb: P(0, 0, -hit[1]), edge: P(0, 1, 0), grip2: twoGrip === null ? null : P(0, 0, twoGrip) };
}
const buildMace = () => hafted({ tilt: TILT, back: 0.06, len: 0.5, r: 0.014, hit: [0.42, 0.6, 0], head(M) {
  M.add(m(new THREE.SphereGeometry(0.045, 12, 8), darkSteel, 0, 0, -0.52));
  for (let i = 0; i < 3; i++) { const f = m(new THREE.BoxGeometry(0.012, 0.135, 0.085), steel, 0, 0, -0.52); f.rotation.z = i * Math.PI / 3; M.add(f); }
  M.add(m(new THREE.ConeGeometry(0.016, 0.05, 6).rotateX(-Math.PI / 2), steel, 0, 0, -0.585));
} });
const buildAxe = () => hafted({ tilt: TILT, back: 0.08, len: 0.62, r: 0.015, hit: [0.46, 0.66, -0.08], head(M) {
  M.add(m(new THREE.BoxGeometry(0.012, 0.18, 0.15), steel, 0, -0.09, -0.56));   // Blatt, Schneide unten/vorne
  M.add(m(new THREE.BoxGeometry(0.012, 0.05, 0.23), steel, 0, -0.165, -0.56));  // breite Schneide
  M.add(m(new THREE.BoxGeometry(0.034, 0.05, 0.07), darkSteel, 0, 0, -0.56));
} });
const buildHammer = () => hafted({ tilt: 0.5, back: 0.3, len: 0.85, r: 0.017, hit: [0.76, 0.92, 0], twoGrip: 0.24, head(M) {
  M.add(m(new THREE.BoxGeometry(0.06, 0.17, 0.075), darkSteel, 0, -0.01, -0.83));
  M.add(m(new THREE.ConeGeometry(0.022, 0.09, 4), steel, 0, 0.115, -0.83));                         // Dorn hinten
  M.add(m(new THREE.ConeGeometry(0.02, 0.1, 4).rotateX(-Math.PI / 2), steel, 0, 0, -0.91));         // Stoßspitze
} });
const buildSpear = () => hafted({ tilt: 0.3, back: 0.55, len: 1.25, r: 0.014, hit: [1.2, 1.5, 0], twoGrip: 0.42, head(M) {
  const t = m(new THREE.ConeGeometry(0.032, 0.26, 4).rotateX(-Math.PI / 2), steel, 0, 0, -1.38); t.scale.x = 0.35; M.add(t);
  M.add(m(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 8).rotateX(Math.PI / 2), darkSteel, 0, 0, -1.25));
} });
// Armbrust: Schaft entlang -Z, Bogen quer, Sehne wird bis zur Nuss zurückgezogen und rastet ein
const XB = { rest: -0.36, latch: -0.1, y: 0.035, half: 0.31 };
function buildCrossbow() {
  const root = new THREE.Group(), model = new THREE.Group();
  root.add(model);
  model.add(m(new THREE.BoxGeometry(0.04, 0.05, 0.62), darkWood, 0, 0, -0.12));
  model.add(m(new THREE.BoxGeometry(0.035, 0.09, 0.05), darkWood, 0, -0.06, 0.12));              // Kolben/Griff
  model.add(m(new THREE.BoxGeometry(XB.half * 2, 0.024, 0.032), darkSteel, 0, XB.y - 0.01, -0.4)); // Bogen
  model.add(m(new THREE.TorusGeometry(0.035, 0.006, 5, 10), darkSteel, 0, 0, -0.455));           // Steigbügel
  const tipA = new THREE.Vector3(-XB.half, XB.y, -0.4), tipB = new THREE.Vector3(XB.half, XB.y, -0.4);
  const str = new THREE.Line(new THREE.BufferGeometry().setFromPoints([tipA, new THREE.Vector3(0, XB.y, XB.rest), tipB]), stringMat);
  model.add(str);
  const bolt = makeArrowMesh(1); bolt.scale.z = 0.5; bolt.position.set(0, XB.y + 0.005, XB.latch); bolt.visible = false;
  model.add(bolt);
  return { root, model, string: str, tipA, tipB, nock: new THREE.Vector3(0, XB.y, XB.rest), grip: new THREE.Vector3(0, XB.y, -0.4), muzzle: new THREE.Vector3(0, XB.y + 0.005, XB.latch), nocked: bolt, loaded: false };
}
// Armbrust-Sehne: pull 0..1 (0 = entspannt, 1 = eingerastet)
export function setXbowString(w, pull) {
  const z = XB.rest + (XB.latch - XB.rest) * pull;
  w.string.geometry.attributes.position.setXYZ(1, 0, XB.y, z);
  w.string.geometry.attributes.position.needsUpdate = true;
  w.nock.set(0, XB.y, z);
  w.nocked.visible = w.loaded;
}
export const xbowPull = (w, handWorld) => THREE.MathUtils.clamp((w.model.worldToLocal(handWorld.clone()).z - XB.rest) / (XB.latch - XB.rest), 0, 1);
function buildShield() {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  // runder Holzschild mit Eisenrand und Buckel, Vorderseite zeigt nach -Z
  model.add(m(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 32).rotateX(Math.PI / 2), wood, 0, 0, -0.07));
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

export function createWeapon(id) {
  const def = WEAPONS[id];
  const parts = id === 'dagger' ? bladed(id, { len: 0.22, w: 0.032, thick: 0.006, guardW: 0.07, grip: 0.1, pommel: 0.016 })
    : id === 'sword' ? bladed(id, { len: 0.88, w: 0.05, thick: 0.008, guardW: 0.2, grip: 0.24, pommel: 0.024 })
    : id === 'mace' ? buildMace() : id === 'axe' ? buildAxe() : id === 'hammer' ? buildHammer() : id === 'spear' ? buildSpear()
    : id === 'crossbow' ? buildCrossbow() : id === 'bow' ? buildBow() : buildShield();
  parts.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return {
    id, def, ...parts, holder: null, second: null, twoHand: false, phys: null, draw: 0,
    prevTip: null, prevBase: null, tipVel: new THREE.Vector3(), tipSpeed: 0, spentUntil: 0, // Nahkampf
    prevC: null, cVel: new THREE.Vector3(), bashUntil: 0, stuck: []                         // Schild
  };
}

// Bogen-Sehne zeichnen: hand = Position der Zughand (Welt) oder null (entspannt)
export function setBowString(w, handWorld) {
  if (w.def.crossbow) { setXbowString(w, w.loaded ? 1 : handWorld ? xbowPull(w, handWorld) : 0); return; }
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
const flying = []; // { obj, vel, kind, power, life, stuck, onDone }
const raycaster = new THREE.Raycaster();
let scene = null, onHit = () => {}, onBlocked = () => {};
// hitCallback(hit, result, info) bei Treffern · blockedCallback(hit) wenn ein Schild/eine Parade den Pfeil abfängt
export function initWeapons(s, hitCallback, blockedCallback) { scene = s; onHit = hitCallback; if (blockedCallback) onBlocked = blockedCallback; }
// o: { bolt: Armbrustbolzen (kurz), power, pen: Durchschlag }
export function shootArrow(from, dir, speed, o = {}) {
  const obj = makeArrowMesh(o.bolt ? 1 : 0);
  if (o.bolt) obj.scale.z = 0.5;
  obj.position.copy(from);
  scene.add(obj);
  flying.push({ obj, vel: dir.clone().normalize().multiplyScalar(speed), kind: 'arrow', len: ARROW_LEN * (o.bolt ? 0.5 : 1), power: o.power ?? 15 + speed * 1.3, pen: o.pen || 0, shield: o.bolt ? 6 : 2, life: 6, stuck: false });
  SFX.whoosh();
}
// Dolch fliegt mit der Spitze voran; onDone(w, restgeschwindigkeit) wenn er landet
export function throwBlade(w, vel, onDone) {
  scene.attach(w.root);
  flying.push({ obj: w.root, w, vel: vel.clone(), kind: 'blade', len: 0.2, power: w.def.melee.thrust * 1.25, pen: 0, shield: 2, life: 3, stuck: false, onDone });
  SFX.whoosh();
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), FWD = new THREE.Vector3(0, 0, -1), XA = new THREE.Vector3(1, 0, 0);
export function updateFlying(dt) {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    f.life -= dt;
    if (f.stuck) { // steckender Pfeil verschwindet nach einer Weile
      if (f.life <= 0) { if (f.obj.parent) f.obj.parent.remove(f.obj); flying.splice(i, 1); }
      continue;
    }
    f.vel.y -= 9.81 * dt * (f.kind === 'arrow' ? 0.5 : 1);
    const a = tmpA.copy(f.obj.position);
    const b = tmpB.copy(a).addScaledVector(f.vel, dt);
    const dir = f.vel.clone().normalize();
    // Ausrichtung entlang der Flugbahn
    const q = new THREE.Quaternion().setFromUnitVectors(FWD, dir);
    if (f.kind === 'arrow') f.obj.quaternion.copy(q);
    else f.obj.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(XA, -TILT));
    const tipOff = f.len;
    const tipA = a.clone().addScaledVector(dir, tipOff), tipB = b.clone().addScaledVector(dir, tipOff);
    // Gegner getroffen? (Schild oder Parade können den Pfeil abfangen)
    const h = strikeTest(tipA, tipB, 0.02, true);
    if (h && h.kind !== 'body') {
      onBlocked(h, f);
      if (f.kind === 'arrow' && h.kind === 'shield' && h.e.shield) { // bleibt im Schild stecken
        f.obj.position.copy(h.point).addScaledVector(dir, -f.len + 0.07);
        h.e.shield.attach(f.obj); f.stuck = true; f.life = 12;
      } else if (f.kind === 'arrow') { scene.remove(f.obj); flying.splice(i, 1); }
      else { flying.splice(i, 1); f.onDone && f.onDone(f.w, f.vel.clone().multiplyScalar(-0.15)); }
      continue;
    }
    if (h) {
      const r = applyHit(h.e, h.zone, { type: 'thrust', power: f.power, pen: f.pen, dir: dir.clone(), point: h.point, knock: 0.6 });
      onHit(h, r, { type: 'thrust', source: f.kind });
      if (f.kind === 'arrow') { // Pfeil bleibt im Körper stecken
        f.obj.position.copy(h.point).addScaledVector(dir, -f.len + 0.12);
        boneOf(h.e, h.zone).attach(f.obj); f.stuck = true; f.life = 25;
      } else { flying.splice(i, 1); f.onDone && f.onDone(f.w, f.vel.clone().multiplyScalar(0.12)); }
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
  for (const f of flying.splice(0)) { if (f.kind === 'arrow') { if (f.obj.parent) f.obj.parent.remove(f.obj); } else if (f.onDone) f.onDone(f.w, new THREE.Vector3()); }
}
