import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { world } from './physics.js?v=13';
import { L1, L2, THIGH, SHIN } from './fighter.js?v=13';

// =============================================================================
// Hybrides Ragdoll: Im Kampf bewegt die prozedurale Animation den Körper. Bei Tod oder Sturz übernimmt
// die vorhandene Physik (cannon-es, dieselbe Welt wie Waffen und Raum – keine zweite Physik-Engine):
// 11 Körperteile (Kopf, Rumpf, Becken, Ober-/Unterarme, Ober-/Unterschenkel), verbunden mit Kegelgelenken
// mit Grenzen. Der Startimpuls kommt aus Trefferpunkt, -richtung, Wucht und eigener Bewegung.
// Budget: höchstens ragOpts.max Ragdolls werden gleichzeitig simuliert. Ruhende werden eingefroren
// (die Figur bleibt genau so liegen, nur die Physik-Körper werden entfernt) und lassen sich wieder anstoßen.
// Ist das Budget voll und keiner ruht, fällt der Gegner mit der prozeduralen Animation (vereinfacht).
// =============================================================================
export const ragOpts = { enabled: true, max: 2, showImpulse: false };
export const ragStats = { active: 0, frozen: 0, fallback: 0, created: 0, reactivated: 0, maxActive: 0, unstable: 0 };
const GROUP_RAG = 2;  // Ragdoll-Teile kollidieren mit Boden, Raum und Waffen – nicht untereinander (stabil, kein Verhaken)
const active = [];
let scene = null;
export function initRagdolls(s) { scene = s; }

// Körperteile: Knochen, Form (halbe Maße; Kopf als Quader – eine Kugel rollt am Boden endlos hin und her), Mittelpunkt im Knochen-Raum, Masse, Gelenk zum Elternteil.
// joint.rest: Mittelachse des Kegels im Raum des Eltern-Knochens (anatomisch: Knie beugt nur nach hinten,
// Wirbelsäule/Hals um die aufrechte Haltung). Ohne rest: Kegel um die Haltung im Moment des Sturzes – dort bleibt
// die Verdrehung frei (cannon-es misst sie über Tangenten, die in den beiden Körpern verschieden liegen; eine Grenze
// würde von Anfang an verletzt und das Gelenk zittern lassen).
const KNEE = [0, -Math.cos(0.75), -Math.sin(0.75)]; // Kegelmitte 0,75 rad gebeugt, ±0,8 → Knie von gestreckt bis tief gebeugt, nie nach vorne
const SEGS = [
  { id: 'hips', bone: (e) => e.hips, box: [0.15, 0.1, 0.1], c: [0, -0.02, 0], m: 12 },
  { id: 'torso', bone: (e) => e.torso, box: [0.17, 0.24, 0.11], c: [0, 0.27, 0], m: 20, parent: 'hips', joint: { rest: [0, 1, 0], child: [0, 1, 0], angle: 0.55, twist: 0.8 } },
  { id: 'head', bone: (e) => e.head, box: [0.1, 0.12, 0.11], c: [0, 0.1, 0], m: 5, damp: 0.85, parent: 'torso', joint: { rest: [0, 1, 0], child: [0, 1, 0], angle: 0.7, twist: 1.2 } },
  { id: 'uaR', bone: (e) => e.arms[0].top, box: [0.05, L1 / 2, 0.05], c: [0, -L1 / 2, 0], m: 2.5, parent: 'torso', joint: { angle: 1.2, twist: 0.6 } },
  { id: 'faR', bone: (e) => e.arms[0].mid, box: [0.045, L2 / 2, 0.045], c: [0, -L2 / 2, 0], m: 1.6, parent: 'uaR', joint: { angle: 0.9, twist: 0.2 } },
  { id: 'uaL', bone: (e) => e.arms[1].top, box: [0.05, L1 / 2, 0.05], c: [0, -L1 / 2, 0], m: 2.5, parent: 'torso', joint: { angle: 1.2, twist: 0.6 } },
  { id: 'faL', bone: (e) => e.arms[1].mid, box: [0.045, L2 / 2, 0.045], c: [0, -L2 / 2, 0], m: 1.6, parent: 'uaL', joint: { angle: 0.9, twist: 0.2 } },
  { id: 'thR', bone: (e) => e.legs[0].top, box: [0.075, THIGH / 2, 0.075], c: [0, -THIGH / 2, 0], m: 8, parent: 'hips', joint: { angle: 0.85, twist: 0.3 } },
  { id: 'shR', bone: (e) => e.legs[0].mid, box: [0.06, SHIN / 2, 0.06], c: [0, -SHIN / 2, 0], m: 4, parent: 'thR', joint: { rest: KNEE, child: [0, -1, 0], angle: 0.8, twist: 0.25 } },
  { id: 'thL', bone: (e) => e.legs[1].top, box: [0.075, THIGH / 2, 0.075], c: [0, -THIGH / 2, 0], m: 8, parent: 'hips', joint: { angle: 0.85, twist: 0.3 } },
  { id: 'shL', bone: (e) => e.legs[1].mid, box: [0.06, SHIN / 2, 0.06], c: [0, -SHIN / 2, 0], m: 4, parent: 'thL', joint: { rest: KNEE, child: [0, -1, 0], angle: 0.8, twist: 0.25 } }
];
export const SEG_IDS = SEGS.map(s => s.id);
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _mi = new THREE.Matrix4();
const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _ax = new THREE.Vector3();
const cv = (v) => new CANNON.Vec3(v.x, v.y, v.z);

// Startet ein Ragdoll für Gegner e. hit = { point, dir, power, carry (eigene Geschwindigkeit) }.
// Liefert das Ragdoll oder null (Budget voll / ausgeschaltet → prozedurale Animation).
export function startRagdoll(e, hit = null) {
  if (!ragOpts.enabled || ragOpts.max <= 0) { ragStats.fallback++; return null; }
  if (e.rag && e.rag.state === 'active') return e.rag;
  while (active.length >= ragOpts.max) {
    // ruhigstes bzw. ältestes Ragdoll einfrieren – aber keines mitten im schnellen Fall
    let cand = null;
    for (const R of active) if (!cand || R.still > cand.still || (R.still === cand.still && R.t > cand.t)) cand = R;
    if (cand && (cand.still > 0.2 || cand.t > 1.3)) freeze(cand);
    else { ragStats.fallback++; return null; }
  }
  const reactivate = !!e.rag;
  e.root.updateMatrixWorld(true);
  const s = e.scale, R = { e, parts: {}, list: [], cons: [], t: 0, still: 0, state: 'active', keep: false };
  const power = hit ? Math.min(60, hit.power || 15) : 10;
  for (const S of SEGS) {
    const bone = S.bone(e);
    bone.getWorldPosition(_p); bone.getWorldQuaternion(_q);
    const c = new THREE.Vector3(...S.c).multiplyScalar(s);
    const shape = S.sphere ? new CANNON.Sphere(S.sphere * s) : new CANNON.Box(new CANNON.Vec3(S.box[0] * s, S.box[1] * s, S.box[2] * s));
    const body = new CANNON.Body({ mass: S.m, linearDamping: 0.12, angularDamping: S.damp || (S.m < 3 ? 0.8 : 0.6), collisionFilterGroup: GROUP_RAG, collisionFilterMask: 1, allowSleep: true, sleepSpeedLimit: 0.15, sleepTimeLimit: 0.4 });
    body.addShape(shape);
    _c.copy(c).applyQuaternion(_q).add(_p);
    body.position.set(_c.x, Math.max(_c.y, (S.sphere || S.box[1]) * s * 0.5), _c.z); // nie unter dem Boden starten
    body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
    // Startbewegung: eigene Bewegung + Treffer; nahe Körperteile werden stärker geschoben (begrenzt → keine Explosion)
    if (hit && hit.carry) body.velocity.set(hit.carry.x, 0, hit.carry.z);
    if (hit && hit.dir) {
      const near = hit.point ? Math.max(0.3, 1 - _c.distanceTo(hit.point) / 0.8) : 0.6;
      const up = Math.max(0, _c.y - e.pos.y - e.y - 0.5); // obere Körperhälfte kippt stärker
      const k = Math.min(3.2, 0.5 + power / 20) * near * (0.55 + 0.6 * up);
      _v.copy(hit.dir).setY(Math.max(0, hit.dir.y) * 0.25).normalize();
      body.velocity.x += _v.x * k; body.velocity.y += _v.y * k; body.velocity.z += _v.z * k;
      body.angularVelocity.set((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5);
    }
    world.addBody(body);
    const P = { S, bone, body, c };
    R.parts[S.id] = P; R.list.push(P);
  }
  // Gelenke: Drehpunkt = Ursprung des Kind-Knochens
  for (const S of SEGS) {
    if (!S.parent) continue;
    const PA = R.parts[S.parent], PB = R.parts[S.id], A = PA.body, B = PB.body;
    PB.bone.getWorldPosition(_p);
    const pa = new CANNON.Vec3(), pb = new CANNON.Vec3();
    A.pointToLocalFrame(cv(_p), pa); B.pointToLocalFrame(cv(_p), pb);
    let axisA, axisB;
    if (S.joint.rest) { // anatomische Grundachse im Raum des Elternteils (Körper-Raum = Knochen-Raum)
      axisA = new CANNON.Vec3(...S.joint.rest); axisB = new CANNON.Vec3(...S.joint.child);
    } else {            // Kegel um die momentane Richtung des Kind-Knochens
      PB.bone.getWorldQuaternion(_q);
      _ax.set(0, -1, 0).applyQuaternion(_q);
      _q2.set(A.quaternion.x, A.quaternion.y, A.quaternion.z, A.quaternion.w).invert();
      axisA = cv(_v.copy(_ax).applyQuaternion(_q2));
      axisB = new CANNON.Vec3(0, -1, 0);
    }
    const con = new CANNON.ConeTwistConstraint(A, B, { pivotA: pa, pivotB: pb, axisA, axisB, angle: S.joint.angle, twistAngle: S.joint.rest ? S.joint.twist : Math.PI, collideConnected: false, maxForce: 1e6 });
    world.addConstraint(con);
    R.cons.push(con);
  }
  e.body.rotation.set(0, 0, 0); e.body.position.set(0, 0, 0);
  e.rag = R;
  active.push(R);
  ragStats.created++;
  if (reactivate) ragStats.reactivated++;
  ragStats.active = active.length;
  ragStats.maxActive = Math.max(ragStats.maxActive, active.length);
  if (hit && hit.dir && ragOpts.showImpulse) showArrow(hit.point || _c.copy(e.pos).setY(1), hit.dir, power);
  syncBones(R);
  return R;
}
// Stoß auf ein fallendes/liegendes Ragdoll (z. B. Treffer auf einen Gefallenen)
export function pokeRagdoll(R, point, dir, power) {
  if (!R || R.state !== 'active') return;
  for (const P of R.list) {
    const b = P.body, d = _v.set(b.position.x, b.position.y, b.position.z).distanceTo(point);
    if (d > 0.5) continue;
    const k = Math.min(2.5, power / 22) * (1 - d / 0.5);
    b.wakeUp();
    b.velocity.x += dir.x * k; b.velocity.y += Math.max(0, dir.y) * k + 0.25 * k; b.velocity.z += dir.z * k;
  }
  R.still = 0;
  if (ragOpts.showImpulse) showArrow(point, dir, power);
}
// Physik-Körper entfernen, Pose bleibt sichtbar liegen (kein Teleport)
export function freeze(R) {
  if (!R || R.state !== 'active') return;
  syncBones(R);
  for (const c of R.cons) world.removeConstraint(c);
  for (const P of R.list) world.removeBody(P.body);
  R.state = 'frozen';
  const i = active.indexOf(R); if (i >= 0) active.splice(i, 1);
  ragStats.active = active.length; ragStats.frozen++;
}
export function clearRagdolls() { for (const R of active.slice()) freeze(R); }
export const activeRagdolls = () => active.length;

// Knochen aus den Physik-Körpern setzen (Eltern zuerst – Reihenfolge von SEGS)
const _hq = new THREE.Quaternion();
function syncBones(R) {
  const e = R.e;
  e.root.updateMatrixWorld(true);
  _s.setScalar(e.scale);
  for (const P of R.list) {
    const b = P.body, bone = P.bone;
    _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    _p.set(b.position.x, b.position.y, b.position.z).sub(_c.copy(P.c).applyQuaternion(_q));
    _m.compose(_p, _q, _s);
    _mi.copy(bone.parent.matrixWorld).invert().multiply(_m);
    _mi.decompose(bone.position, bone.quaternion, _v);
    bone.updateMatrix();
    bone.matrixWorld.multiplyMatrices(bone.parent.matrixWorld, bone.matrix); // nur dieser Knochen; Kinder folgen in der Schleife
  }
  // gehaltene Waffe/Schild bleiben in der Hand (Ende des Unterarms)
  const wa = e.handed > 0 ? 0 : 1;
  e.root.updateMatrixWorld(true);
  e.body.getWorldQuaternion(_hq).invert();
  if (e.weapon) {
    const fa = e.arms[wa].mid;
    e.body.worldToLocal(fa.localToWorld(e.weapon.position.set(0, -L2 * 0.95, 0)));
    e.weapon.quaternion.copy(_hq).multiply(fa.getWorldQuaternion(_q)); e.weapon.rotateX(Math.PI * 0.55);
  }
  if (e.shield) {
    const fa = e.arms[1 - wa].mid;
    e.body.worldToLocal(fa.localToWorld(e.shield.position.set(0, -L2 * 0.6, 0.05)));
    e.shield.quaternion.copy(_hq).multiply(fa.getWorldQuaternion(_q)); e.shield.rotateX(-Math.PI / 2);
  }
  if (e.blob) { const h = R.parts.hips.body.position; e.blob.position.set(h.x, Math.max(0, e.y) + 0.006, h.z); }
  e.root.updateMatrixWorld(true);
}
// jedes Bild (nach dem Physik-Schritt): Ragdolls in die Knochen übertragen, ruhende einfrieren
export function updateRagdolls(dt) {
  for (let i = active.length - 1; i >= 0; i--) {
    const R = active[i];
    R.t += dt;
    let maxV = 0, bad = false;
    for (const P of R.list) {
      const b = P.body, v = b.velocity, len = Math.hypot(v.x, v.y, v.z);
      if (!isFinite(len) || !isFinite(b.position.x) || b.position.y < -0.5) bad = true;
      if (len > 8) v.scale(8 / len, v); // Sicherheitsgrenze gegen Ausreißer
      if (len > maxV) maxV = len;
    }
    if (bad) { ragStats.unstable++; for (const P of R.list) { P.body.velocity.set(0, 0, 0); P.body.angularVelocity.set(0, 0, 0); } freeze(R); continue; }
    syncBones(R);
    R.still = maxV < 0.2 ? R.still + dt : 0;
    if ((R.still > 0.8 || R.t > 8) && !R.keep) freeze(R);
  }
}
// Beim Aufstehen: aktuelle (liegende) Lage aller Knochen merken – daraus wird in die Animation übergeblendet
export function capturePose(e) {
  return SEGS.map(S => { const b = S.bone(e); return { bone: b, q: b.quaternion.clone(), p: b.position.clone() }; });
}
// Becken-Position in Welt (für die Position nach dem Aufstehen)
export function pelvisPos(R, out) { const b = R.parts.hips.body.position; return out.set(b.x, b.y, b.z); }

// ---- Anzeige der Stöße (Test-Menü) --------------------------------------------------------------
const arrows = [];
function showArrow(point, dir, power) {
  if (!scene) return;
  let a = arrows.find(x => x.life <= 0);
  if (!a) { if (arrows.length >= 4) a = arrows[0]; else { a = { obj: new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.5, 0xff3030, 0.1, 0.06), life: 0 }; a.obj.renderOrder = 30; arrows.push(a); scene.add(a.obj); } }
  a.obj.position.copy(point);
  a.obj.setDirection(_v.copy(dir).normalize());
  a.obj.setLength(Math.min(1.2, 0.2 + power / 50), 0.1, 0.06);
  a.obj.visible = true; a.life = 1.5;
}
export function updateRagArrows(dt) {
  for (const a of arrows) if (a.life > 0) { a.life -= dt; if (a.life <= 0 || !ragOpts.showImpulse) { a.life = 0; a.obj.visible = false; } }
}
