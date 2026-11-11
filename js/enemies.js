import * as THREE from 'three';
import { surfacesOf } from './room.js?v=5';
import { buildNav, findPath, walkable, nearestWalkable, groundAt, STEP } from './nav.js?v=5';
import { SFX3D } from './sfx.js?v=5';
import { puff, addDebris, burst } from './effects.js?v=5';

// =============================================================================
// Gegner: normale Skelette (keine Bosse, keine Riesen).
// Sie kommen von draußen durch Türen (laufen durch) und Fenster (klettern hinein), laufen um
// Wände und Möbel herum zum Spieler, klettern auf niedrige Hindernisse (Tisch, Bett) und greifen an:
// sichtbar ausholen, dann zuschlagen. Treffer lassen sie taumeln, Kopftreffer zählen dreifach.
// =============================================================================
let scene = null, onStrike = () => {};
export const enemies = [];
// strike(e) wird im Moment des Schlags aufgerufen – das Spiel prüft Schild/Abstand und zieht Leben ab
export function initEnemies(s, strike) { scene = s; if (strike) onStrike = strike; }
export const aliveCount = () => enemies.filter(e => e.state !== 'dead').length;

const SPEED = 0.6;         // Gehtempo (m/s)
const ATTACK_DIST = 0.7;   // ab dieser Entfernung zum Spieler: angreifen
const OUTSIDE = 1.6;       // so weit vor der Tür/dem Fenster erscheinen sie (draußen)
const HP = 100;
const rand = THREE.MathUtils.randFloat;
const hyp = (a, b) => Math.sqrt(a * a + b * b);
const tmpV = new THREE.Vector3();

// ---- Aussehen: Knochen aus einfachen Formen ------------------------------------------
const boneMat = new THREE.MeshStandardMaterial({ color: 0xd9d0b4, roughness: 0.75 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3a1a, toneMapped: false });
const rustMat = new THREE.MeshStandardMaterial({ color: 0x7a5a40, metalness: 0.5, roughness: 0.6 });
const geo = {
  skull: new THREE.SphereGeometry(0.105, 16, 12),
  jaw: new THREE.BoxGeometry(0.11, 0.035, 0.08),
  socket: new THREE.SphereGeometry(0.026, 8, 6),
  eye: new THREE.SphereGeometry(0.011, 6, 4),
  rib: new THREE.TorusGeometry(0.12, 0.012, 4, 12, Math.PI * 1.3),
  spine: new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6),
  pelvis: new THREE.TorusGeometry(0.09, 0.025, 6, 12),
  bone: (len, r) => new THREE.CylinderGeometry(r, r * 0.85, len, 6).translate(0, -len / 2, 0),
  joint: new THREE.SphereGeometry(0.03, 8, 6),
  foot: new THREE.BoxGeometry(0.07, 0.03, 0.16),
  blade: new THREE.BoxGeometry(0.035, 0.5, 0.008).translate(0, -0.3, 0),
  guard: new THREE.BoxGeometry(0.11, 0.02, 0.02).translate(0, -0.05, 0)
};
const thigh = geo.bone(0.44, 0.024), shin = geo.bone(0.42, 0.02), upperArm = geo.bone(0.29, 0.018), foreArm = geo.bone(0.27, 0.015);
const mesh = (g, m = boneMat) => { const o = new THREE.Mesh(g, m); o.castShadow = true; return o; };

function buildSkeleton() {
  const root = new THREE.Group(); // Füße auf y = 0, Blick nach +Z
  const body = new THREE.Group(); // wird beim Klettern/Aufstehen bewegt
  root.add(body);
  const pelvis = mesh(geo.pelvis); pelvis.position.y = 0.93; pelvis.rotation.x = Math.PI / 2; body.add(pelvis);
  const torso = new THREE.Group(); torso.position.y = 0.95; body.add(torso);
  const spine = mesh(geo.spine); spine.position.y = 0.25; torso.add(spine);
  for (let i = 0; i < 4; i++) {
    const r = mesh(geo.rib); r.position.set(0, 0.28 + i * 0.065, 0.02); r.rotation.set(Math.PI / 2, 0, Math.PI * 0.85); r.scale.setScalar(1 - Math.abs(i - 1.5) * 0.1); torso.add(r);
  }
  const neck = new THREE.Group(); neck.position.y = 0.56; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.1; neck.add(head);
  const skull = mesh(geo.skull); skull.scale.set(0.9, 1, 1); head.add(skull);
  const jaw = mesh(geo.jaw); jaw.position.set(0, -0.085, 0.035); head.add(jaw);
  for (const sx of [-1, 1]) {
    const s = mesh(geo.socket, darkMat); s.position.set(sx * 0.038, 0.01, 0.082); head.add(s);
    const e = new THREE.Mesh(geo.eye, eyeMat); e.position.set(sx * 0.038, 0.01, 0.1); head.add(e);
  }
  const limb = (parent, x, y, g1, g2, len1, sideways) => {
    const top = new THREE.Group(); top.position.set(x, y, 0); parent.add(top);
    top.add(mesh(geo.joint));
    top.add(mesh(g1));
    const mid = new THREE.Group(); mid.position.y = -len1; top.add(mid);
    mid.add(mesh(geo.joint));
    mid.add(mesh(g2));
    if (sideways) top.rotation.z = sideways;
    return { top, mid };
  };
  const legs = [-1, 1].map(s => limb(body, s * 0.1, 0.93, thigh, shin, 0.44));
  for (const l of legs) { const f = mesh(geo.foot); f.position.set(0, -0.42, 0.04); l.mid.add(f); }
  const arms = [-1, 1].map(s => limb(torso, s * 0.19, 0.5, upperArm, foreArm, 0.29, s * 0.12));
  // rostiges Schwert in der rechten Hand
  const sword = new THREE.Group(); sword.position.y = -0.27; sword.rotation.x = Math.PI / 2;
  sword.add(mesh(geo.blade, rustMat), mesh(geo.guard, rustMat));
  arms[1].mid.add(sword);
  return { root, body, torso, head, skull, jaw, legs, arms, sword };
}

// ---- Erscheinen ------------------------------------------------------------------
// Ablauf je Öffnung: draußen erscheinen → zur Öffnung laufen → (Fenster: hineinklettern) → zum Spieler
export function spawnEnemy(head, speedMul = 1) {
  const opens = surfacesOf('door', 'window');
  const e = {
    ...buildSkeleton(), pos: new THREE.Vector3(), y: 0, yaw: 0, phase: Math.random() * 6, t: 0, path: null, pathT: 0,
    hp: HP, stagger: 0, atkT: rand(0.3, 0.8), atkPhase: -1, groanT: rand(2, 6), stepT: 0, speed: SPEED * rand(0.85, 1.15) * speedMul, hitBy: new Map()
  };
  if (opens.length) {
    const o = opens[Math.floor(Math.random() * opens.length)];
    const along = o.width > 0.7 ? rand(-0.15, 0.15) * o.width : 0;
    const mid = o.mid.clone().setY(0).addScaledVector(o.right, along);
    e.opening = o;
    e.pos.copy(mid).addScaledVector(o.normal, -OUTSIDE);
    e.entry = mid.clone().addScaledVector(o.normal, o.type === 'window' ? -0.35 : 0);
    e.inside = mid.clone().addScaledVector(o.normal, 0.55);
    e.state = 'approach';
  } else {
    // keine Türen/Fenster eingezeichnet: Skelett steigt in 3 m Entfernung aus dem Boden
    const a = Math.random() * Math.PI * 2;
    e.pos.copy(nearestWalkable(new THREE.Vector3(head.x + Math.sin(a) * 3, 0, head.z + Math.cos(a) * 3)));
    e.state = 'rise';
    e.body.position.y = -1.8;
  }
  e.yaw = Math.atan2(head.x - e.pos.x, head.z - e.pos.z);
  e.root.position.copy(e.pos);
  e.root.rotation.y = e.yaw;
  scene.add(e.root);
  enemies.push(e);
  return e;
}
export function clearEnemies() {
  for (const e of enemies.splice(0)) scene.remove(e.root);
}
// Laufwege neu berechnen (vor jeder Runde)
export function prepareNav(head) { buildNav(head); }

// ---- Treffer -----------------------------------------------------------------------
// Trefferzonen als Kugeln (in Weltkoordinaten): Kopf, Brust, Becken
export function hitZones(e) {
  e.root.updateMatrixWorld(true);
  return [
    { zone: 'head', r: 0.13, p: e.skull.getWorldPosition(new THREE.Vector3()) },
    { zone: 'body', r: 0.2, p: e.torso.localToWorld(new THREE.Vector3(0, 0.33, 0)) },
    { zone: 'body', r: 0.17, p: e.torso.localToWorld(new THREE.Vector3(0, 0.0, 0)) },
    { zone: 'legs', r: 0.13, p: e.body.localToWorld(new THREE.Vector3(0, 0.55, 0)) },
    { zone: 'legs', r: 0.11, p: e.body.localToWorld(new THREE.Vector3(0, 0.22, 0.02)) }
  ];
}
// Nächste Trefferzone auf einer Strecke a→b (Klinge, Pfeil). Liefert { e, zone, point } oder null
export function hitTest(a, b, extra = 0) {
  let best = null;
  const seg = new THREE.Line3(a, b), cp = new THREE.Vector3();
  for (const e of enemies) {
    if (e.state === 'dead' || e.state === 'approach') continue;
    if (e.pos.distanceTo(tmpV.set(a.x, e.y, a.z)) > 2.5 && e.pos.distanceTo(tmpV.set(b.x, e.y, b.z)) > 2.5) continue;
    for (const z of hitZones(e)) {
      seg.closestPointToPoint(z.p, true, cp);
      const d = cp.distanceTo(z.p) - z.r - extra;
      if (d < 0 && (!best || d < best.d || (z.zone === 'head' && best.e === e))) best = { e, zone: z.zone, point: cp.clone(), d };
    }
  }
  return best;
}
// Schaden austeilen. dir = Schlag-/Flugrichtung (für das Taumeln). Liefert { killed, dmg }
export function damageEnemy(e, dmg, zone, point, dir, knock = 1) {
  if (e.state === 'dead') return { killed: false, dmg: 0 };
  if (zone === 'head') dmg *= 3; else if (zone === 'legs') dmg *= 0.7;
  e.hp -= dmg;
  burst(point, 0xd9d0b4, 8);
  SFX3D.hurt && SFX3D.hurt(e.pos.clone().setY(e.y + 1.5), 'walker');
  if (e.hp <= 0) { crumble(e, dir); return { killed: true, dmg }; }
  // Taumeln: Angriff wird unterbrochen, kleiner Rückstoß
  e.stagger = 0.35 + 0.25 * knock;
  e.atkPhase = -1;
  e.atkT = rand(0.6, 1.1);
  if (dir) { const nx = e.pos.x + dir.x * 0.12 * knock, nz = e.pos.z + dir.z * 0.12 * knock; if (walkable(nx, nz) && Math.abs(groundAt(nx, nz) - e.y) < STEP) { e.pos.x = nx; e.pos.z = nz; } }
  return { killed: false, dmg };
}
// vom Schild abgeprallt: längeres Taumeln
export function bounceOff(e) { e.stagger = 0.9; e.atkPhase = -1; e.atkT = rand(1, 1.6); }

// ---- Bewegung & Animation ----------------------------------------------------------
function turnTo(e, x, z, dt) {
  const want = Math.atan2(x - e.pos.x, z - e.pos.z);
  let d = want - e.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  e.yaw += d * Math.min(1, dt * 6);
}
// geradeaus zu einem Punkt gehen; true = angekommen. Mit check: Raster beachten und klettern
function walkTo(e, target, dt, check = false) {
  const dx = target.x - e.pos.x, dz = target.z - e.pos.z, d = hyp(dx, dz);
  turnTo(e, target.x, target.z, dt);
  if (d < 0.05) return true;
  if (check) {
    // Höhenunterschied voraus: hinaufklettern oder herunterspringen
    const ax = e.pos.x + dx / d * 0.22, az = e.pos.z + dz / d * 0.22, gh = groundAt(ax, az);
    if (Math.abs(gh - e.y) > STEP) {
      const to = new THREE.Vector3(e.pos.x + dx / d * 0.42, gh, e.pos.z + dz / d * 0.42);
      if (!walkable(to.x, to.z) || Math.abs(groundAt(to.x, to.z) - gh) > STEP) to.set(ax, gh, az);
      e.climb = { from: e.pos.clone().setY(e.y), to, t: 0, T: gh > e.y ? 1.3 : 0.45, up: gh > e.y };
      e.state = 'climbUp';
      return false;
    }
  }
  const step = Math.min(d, e.speed * dt);
  const nx = e.pos.x + dx / d * step, nz = e.pos.z + dz / d * step;
  if (!check || walkable(nx, nz)) { e.pos.x = nx; e.pos.z = nz; }
  animWalk(e, dt);
  return false;
}
function animWalk(e, dt, k = 1) {
  e.phase += dt * e.speed * 7;
  const s = Math.sin(e.phase) * k;
  e.legs[0].top.rotation.x = s * 0.5; e.legs[1].top.rotation.x = -s * 0.5;
  e.legs[0].mid.rotation.x = Math.max(0, -Math.cos(e.phase)) * 0.7 * k;
  e.legs[1].mid.rotation.x = Math.max(0, Math.cos(e.phase)) * 0.7 * k;
  e.arms[0].top.rotation.x = -s * 0.4 - 0.2; e.arms[1].top.rotation.x = s * 0.3 - 0.5;
  e.arms[0].mid.rotation.x = -0.35; e.arms[1].mid.rotation.x = -0.6;
  e.torso.rotation.x = 0.08; e.torso.rotation.y = s * 0.08;
  e.head.rotation.z = Math.sin(e.phase * 0.5) * 0.08;
  e.body.position.y = Math.abs(Math.cos(e.phase)) * 0.025;
  e.jaw.rotation.x = 0;
  e.stepT -= dt;
  if (e.stepT <= 0 && k > 0.5) { e.stepT = Math.PI / (e.speed * 7); SFX3D.step && SFX3D.step(e.pos.clone().setY(e.y), 0.6); }
}
function animRest(e, k) {
  for (const l of e.legs) { l.top.rotation.x *= k; l.mid.rotation.x *= k; }
  e.body.position.y *= k;
}
// Angriff: ausholen (Schwert über den Kopf, gut sichtbar) → zuschlagen → zurück
const WINDUP = 0.65, STRIKE = 0.18, RECOVER = 0.5;
function animAttack(e, dt) {
  animRest(e, 0.85);
  const p = e.atkPhase;
  let raise = 0, swing = 0;
  if (p >= 0 && p < WINDUP) raise = THREE.MathUtils.smoothstep(p, 0, WINDUP);
  else if (p >= WINDUP && p < WINDUP + STRIKE) { const k = (p - WINDUP) / STRIKE; raise = 1 - k; swing = k; }
  else if (p >= WINDUP + STRIKE) swing = Math.max(0, 1 - (p - WINDUP - STRIKE) / RECOVER);
  e.arms[1].top.rotation.x = -0.5 - raise * 2.5 + swing * 1.2;
  e.arms[1].mid.rotation.x = -0.6 - raise * 0.6;
  e.arms[0].top.rotation.x = -0.6; e.arms[0].mid.rotation.x = -0.7;
  e.torso.rotation.x = 0.1 - raise * 0.2 + swing * 0.35;
  e.jaw.rotation.x = 0.2 + Math.sin(e.t * 18) * 0.12; // Klappern
}

function crumble(e, dir) {
  e.state = 'dead';
  e.t = 0;
  SFX3D.death && SFX3D.death(e.pos.clone().setY(e.y + 1), 'walker');
  e.root.updateMatrixWorld(true);
  const parts = [];
  e.root.traverse(o => { if (o.isMesh && (o.material === boneMat || o.material === rustMat)) parts.push(o); });
  for (const m of parts) {
    const v = new THREE.Vector3(rand(-1, 1), rand(0.5, 2), rand(-1, 1));
    if (dir) v.addScaledVector(dir, 1.5);
    addDebris(m, v, rand(2.5, 4));
  }
  puff(e.pos.clone().setY(e.y + 0.6), 0xcfc6a8, 0.25, 1.2, 0.3, 0.5);
}

// head = Kopfposition des Spielers, playerFloor = Bodenhöhe unter dem Spieler (0 oder Bett/Tisch)
export function updateEnemies(dt, head, playerFloor = 0) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.t += dt;
    if (e.state === 'dead') {
      if (e.t > 0.2) { scene.remove(e.root); enemies.splice(i, 1); }
      continue;
    }
    // gelegentliches Stöhnen/Klappern
    e.groanT -= dt;
    if (e.groanT <= 0) { e.groanT = rand(4, 9); SFX3D.groan && SFX3D.groan(e.pos.clone().setY(e.y + 1.6), rand(1.1, 1.4), 'walker'); }

    if (e.stagger > 0) { // taumelt nach einem Treffer
      e.stagger -= dt;
      e.torso.rotation.x = -0.35 * Math.min(1, e.stagger * 3);
      e.head.rotation.x = -0.3 * Math.min(1, e.stagger * 3);
      e.arms[0].top.rotation.x = e.arms[1].top.rotation.x = -0.9;
      animRest(e, 0.85);
      if (e.stagger <= 0) e.head.rotation.x = 0;
    } else if (e.state === 'rise') { // aus dem Boden steigen
      e.body.position.y = Math.min(0, e.body.position.y + dt * 1.2);
      turnTo(e, head.x, head.z, dt);
      if (Math.random() < dt * 8) puff(e.pos.clone().setY(0.05), 0x5a4a3a, 0.15, 0.8, 0.2, 0.4);
      if (e.body.position.y >= 0) e.state = 'walk';
    } else if (e.state === 'approach') { // draußen zur Öffnung laufen
      if (walkTo(e, e.entry, dt)) {
        if (e.opening.type === 'window') { e.state = 'climbIn'; e.t = 0; e.climbFrom = e.pos.clone(); }
        else e.state = 'enter';
      }
    } else if (e.state === 'enter') { // durch die Tür hinein
      if (walkTo(e, e.inside, dt)) e.state = 'walk';
    } else if (e.state === 'climbIn') { // durchs Fenster klettern: hoch auf die Brüstung, rüber, herunterspringen
      const sill = Math.min(1.4, e.opening.bottom);
      const k = Math.min(1, e.t / 1.6);
      e.pos.lerpVectors(e.climbFrom, e.inside, THREE.MathUtils.smoothstep(k, 0.25, 0.85));
      const up = k < 0.4 ? THREE.MathUtils.smoothstep(k, 0, 0.4) : k < 0.75 ? 1 : 1 - THREE.MathUtils.smoothstep(k, 0.75, 1);
      e.body.position.y = up * sill;
      climbPose(e, k);
      if (k >= 1) { e.body.position.y = 0; e.state = 'walk'; SFX3D.step && SFX3D.step(e.pos, 1.2); }
    } else if (e.state === 'climbUp') { // auf ein Hindernis klettern bzw. herunterspringen
      const c = e.climb;
      c.t += dt;
      const k = Math.min(1, c.t / c.T);
      if (c.up) { // erst hochziehen, dann nach vorne
        e.y = THREE.MathUtils.lerp(c.from.y, c.to.y, THREE.MathUtils.smoothstep(k, 0.05, 0.7));
        e.pos.lerpVectors(c.from, c.to, THREE.MathUtils.smoothstep(k, 0.45, 1)).setY(0);
        climbPose(e, k);
      } else { // herunterspringen (kleiner Bogen)
        e.pos.lerpVectors(c.from, c.to, k).setY(0);
        e.y = THREE.MathUtils.lerp(c.from.y, c.to.y, k * k) + Math.sin(k * Math.PI) * 0.12;
        animRest(e, 0.8);
      }
      if (k >= 1) { e.y = c.to.y; e.state = 'walk'; e.path = null; e.climb = null; SFX3D.step && SFX3D.step(e.pos.clone().setY(e.y), 1.1); }
    } else if (e.state === 'walk' || e.state === 'attack') { // im Raum zum Spieler
      const d = hyp(head.x - e.pos.x, head.z - e.pos.z);
      const sameLevel = Math.abs(playerFloor - e.y) < 0.45; // Spieler auf dem Bett: erst hochklettern
      if (e.state === 'walk' && d < ATTACK_DIST && sameLevel) { e.state = 'attack'; e.atkT = rand(0.1, 0.5); }
      if (e.state === 'attack' && (d > ATTACK_DIST + 0.35 || !sameLevel)) { e.state = 'walk'; e.path = null; e.atkPhase = -1; }
      if (e.state === 'walk') {
        e.pathT -= dt;
        if (!e.path || e.pathT <= 0 || !e.path.length) { e.path = findPath(e.pos, new THREE.Vector3(head.x, 0, head.z)); e.pathT = rand(0.8, 1.2); }
        const next = e.path[0];
        if (next && walkTo(e, next, dt, true)) e.path.shift();
      } else {
        turnTo(e, head.x, head.z, dt);
        if (e.atkPhase < 0) { // zwischen zwei Schlägen kurz warten
          e.atkT -= dt;
          animRest(e, 0.9);
          e.arms[1].top.rotation.x = THREE.MathUtils.lerp(e.arms[1].top.rotation.x, -0.5, dt * 6);
          if (e.atkT <= 0) { e.atkPhase = 0; SFX3D.swing && SFX3D.swing(e.pos.clone().setY(e.y + 1.4)); }
        } else {
          const before = e.atkPhase;
          e.atkPhase += dt;
          if (before < WINDUP + STRIKE * 0.6 && e.atkPhase >= WINDUP + STRIKE * 0.6) onStrike(e); // Treffer-Moment
          if (e.atkPhase > WINDUP + STRIKE + RECOVER) { e.atkPhase = -1; e.atkT = rand(0.5, 1.2); }
        }
        animAttack(e, dt);
      }
      // auf einer Oberfläche bleiben: Bodenhöhe nachführen (kleine Stufen ohne Klettern)
      const g = groundAt(e.pos.x, e.pos.z);
      if (Math.abs(g - e.y) <= STEP) e.y = THREE.MathUtils.lerp(e.y, g, Math.min(1, dt * 10));
    }
    // Abstand zu anderen Skeletten und zum Spieler halten (nur im Raum)
    if (e.state === 'walk' || e.state === 'attack') {
      for (const o of enemies) {
        if (o === e || o.state === 'dead') continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = hyp(dx, dz);
        if (d > 0.001 && d < 0.45 && Math.abs(o.y - e.y) < 0.5) { const push = (0.45 - d) * 0.5 * Math.min(1, dt * 10); const nx = e.pos.x + dx / d * push, nz = e.pos.z + dz / d * push; if (walkable(nx, nz) && Math.abs(groundAt(nx, nz) - e.y) < STEP) { e.pos.x = nx; e.pos.z = nz; } }
      }
      const px = e.pos.x - head.x, pz = e.pos.z - head.z, pd = hyp(px, pz);
      if (pd > 0.001 && pd < 0.5) { const nx = head.x + px / pd * 0.5, nz = head.z + pz / pd * 0.5; if (Math.abs(groundAt(nx, nz) - e.y) < STEP) { e.pos.x = nx; e.pos.z = nz; } }
    }
    e.root.position.set(e.pos.x, e.y, e.pos.z);
    e.root.rotation.y = e.yaw;
  }
}
// Kletter-Pose: Arme nach vorne/oben greifen, Knie anziehen (k = Fortschritt 0..1)
function climbPose(e, k) {
  const s = Math.sin(k * Math.PI);
  e.arms[0].top.rotation.x = e.arms[1].top.rotation.x = -1.4 * (1 - k * 0.6);
  e.legs[0].top.rotation.x = -0.9 * s; e.legs[0].mid.rotation.x = 1.1 * s;
  e.legs[1].top.rotation.x = -0.5 * s; e.legs[1].mid.rotation.x = 0.8 * s;
  e.torso.rotation.x = 0.4 * s;
}
