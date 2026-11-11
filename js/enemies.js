import * as THREE from 'three';
import { surfacesOf } from './room.js?v=4';
import { buildNav, findPath, walkable, nearestWalkable } from './nav.js?v=4';
import { SFX3D } from './sfx.js?v=4';
import { puff, addDebris } from './effects.js?v=4';

// =============================================================================
// Gegner: Skelette kommen von draußen durch Türen (laufen durch) und Fenster (klettern hinein),
// laufen um Wände/Tische/Stühle herum zum Spieler.
// Noch ohne Kampf: Beim Spieler holen sie aus (harmlos) und zerfallen nach einer Weile.
// =============================================================================
let scene = null;
export const enemies = [];
export function initEnemies(s) { scene = s; }
export const aliveCount = () => enemies.filter(e => e.state !== 'dead').length;

const SPEED = 0.6;         // Gehtempo (m/s)
const ATTACK_DIST = 0.65;  // ab dieser Entfernung zum Spieler: ausholen
const ATTACK_TIME = 12;    // so lange bleibt ein Skelett beim Spieler, dann zerfällt es
const OUTSIDE = 1.6;       // so weit vor der Tür/dem Fenster erscheinen sie (draußen)
const UP = new THREE.Vector3(0, 1, 0);
const rand = THREE.MathUtils.randFloat;
const hyp = (a, b) => Math.sqrt(a * a + b * b);

// ---- Aussehen: Knochen aus einfachen Formen ------------------------------------------
const boneMat = new THREE.MeshStandardMaterial({ color: 0xd9d0b4, roughness: 0.75 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 });
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3a1a, toneMapped: false });
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
  foot: new THREE.BoxGeometry(0.07, 0.03, 0.16)
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
  for (const l of legs) { const f = mesh(geo.foot); f.position.set(0, -0.42, 0.04); l.mid.add(f); l.foot = f; }
  const arms = [-1, 1].map(s => limb(torso, s * 0.19, 0.5, upperArm, foreArm, 0.29, s * 0.12));
  return { root, body, torso, head, jaw, legs, arms };
}

// ---- Erscheinen ------------------------------------------------------------------
// Ablauf je Öffnung: draußen erscheinen → zur Öffnung laufen → (Fenster: hineinklettern) → zum Spieler
export function spawnEnemy(head) {
  const opens = surfacesOf('door', 'window');
  const e = { ...buildSkeleton(), pos: new THREE.Vector3(), yaw: 0, phase: Math.random() * 6, t: 0, path: null, pathT: 0, attackT: 0, groanT: rand(2, 6), stepT: 0, speed: SPEED * rand(0.85, 1.15) };
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
// Laufwege neu berechnen (nach dem Einrichten des Raums bzw. vor jeder Runde)
export function prepareNav(head) { buildNav(head); }

// ---- Bewegung & Animation ----------------------------------------------------------
function turnTo(e, x, z, dt) {
  const want = Math.atan2(x - e.pos.x, z - e.pos.z);
  let d = want - e.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  e.yaw += d * Math.min(1, dt * 6);
}
// geradeaus zu einem Punkt gehen; true = angekommen
function walkTo(e, target, dt, check = false) {
  const dx = target.x - e.pos.x, dz = target.z - e.pos.z, d = hyp(dx, dz);
  turnTo(e, target.x, target.z, dt);
  if (d < 0.05) return true;
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
  e.arms[0].top.rotation.x = -s * 0.4 - 0.2; e.arms[1].top.rotation.x = s * 0.4 - 0.2;
  e.arms[0].mid.rotation.x = e.arms[1].mid.rotation.x = -0.35;
  e.torso.rotation.x = 0.08; e.torso.rotation.y = s * 0.08;
  e.head.rotation.z = Math.sin(e.phase * 0.5) * 0.08;
  e.body.position.y = Math.abs(Math.cos(e.phase)) * 0.025;
  e.jaw.rotation.x = 0;
  e.stepT -= dt;
  if (e.stepT <= 0 && k > 0.5) { e.stepT = Math.PI / (e.speed * 7); SFX3D.step && SFX3D.step(e.pos, 0.6); }
}
function animIdle(e, dt) {
  for (const l of e.legs) { l.top.rotation.x *= 0.9; l.mid.rotation.x *= 0.9; }
  e.body.position.y *= 0.9;
}
function animAttack(e, dt) {
  animIdle(e, dt);
  e.attackPhase = (e.attackPhase || 0) + dt * 3.2;
  const p = e.attackPhase % (Math.PI * 2);
  // Ausholen über den Kopf, dann nach unten schlagen (abwechselnd links/rechts)
  const side = Math.floor(e.attackPhase / (Math.PI * 2)) % 2;
  const raise = p < 3.6 ? Math.sin(p / 3.6 * Math.PI / 2) : Math.cos((p - 3.6) / (Math.PI * 2 - 3.6) * Math.PI / 2);
  e.arms[side].top.rotation.x = -0.3 - raise * 2.4;
  e.arms[side].mid.rotation.x = -0.4 - raise * 0.5;
  e.arms[1 - side].top.rotation.x = -0.5; e.arms[1 - side].mid.rotation.x = -0.6;
  e.torso.rotation.x = 0.15 - raise * 0.2;
  e.jaw.rotation.x = 0.25 + Math.sin(e.attackPhase * 4) * 0.15; // Klappern
}

function crumble(e) {
  e.state = 'dead';
  e.t = 0;
  // Knochen fallen auseinander
  e.root.updateMatrixWorld(true);
  const parts = [];
  e.root.traverse(o => { if (o.isMesh && o.material === boneMat) parts.push(o); });
  for (const m of parts) {
    const v = new THREE.Vector3(rand(-1, 1), rand(0.5, 2), rand(-1, 1));
    addDebris(m, v, rand(2.5, 4));
  }
  puff(e.pos.clone().setY(0.6), 0xcfc6a8, 0.25, 1.2, 0.3, 0.5);
}

export function updateEnemies(dt, head) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.t += dt;
    if (e.state === 'dead') {
      if (e.t > 0.2) { scene.remove(e.root); enemies.splice(i, 1); }
      continue;
    }
    // gelegentliches Stöhnen/Klappern
    e.groanT -= dt;
    if (e.groanT <= 0) { e.groanT = rand(4, 9); SFX3D.groan && SFX3D.groan(e.pos.clone().setY(1.6), rand(1.1, 1.4), 'walker'); }

    if (e.state === 'rise') { // aus dem Boden steigen
      e.body.position.y = Math.min(0, e.body.position.y + dt * 1.2);
      turnTo(e, head.x, head.z, dt);
      if (Math.random() < dt * 8) puff(e.pos.clone().setY(0.05), 0x5a4a3a, 0.15, 0.8, 0.2, 0.4);
      if (e.body.position.y >= 0) e.state = 'walk';
    } else if (e.state === 'approach') { // draußen zur Öffnung laufen
      if (walkTo(e, e.entry, dt)) {
        if (e.opening.type === 'window') { e.state = 'climb'; e.t = 0; e.climbFrom = e.pos.clone(); }
        else e.state = 'enter';
      }
    } else if (e.state === 'enter') { // durch die Tür hinein
      if (walkTo(e, e.inside, dt)) e.state = 'walk';
    } else if (e.state === 'climb') { // durchs Fenster klettern: hoch auf die Brüstung, rüber, herunterspringen
      const sill = Math.min(1.4, e.opening.bottom);
      const T = 1.6, k = Math.min(1, e.t / T);
      e.pos.lerpVectors(e.climbFrom, e.inside, THREE.MathUtils.smoothstep(k, 0.25, 0.85));
      const up = k < 0.4 ? THREE.MathUtils.smoothstep(k, 0, 0.4) : k < 0.75 ? 1 : 1 - THREE.MathUtils.smoothstep(k, 0.75, 1);
      e.body.position.y = up * sill;
      // Kletter-Pose: Arme nach vorne/oben greifen, Knie anziehen
      e.arms[0].top.rotation.x = e.arms[1].top.rotation.x = -1.4 * (1 - k * 0.6);
      e.legs[0].top.rotation.x = -0.9 * Math.sin(k * Math.PI); e.legs[0].mid.rotation.x = 1.1 * Math.sin(k * Math.PI);
      e.legs[1].top.rotation.x = -0.5 * Math.sin(k * Math.PI); e.legs[1].mid.rotation.x = 0.8 * Math.sin(k * Math.PI);
      e.torso.rotation.x = 0.4 * Math.sin(k * Math.PI);
      if (k >= 1) { e.body.position.y = 0; e.state = 'walk'; SFX3D.step && SFX3D.step(e.pos, 1.2); }
    } else if (e.state === 'walk') { // im Raum zum Spieler
      const d = hyp(head.x - e.pos.x, head.z - e.pos.z);
      if (d < ATTACK_DIST) { e.state = 'attack'; e.attackT = 0; }
      else {
        e.pathT -= dt;
        if (!e.path || e.pathT <= 0 || !e.path.length) { e.path = findPath(e.pos, new THREE.Vector3(head.x, 0, head.z)); e.pathT = rand(0.8, 1.2); }
        const next = e.path[0];
        if (next && walkTo(e, next, dt, true)) e.path.shift();
      }
    } else if (e.state === 'attack') {
      turnTo(e, head.x, head.z, dt);
      animAttack(e, dt);
      e.attackT += dt;
      if (hyp(head.x - e.pos.x, head.z - e.pos.z) > ATTACK_DIST + 0.35) { e.state = 'walk'; e.path = null; }
      if (e.attackT > ATTACK_TIME) { crumble(e); continue; }
    }
    // Abstand zu anderen Skeletten halten (nur im Raum)
    if (e.state === 'walk' || e.state === 'attack') {
      for (const o of enemies) {
        if (o === e || o.state === 'dead') continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = hyp(dx, dz);
        if (d > 0.001 && d < 0.45) { const push = (0.45 - d) * 0.5 * Math.min(1, dt * 10); const nx = e.pos.x + dx / d * push, nz = e.pos.z + dz / d * push; if (walkable(nx, nz)) { e.pos.x = nx; e.pos.z = nz; } }
      }
      // nie in den Spieler hineinlaufen
      const px = e.pos.x - head.x, pz = e.pos.z - head.z, pd = hyp(px, pz);
      if (pd > 0.001 && pd < 0.5) { e.pos.x = head.x + px / pd * 0.5; e.pos.z = head.z + pz / pd * 0.5; }
    }
    e.root.position.copy(e.pos);
    e.root.rotation.y = e.yaw;
  }
}
