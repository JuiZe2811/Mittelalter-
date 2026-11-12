import * as THREE from 'three';
import { surfacesOf, roomOccluders } from './room.js?v=12';
import { buildNav, findPath, walkable, nearestWalkable, groundAt, STEP } from './nav.js?v=12';
import { SFX, SFX3D } from './sfx.js?v=12';
import { puff, addDebris, burst, sparks, floorDecal, floatingText } from './effects.js?v=12';
import { segSeg, segPoint, segDisc, slerpDir } from './geom.js?v=12';
import { makeArrowMesh, ARROW_LEN } from './arrow.js?v=12';
import { HIP, SH_X, SH_Y, L1, L2, THIGH, SHIN, REACH, ENEMY_TYPES, TYPE_ORDER, ATK, EW, PARRY, SHIELD_POSE, SHIELD_R, SHIELD_HP, STANCES, bloodMat, buildFighter, makeWeapon, makeShield, makeBlob, warmFaces } from './fighter.js?v=12';
import { startRagdoll, pokeRagdoll, freeze as freezeRagdoll, updateRagdolls, capturePose, initRagdolls, updateRagArrows, ragOpts, ragStats } from './ragdoll.js?v=12';
import { aiOpts, PERSONAS, PERSONA_ORDER, pickPersona, makeAttrs, newKnow, observe, tickKnow, share, patterns, MORALE } from './ai.js?v=12';
export { ragOpts, ragStats, aiOpts, PERSONAS, PERSONA_ORDER, patterns };

// =============================================================================
// Gegner: menschliche Kämpfer mit echtem Kampfverhalten.
//  · Jeder Angriff ist eine echte Waffenbahn (Ausholen → Schlag → Durchschwung). Ob er trifft,
//    entscheidet die Geometrie: Schild oder Klinge des Spielers im Weg = Block/Parade, sonst Treffer.
//    Wer rechtzeitig zurückweicht oder sich wegduckt, wird nicht getroffen.
//  · Gegner blocken selbst mit Schild, parieren mit der Waffe, weichen aus, fintieren, schlagen Kombos.
//  · Trefferzonen (Kopf, Rumpf, Arme, Beine) mit Rüstung und Folgen: hinken, knien, entwaffnet,
//    Schild fällt, benommen, Blutung, Flucht.
// =============================================================================
export { ENEMY_TYPES, TYPE_ORDER };
let scene = null, frame = 0, clock = 0;
export const enemies = [];
// Schnittstelle zum Spieler: main.js füllt Kopf, Schilde und Klingen jedes Bild und setzt die Rückrufe
export const player = {
  head: new THREE.Vector3(0, 1.6, 0), vel: new THREE.Vector3(), floor: 0, bodyR: 0.19,
  shields: [], // { c, n, r, w }
  blades: [],  // { a, b, vel, speed, twoHand, w }
  aim: null,   // { o, d } solange der Spieler mit gespanntem Bogen / geladener Armbrust zielt
  look: new THREE.Vector3(0, 0, -1), ranged: false, reach: 0.55, shieldStun: 0, stam: 100, // stam: Ausdauer des Spielers (erschöpft = Blocks werden durchgeschlagen) // Blickrichtung · hält Fernwaffe · Schild weggetreten bis (Zeit)
  hit() {}, blocked() {}, arrowStuck() {}, defeated() {},
  floorWeapons() { return []; }, // [{ id, pos, take() }] – Waffen am Boden, die ein entwaffneter Gegner aufheben kann
  dropped() { return false; }, // eine Waffe/ein Schild fällt: main.js macht daraus eine aufhebbare Waffe (true = übernommen)
  grabbed() {},  // (e, w, u) ein Gegner packt die Waffe w des Spielers an der Stelle u (0 = Griff, 1 = Spitze)
  disarmed() {}, // (e, w) der Gegner reißt dem Spieler die Waffe aus der Hand
  say() {}       // (e, text) Stimme eines Gegners (z. B. beim Ergeben)
};
export const ai = { lastStart: -9 }; // gemeinsamer Zustand der Gruppe (kein gleichzeitiger Angriffsbeginn)
// Einstellungen: Schaden, Reaktionsvermögen und Tempo der Gegner, Texte, gleichzeitige Angreifer
export const opts = { dmg: 1, react: 1, speed: 1, texts: true, tokens: 2 };
export function initEnemies(s) { scene = s; initRagdolls(s); }
// Ergebene Gegner zählen nicht mehr als Angreifer
export const aliveCount = () => enemies.filter(e => e.state !== 'dead' && e.state !== 'yield').length;
export function prepareNav(head) { buildNav(head); }

const LIMP = 22, CRIP = 50;   // Verletzung einer Zone: ab hier beeinträchtigt / unbrauchbar
const OUTSIDE = 1.6;
const rand = THREE.MathUtils.randFloat, clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp, damp = THREE.MathUtils.damp;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const V = () => new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0), ZAXIS = new THREE.Vector3(0, 0, 1);
const t1 = V(), t2 = V(), t3 = V(), t4 = V(), t5 = V(), t6 = V(), t7 = V(), t8 = V();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4();
const BLOOD = 0x8a0a0a;
const tokens = new Set(); // wer gerade angreifen darf (die anderen umkreisen den Spieler)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const tac = { t: 0, backstabber: null };
// KI-Regler (Test-Menü) und Moral fließen hier ein
const RE = () => opts.react * aiOpts.react * aiOpts.diff;              // Reaktionsvermögen
const DM = () => opts.dmg * aiOpts.diff;                               // Schaden der Gegner
const DF = (v) => Math.min(0.97, v * aiOpts.defense);                 // Verteidigung (Parade, Schild, Ausweichen)
const AG = (e) => e.A.aggro * aiOpts.aggro * (e.rage > 0 ? 1.35 : 1) * (0.55 + 0.45 * Math.min(1, e.morale / 60)); // Angriffslust (Angst bremst)

// ---- Welche Gegner kommen wann -------------------------------------------------------------
export function pickType(roundT) {
  const w = roundT < 40 ? { bandit: 7, soldier: 3 }
    : roundT < 100 ? { bandit: 4, soldier: 3, shield: 2, spear: 1.5, archer: 1 }
    : roundT < 180 ? { bandit: 2.5, soldier: 3, shield: 2.5, spear: 2, halberd: 1.2, archer: 1.5, axe: 1.5, knight: 0.6 }
    : { bandit: 1.5, soldier: 2.5, shield: 2.5, spear: 2, halberd: 2, archer: 1.5, axe: 2, knight: 1.5 };
  const alive = (t) => enemies.filter(e => e.type === t && e.state !== 'dead').length;
  if (alive('archer') >= 2) delete w.archer;
  if (alive('knight') >= 1) delete w.knight;
  let sum = 0; for (const k in w) sum += w[k];
  let r = Math.random() * sum;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return 'bandit';
}

// ---- Ausrüstung --------------------------------------------------------------------------------
function setWeapon(e, id) {
  if (e.weapon) { e.body.remove(e.weapon); e.weapon = null; }
  e.weaponId = id; e.wdef = EW[id];
  if (id !== 'fist') { e.weapon = makeWeapon(id); e.body.add(e.weapon); }
  toLocalPos(e, e.wdef.guard.hp, e.wp.hp); toLocalDir(e, e.wdef.guard.bd, e.wp.bd);
}
function setShield(e, kind) {
  e.shieldKind = kind; e.shieldR = SHIELD_R[kind]; e.shieldHp = SHIELD_HP[kind];
  e.shield = makeShield(kind, e.tunic);
  e.body.add(e.shield);
  toLocalPos(e, SHIELD_POSE.mid.c, e.sp.c); toLocalDir(e, SHIELD_POSE.mid.n, e.sp.n);
}
// Gegenstand fällt zu Boden (Waffe, Schild, Helm)
// item: Waffen-Kennung bzw. 'shield' – solche Gegenstände kann der Spieler aufheben
function dropItem(e, obj, dir, item = null) {
  if (!obj) return;
  scene.attach(obj);
  const v = new THREE.Vector3(rand(-0.6, 0.6), rand(0.6, 1.6), rand(-0.6, 0.6));
  if (dir) v.addScaledVector(dir, 1.2);
  SFX.thud(0.3);
  obj.updateMatrixWorld(true);
  if (item && player.dropped(item, obj, v)) { scene.remove(obj); return; }
  addDebris(obj, v, 6);
}

// Angriffsraum → Körper-Koordinaten (r = Waffenseite; bei Linkshändern gespiegelt)
function toLocalPos(e, a, out) { return out.set(-a[0] * e.handed, a[1] - e.drop, a[2]); }
function toLocalDir(e, a, out) { return out.set(-a[0] * e.handed, a[1], a[2]).normalize(); }
const wArm = (e) => (e.handed > 0 ? 0 : 1);
const zoneOfArm = (i) => (i === 0 ? 'armR' : 'armL');
const armOk = (e, i) => !e.crip[zoneOfArm(i)];
function shoulder(e, i, out) { return out.set(e.arms[i].sx * SH_X, SH_Y, 0).applyQuaternion(e.torso.quaternion).add(e.hips.position); }
function clampReach(e, i, p, extra = 0) {
  const S = shoulder(e, i, t8), d = p.distanceTo(S), max = REACH + extra;
  if (d > max) p.sub(S).multiplyScalar(max / d).add(S);
  return p;
}

// ---- Erscheinen ------------------------------------------------------------------------------
// o: { type, speedMul, at (Vector3: direkt dort hinstellen), passive (Übungsgegner, wehrt sich nicht) }
export function spawnEnemy(head, o = {}) {
  const type = o.type && ENEMY_TYPES[o.type] ? o.type : 'bandit', T = ENEMY_TYPES[type];
  const persona = o.persona && PERSONAS[o.persona] ? o.persona : pickPersona(type), A = makeAttrs(T, persona);
  const e = Object.assign(buildFighter(type), {
    type, T, A, persona, name: T.name, pos: V(), y: 0, yaw: 0, t: 0, state: 'approach',
    morale: A.morale0 * aiOpts.morale, know: newKnow(), vel: V(), prevPos: V(), rag: null, getup: null, grab: null, grabCool: rand(2, 4), grabT: rand(0, 0.3),
    defStreak: 0, followUp: null, rage: 0, moraleT: rand(0, 0.5), noRearm: false, dbg: { atk: '', why: '' },
    hp: T.hp, maxHp: T.hp, bal: A.balance, stam: 100, balT: 0, beaten: 0, rearm: null, rollT: 0,
    inj: { head: 0, torso: 0, armR: 0, armL: 0, legR: 0, legL: 0 }, hurt: {}, crip: {}, bleed: 0, bleedT: 0,
    handed: 1, weaponId: null, wdef: null, weapon: null, shield: null, shieldKind: null, shieldR: 0, helmOff: false,
    wp: { hp: V(), bd: V() }, sp: { c: V(), n: V() }, hint: new THREE.Vector3(0, 0, 1), lastHp: V(),
    act: null, queue: [], cool: rand(0.5, 1.3), stagger: 0, staggerDir: 1, daze: 0, recoil: null, parry: null, react: null, dodge: null, bash: null, shot: null,
    threatOn: false, threatT: 0, shieldZone: 'mid', shieldHold: 0,
    path: null, pathT: 0, pathMode: 0, phase: rand(0, 6), gait: 0, moved: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1.5, 4), slot: Math.random(),
    token: false, tokenBan: 0, fighting: false, losT: 0, los: true,
    speed: T.speed * A.speed * rand(0.93, 1.07) * (o.speedMul || 1), moveMul: 1, atkSlow: 1, atkDmg: 1, kneel: false, drop: 0,
    down: null, downK: 0, fl: { hx: 0, hy: 0, lean: 0, tw: 0, dip: 0 }, taunt: null, tauntT: rand(3, 8), stance: 0, stanceT: rand(2, 5), kick: null, shieldShake: 0, shieldHp: 0,
    ang: 0, behind: false, slotDir: 0, zigT: 0, aimRoll: -1, lastHitT: -9, retreated: false, fallRoll: 0,
    lean: 0, twist: 0, leanCur: 0, twistCur: 0, passive: !!o.passive, lastAtk: null, groanT: rand(2, 6), stepPh: 0, zFrame: -1, zones: null
  });
  setWeapon(e, pick(T.weapons));
  if (T.shield) setShield(e, T.shield);
  e.blob = makeBlob(); scene.add(e.blob);
  const opens = surfacesOf('door', 'window');
  if (o.at) {
    e.pos.copy(o.at).setY(0); e.y = groundAt(e.pos.x, e.pos.z);
    e.state = 'fight';
  } else if (opens.length) {
    const op = opens[Math.floor(Math.random() * opens.length)];
    const along = op.width > 0.7 ? rand(-0.15, 0.15) * op.width : 0;
    const mid = op.mid.clone().setY(0).addScaledVector(op.right, along);
    e.opening = op;
    e.pos.copy(mid).addScaledVector(op.normal, -OUTSIDE);
    e.entry = mid.clone().addScaledVector(op.normal, op.type === 'window' ? -0.35 : 0);
    e.inside = mid.clone().addScaledVector(op.normal, 0.55);
  } else { // keine Türen/Fenster: taucht in einiger Entfernung auf
    const a = Math.random() * Math.PI * 2;
    e.pos.copy(nearestWalkable(new THREE.Vector3(head.x + Math.sin(a) * 3.4, 0, head.z + Math.cos(a) * 3.4)));
    e.state = 'rise';
    e.body.position.y = -2;
  }
  e.yaw = Math.atan2(head.x - e.pos.x, head.z - e.pos.z);
  e.prevPos.copy(e.pos);
  place(e);
  scene.add(e.root);
  enemies.push(e);
  return e;
}
function place(e) {
  if (e.blob) { e.blob.position.set(e.pos.x, Math.max(e.y, 0) + 0.006, e.pos.z); e.blob.visible = e.state !== 'approach' && e.state !== 'exit' && (e.state !== 'dead' || e.t < 9); }
  e.root.position.set(e.pos.x, e.y, e.pos.z);
  e.root.rotation.y = e.yaw;
  e.root.updateMatrixWorld(true);
}
function removeEnemy(e) {
  release(e); endGrab(e);
  if (e.rag) freezeRagdoll(e.rag);
  scene.remove(e.root);
  if (e.blob) scene.remove(e.blob);
  const i = enemies.indexOf(e);
  if (i >= 0) enemies.splice(i, 1);
}
export function clearEnemies() {
  for (const e of enemies.splice(0)) { endGrab(e); if (e.rag) freezeRagdoll(e.rag); scene.remove(e.root); if (e.blob) scene.remove(e.blob); }
  tokens.clear();
  for (const s of shots.splice(0)) scene.remove(s.obj);
}
function release(e) { tokens.delete(e); e.token = false; }

// ---- Trefferzonen (Kapseln in Weltkoordinaten) ---------------------------------------------------
function zones(e) {
  if (e.zFrame === frame && e.zones) return e.zones;
  if (!e.zones) e.zones = ['head', 'torso', 'armR', 'armR', 'armL', 'armL', 'legR', 'legR', 'legL', 'legL'].map(zone => ({ zone, a: V(), b: V(), r: 0 }));
  const Z = e.zones, s = e.scale;
  e.head.localToWorld(Z[0].a.set(0, 0.1, 0)); Z[0].b.copy(Z[0].a); Z[0].r = 0.122 * s;
  e.torso.localToWorld(Z[1].a.set(0, 0.03, 0)); e.torso.localToWorld(Z[1].b.set(0, 0.43, 0)); Z[1].r = 0.165 * s;
  for (let i = 0; i < 2; i++) {
    const A = e.arms[i], k = 2 + i * 2;
    A.top.getWorldPosition(Z[k].a); A.mid.getWorldPosition(Z[k].b); Z[k].r = 0.062 * s;
    Z[k + 1].a.copy(Z[k].b); A.mid.localToWorld(Z[k + 1].b.set(0, -L2, 0)); Z[k + 1].r = 0.052 * s;
    const Lg = e.legs[i], j = 6 + i * 2;
    Lg.top.getWorldPosition(Z[j].a); Lg.mid.getWorldPosition(Z[j].b); Z[j].r = 0.088 * s;
    Z[j + 1].a.copy(Z[j].b); Lg.mid.localToWorld(Z[j + 1].b.set(0, -SHIN, 0)); Z[j + 1].r = 0.068 * s;
  }
  e.zFrame = frame;
  return Z;
}
const chestWorld = (e, out) => e.torso.localToWorld(out.set(0, 0.34, 0));
function shieldDisc(e, c, n) { e.shield.getWorldPosition(c); n.set(0, 0, 1).transformDirection(e.shield.matrixWorld); }
// Waffen-Abschnitt (haft oder edge) in Weltkoordinaten
function weaponSeg(e, range, a, b, pose = e.wp) {
  e.body.localToWorld(a.copy(pose.hp).addScaledVector(pose.bd, range[0]));
  e.body.localToWorld(b.copy(pose.hp).addScaledVector(pose.bd, range[1]));
}

// Erster Kontakt einer Strecke a→b (Klinge, Pfeil) mit einem Gegner.
// Liefert { kind: 'shield' | 'parry' | 'body', e, zone, point } oder null.
// ordered = true: a→b ist eine Flugbahn, der früheste Kontakt zählt (Pfeile). Sonst geht Schild vor Körper.
const _sc = V(), _sn = V(), _hp = V(), _c1 = V(), _c2 = V(), _ha = V(), _hb = V(), _mid = V();
export function strikeTest(a, b, radius = 0.015, ordered = false) {
  let best = null, bestScore = Infinity;
  const len = a.distanceTo(b) || 1e-6;
  const along = (p) => t7.subVectors(p, a).dot(t6.subVectors(b, a)) / (len * len);
  const offer = (c, score) => { if (score < bestScore) { bestScore = score; best = c; } };
  for (const e of enemies) {
    if (e.state === 'dead') continue;
    _mid.set(e.pos.x, e.y + 1.0 * e.scale, e.pos.z);
    if (segPoint(a, b, _mid) > 1.5) continue;
    let blocked = false;
    if (e.shield && !e.down) {
      shieldDisc(e, _sc, _sn);
      const p = segDisc(a, b, _sc, _sn, e.shieldR * e.scale, 0.045, _hp);
      if (p) { blocked = true; offer({ kind: 'shield', e, zone: null, point: p.clone() }, ordered ? along(p) : -2); }
    }
    if (e.weapon && e.weaponId !== 'bow' && e.weaponId !== 'fist' && !e.down) {
      // Klinge an Klinge: bei aktiver Parade großzügig, sonst nur, wenn der Hieb die Waffe wirklich kreuzt
      weaponSeg(e, e.wdef.haft, _ha, _hb);
      const parrying = e.parry && e.parry.t > 0.07;
      if (segSeg(a, b, _ha, _hb, _c1) < (parrying ? 0.06 : 0.025) + radius) { blocked = true; offer({ kind: parrying ? 'parry' : 'weapon', e, zone: null, point: _c1.clone() }, ordered ? along(_c1) : parrying ? -1 : -0.6); }
    }
    if (blocked && !ordered) continue;
    for (const z of zones(e)) {
      const d = segSeg(a, b, z.a, z.b, _c1, _c2) - z.r - radius;
      if (d < 0) offer({ kind: 'body', e, zone: z.zone, point: _c1.clone() }, ordered ? along(_c1) : d);
    }
  }
  return best;
}

// ---- Treffer auf einen Gegner ------------------------------------------------------------------
// info: { type: 'slash' | 'thrust' | 'blunt', power, dir (Welt), point (Welt), knock }
const VITAL = { head: 2.0, torso: 1, armR: 0.5, armL: 0.5, legR: 0.6, legL: 0.6 };
function note(e, text, color = '#ffd36a') {
  if (!opts.texts) return;
  floatingText(text, e.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.32, 0)), color);
}
function tint(e, zone) { for (const m of e.zoneMeshes[zone]) if (m.material.vertexColors) m.material = bloodMat; }
function recompute(e) {
  const wz = zoneOfArm(wArm(e)), oz = zoneOfArm(1 - wArm(e)), two = !!e.wdef.twoH;
  e.atkSlow = 1 + (e.inj[wz] >= LIMP ? 0.3 : 0) + (two && e.crip[oz] ? 0.5 : two && e.inj[oz] >= LIMP ? 0.2 : 0) + (e.inj.torso >= 35 ? 0.15 : 0);
  e.atkDmg = (e.inj[wz] >= LIMP ? 0.7 : 1) * (two && e.crip[oz] ? 0.7 : 1);
  const limp = (e.inj.legR >= LIMP ? 1 : 0) + (e.inj.legL >= LIMP ? 1 : 0), crip = (e.crip.legR ? 1 : 0) + (e.crip.legL ? 1 : 0);
  e.moveMul = crip >= 2 ? 0.2 : crip === 1 ? 0.42 : limp ? 0.68 : 1;
  e.kneel = crip >= 2;
}
export function applyHit(e, zone, info) {
  const res = { killed: false, dmg: 0, armor: false, zone, notes: [] };
  if (e.state === 'dead') return res;
  if (typeof window !== 'undefined' && window.__hitlog) window.__hitlog.push(`${zone} ${info.type} ${info.power.toFixed(1)}`); // Testprotokoll
  const raw = e.armor[zone][info.type] ?? 1;
  const mul = raw + (1 - raw) * (info.pen || 0); // Durchschlag (Axt, Hammer, Armbrustbolzen) hebt einen Teil der Rüstung auf
  const counter = !!(e.act && !e.act.locked) || e.recoil || e.beaten > 0; // beim Ausholen oder offen erwischt
  const dmg = info.power * mul * (e.down ? 1.25 : 1) * (counter ? 1.2 : 1);
  res.armor = mul <= 0.36; res.counter = counter;
  e.lastHitT = clock;
  res.dmg = dmg * VITAL[zone];
  e.hp -= res.dmg;
  e.inj[zone] += dmg;
  const dir = info.dir || ZAXIS;
  // Blut, Blutung – oder Funken, wenn die Rüstung hält
  if (info.type !== 'blunt' && mul > 0.4 && dmg >= 6) {
    burst(info.point, BLOOD, clamp(dmg * 0.5, 4, 16));
    e.bleed = Math.min(2.5, e.bleed + dmg * (info.type === 'thrust' ? 0.035 : 0.02)); // Lebenspunkte pro Sekunde, klingt langsam ab
    tint(e, zone);
  } else if (res.armor) sparks(info.point, t1.copy(dir).negate(), 6);
  else puff(info.point, 0xbbb0a0, 0.06, 0.4, 0.1, 0.4);
  // Folgen je Zone
  const N = res.notes;
  if (zone === 'head') {
    e.daze = Math.max(e.daze, Math.min(4.5, dmg / 8 * (info.type === 'blunt' ? 2 : 1))); // stumpfe Schläge auf den Helm betäuben besonders
    e.fl.hx = -0.55 * (dir.dot(t1.set(Math.sin(e.yaw), 0, Math.cos(e.yaw))) > 0 ? -1 : 1); e.fl.hy = rand(-0.5, 0.5);
    if (!e.helmOff && (e.helmet === 'nasal' || e.helmet === 'kettle' || e.helmet === 'great' || e.helmet === 'cap') && info.power >= 26 && Math.random() < 0.4) {
      e.helmOff = true;
      e.armor = { ...e.armor, head: { slash: 1, thrust: 1, blunt: 1 } };
      const g = e.gear; e.zoneMeshes.head = [e.face];
      dropItem(e, g, dir); SFX.clang();
      N.push('Helm ab!');
    } else if (dmg >= 10) N.push('Benommen');
  } else if (zone === 'armR' || zone === 'armL') {
    const i = zone === 'armR' ? 0 : 1;
    if (e.inj[zone] >= CRIP && !e.crip[zone]) { e.crip[zone] = true; N.push(armLost(e, i, dir)); }
    else if (e.inj[zone] >= LIMP && !e.hurt[zone]) { e.hurt[zone] = true; N.push(i === wArm(e) ? 'Waffenarm verletzt' : 'Arm verletzt'); }
  } else if (zone === 'legR' || zone === 'legL') {
    if (e.inj[zone] >= CRIP && !e.crip[zone]) { e.crip[zone] = true; N.push(e.crip.legR && e.crip.legL ? 'Geht in die Knie!' : 'Bein unbrauchbar'); }
    else if (e.inj[zone] >= LIMP && !e.hurt[zone]) { e.hurt[zone] = true; N.push('Bein verletzt – hinkt'); }
  } else if (e.inj.torso >= 35 && !e.hurt.torso) { e.hurt.torso = true; N.push('Schwer verwundet'); }
  recompute(e);
  // Richtung des Treffers im Körper-Raum: von vorne → zurück, von der Seite → wegdrehen
  const Ld = t3.copy(dir).applyQuaternion(q1.copy(e.root.quaternion).invert());
  const jolt = Math.min(1, dmg / 25 + (info.type === 'blunt' ? 0.3 : 0));
  if (zone === 'torso') { e.fl.lean = 0.35 * jolt * Math.sign(Ld.z || 1) * -1; e.fl.tw = -0.35 * jolt * Ld.x; }
  else if (zone === 'head') e.fl.roll = -0.3 * jolt * Ld.x;
  else if (zone === 'armR' || zone === 'armL') { // Arm zuckt zurück
    e.fl.tw = (zone === 'armR' ? 1 : -1) * 0.45 * jolt;
    const i = zone === 'armR' ? 0 : 1;
    if (i === wArm(e)) { e.wp.hp.z -= 0.16 * jolt; e.wp.hp.y += 0.05 * jolt; } else if (e.shield) e.sp.c.z -= 0.12 * jolt;
  } else { e.fl.dip = 0.16 * jolt; e.fl.roll = (zone === 'legR' ? 1 : -1) * 0.22 * jolt; } // Bein: verliert kurz das Gleichgewicht
  // Gleichgewicht: jeder Treffer kostet Standfestigkeit; ist sie aufgebraucht, taumelt er stark oder fällt
  const impact = info.power * (info.type === 'blunt' ? 1.35 : info.type === 'thrust' ? 0.7 : 1) * (zone === 'legR' || zone === 'legL' ? 1.5 : zone === 'head' ? 1.3 : 1) * (e.act && e.act.locked ? 1.3 : 1) * (info.knock ? 0.8 + 0.2 * info.knock : 1);
  e.bal -= impact; e.balT = 1.2;
  const broken = e.bal <= 0;
  if (broken) { e.bal = e.A.balance * 0.6; if (!info.knockdown && (impact > 30 || zone === 'legR' || zone === 'legL') && Math.random() < 0.65) info = { ...info, knockdown: true }; else N.push('Gleichgewicht verloren'); }
  // Liegt er (Ragdoll)? Der Treffer stößt den Körper an – ein eingefrorener wird wieder lebendig
  if (e.down && e.down.rag && !e.getup) {
    if (e.rag && e.rag.state === 'active') pokeRagdoll(e.rag, info.point, dir, info.power);
    else startRagdoll(e, { point: info.point, dir, power: info.power });
    e.down.T = Math.min(e.down.T + 0.4, e.down.t + 3);
  }
  // zu Boden gehen: wuchtige stumpfe Treffer, Hammer, harter Schildstoß, gebrochenes Gleichgewicht
  if (!e.kneel && !e.down && e.hp > 0 && e.state === 'fight' && (info.knockdown || (info.type === 'blunt' && dmg >= 38 && Math.random() < 0.6))) {
    knockDown(e, dir, info.point, info.power); N.unshift('Zu Boden!');
  }
  // Moral: Schmerz und Verletzungen machen Angst (Berserker werden eher wütend)
  moraleEvent(e, MORALE.hurt * 100 * res.dmg / e.maxHp); // relativ: ein zäher Ritter steckt denselben Hieb leichter weg
  if (N.some(n => /unbrauchbar|Entwaffnet|Knie/.test(n))) moraleEvent(e, MORALE.crippled);
  // kleine Treffer steckt ein Berserker weg: kein Zucken, kein Abbruch
  const shrug = dmg < e.A.ignore && !broken && !e.down;
  if (shrug) { e.fl.lean *= 0.3; e.fl.tw *= 0.3; if (dmg >= 3) N.unshift('ignoriert den Treffer'); }
  // Angriff unterbrechen, taumeln, Rückstoß
  if (e.act && !shrug) { const armored = e.wdef.heavy && e.act.locked; if (!armored && (dmg >= 8 || !e.act.locked)) { e.act = null; e.queue.length = 0; } }
  if (!shrug && (dmg >= 5 || broken)) {
    e.stagger = Math.max(e.stagger, broken ? 1.1 : Math.min(0.8, zone === 'head' ? 0.4 + dmg / 70 : 0.12 + dmg / 90));
    e.staggerDir = t1.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).dot(dir) > 0.2 ? -1 : 1; // von hinten getroffen: nach vorne taumeln
    e.parry = null; e.react = null; e.bash = null; e.taunt = null; e.kick = null;
  }
  if (info.knock) { const k = 0.08 * info.knock; tryMove(e, dir.x * k, dir.z * k, true); }
  if (e.hp <= 0) { const mercy = e.state === 'yield'; kill(e, dir, info); res.killed = true; if (mercy) for (const o of enemies) if (o !== e && o.state === 'fight') moraleEvent(o, MORALE.mercyKill); }
  else {
    SFX3D.hurt(chestWorld(e, t2), 'runner');
    // Panik: Ängstliche lassen die Waffe fallen, wenn die Moral bricht
    if (e.state === 'fight' && !e.passive && e.weapon && e.weaponId !== 'fist' && e.morale < 30 && Math.random() < e.A.panicDrop) {
      dropItem(e, e.weapon, dir, e.weaponId); setWeapon(e, 'fist'); e.act = null; e.queue.length = 0; e.noRearm = true; N.unshift('lässt vor Angst die Waffe fallen!');
      moraleEvent(e, -10);
    }
    if (!e.passive && e.state === 'fight' && !e.down) moraleCheck(e, true);
  }
  if (res.counter && !res.killed && dmg >= 8) N.unshift('Konter!');
  if (N.length && !res.killed) note(e, N[0]);
  return res;
}
// Arm unbrauchbar: Waffe oder Schild fällt; wenn möglich wird mit der anderen Hand weitergekämpft
function armLost(e, i, dir) {
  const isW = i === wArm(e);
  if (e.weaponId === 'bow') { dropItem(e, e.weapon, dir, 'bow'); e.weapon = null; e.shot = null; if (isW) e.handed = -e.handed; setWeapon(e, armOk(e, wArm(e)) ? 'dagger' : 'fist'); return 'Bogen fällt!'; }
  if (!isW) {
    if (e.shield) { dropItem(e, e.shield, dir, 'shield'); e.shield = null; return 'Schild fällt!'; }
    return e.wdef.twoH ? 'Nur noch einhändig' : 'Arm unbrauchbar';
  }
  if (e.weapon) { dropItem(e, e.weapon, dir, e.weaponId); e.weapon = null; }
  if (e.act) { e.act = null; e.queue.length = 0; }
  if (armOk(e, 1 - i)) { // Schild weg, Dolch in die andere Hand
    if (e.shield) { dropItem(e, e.shield, dir, 'shield'); e.shield = null; }
    e.handed = -e.handed;
    setWeapon(e, e.type === 'bandit' || e.type === 'archer' ? 'fist' : 'dagger');
  } else setWeapon(e, 'fist');
  return 'Entwaffnet!';
}
// Der Spieler trifft die Waffe des Gegners. power = Wucht des Schlags (wie bei applyHit).
// Liefert 'disarmed' | 'beaten' (Deckung weggeschlagen, kurz offen) | 'clash' (beide Waffen prallen ab) | 'deflected'.
// Entwaffnen nach Hebel: je weiter vorne die Waffe getroffen wird, desto größer das Drehmoment am Handgelenk;
// dagegen stehen Griffkraft, Ausdauer, Verletzung und zweihändiger Griff. Nur eine kleine Streuung (±12 %).
function gripHold(e) { return (e.wdef.twoH ? 30 : 20) * e.A.grip * (0.5 + e.stam / 200) * (e.hurt[zoneOfArm(wArm(e))] ? 0.6 : 1) * (e.parry ? 1.4 : 1); }
function leverAt(e, point) {
  if (!point) return 0.6;
  weaponSeg(e, e.wdef.haft, _ha, _hb);
  const L = _ha.distanceTo(_hb) || 1;
  return clamp(t7.subVectors(point, _ha).dot(t6.subVectors(_hb, _ha)) / (L * L), 0, 1); // 0 = an der Hand, 1 = Spitze
}
export function beatWeapon(e, power, dir, point = null) {
  if (e.state === 'dead' || !e.weapon) return 'deflected';
  e.stam = Math.max(0, e.stam - power * 0.6);
  if (e.act && e.act.locked) { startRecoil(e, e.act, 0.6); e.bal -= power * 0.4; return 'clash'; } // Waffen prallen im Schlag aufeinander
  const hold = gripHold(e), lev = leverAt(e, point);
  if (power < hold * 0.7) return 'deflected';
  // weggeschlagen: Waffe fliegt zur Seite, Deckung ist offen
  e.beaten = 0.75; e.parry = null; e.act = null; e.queue.length = 0; e.react = null;
  const L = t3.copy(dir).applyQuaternion(q1.copy(e.root.quaternion).invert());
  e.wp.hp.x += clamp(L.x, -1, 1) * 0.3; e.wp.hp.y -= 0.12; e.wp.hp.z -= 0.1;
  e.bal -= power * 0.3; e.balT = 1.2;
  // Entwaffnen: Drehmoment (Wucht × Hebel) gegen die Griffkraft
  const torque = power * (0.35 + 0.95 * lev);
  e.dbg.lever = `Hebel ${(lev * 100) | 0}% · Moment ${torque | 0} / Griff ${(hold * 1.5) | 0}`;
  if (torque > hold * 1.5 * rand(0.88, 1.12)) { disarm(e, dir); return 'disarmed'; }
  return 'beaten';
}
function disarm(e, dir) {
  dropItem(e, e.weapon, dir, e.weaponId); e.weapon = null;
  setWeapon(e, 'fist');
  e.rearm = e.noRearm ? null : { t: 0 };
  release(e);
  note(e, 'Entwaffnet!');
  moraleEvent(e, MORALE.disarmed);
}
// Erfolgreiche Parade mit gutem Timing: Gegner weit offen, verliert Gleichgewicht, eventuell die Waffe
export function parried(e, perfect) {
  if (!e.recoil) return;
  e.recoil.T = perfect ? 1.35 : e.recoil.T;
  e.bal -= perfect ? 28 : 12; e.balT = 1.2; e.stam = Math.max(0, e.stam - (perfect ? 25 : 10));
  // perfekte Parade gegen ein schwaches Handgelenk: die Waffe wird ihm aus der Hand gedreht (Griffkraft statt Würfel)
  if (perfect && e.weapon && gripHold(e) < 14) disarm(e, t1.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).negate());
}
// Hand drückt gegen den Gegner (freie Hand, Schild): schiebt ihn weg, kostet ihn Gleichgewicht
export function pushEnemy(e, dir, amount) {
  if (e.state !== 'fight' || e.down) return;
  tryMove(e, dir.x * amount, dir.z * amount, true);
  e.bal -= amount * 60; e.balT = 1.2;
  if (e.bal <= 0) { e.bal = e.A.balance * 0.6; e.stagger = Math.max(e.stagger, 0.9); e.act = null; note(e, 'weggestoßen'); }
}
// Bindung: die Klinge des Spielers liegt an der Waffe des Gegners (langsam, kein Hieb).
// Liefert den Gegner, an dessen Waffe a→b liegt, oder null.
export function enemyWeaponSeg(e, a, b) { weaponSeg(e, e.wdef.haft, a, b); return e.weapon ? true : false; }
export function bindTest(a, b) {
  for (const e of enemies) {
    if (e.state !== 'fight' || !e.weapon || e.weaponId === 'bow' || e.weaponId === 'fist' || e.down) continue;
    weaponSeg(e, e.wdef.haft, _ha, _hb);
    if (segSeg(a, b, _ha, _hb, _c1) < 0.07) return { e, point: _c1.clone() };
  }
  return null;
}
// Druck in der Bindung: die gegnerische Klinge wird mitgeschoben; wer stärker drückt, öffnet die Deckung.
// push = Welt-Verschiebung der Spielerklinge in diesem Bild. Liefert 'beaten', wenn die Deckung aufgeht.
export function bindPush(e, push, dt) {
  const L = t3.copy(push).applyQuaternion(q1.copy(e.root.quaternion).invert()).divideScalar(e.scale);
  const resist = (e.wdef.twoH ? 1.4 : 1) * (0.4 + e.stam / 100) * (e.hurt[zoneOfArm(wArm(e))] ? 0.6 : 1);
  // die gegnerische Klinge gibt nach (bleibender Versatz, klingt langsam ab) – wer stärker ist, drückt sie weg
  if (!e.bindOff) e.bindOff = new THREE.Vector3();
  e.bindOff.addScaledVector(L, Math.min(1, 0.9 / resist));
  e.wp.hp.addScaledVector(L, Math.min(1, 0.9 / resist));
  e.bind = e.bindOff.length();
  e.stam = Math.max(0, e.stam - push.length() * 40);
  e.act = null; e.queue.length = 0; e.cool = Math.max(e.cool, 0.25); // in der Bindung greift er nicht an
  if (e.bind > 0.2) {
    e.bind = 0; e.bindOff.set(0, 0, 0);
    // Winden: wer die Bindung gewinnt und am schwachen Handgelenk Hebel hat, dreht die Waffe heraus
    if (resist * e.A.grip < 0.62 && e.weaponId !== 'fist') { disarm(e, t1.copy(push).normalize()); return 'disarmed'; }
    e.beaten = 0.7; e.bal -= 12; note(e, 'Deckung aufgedrückt!', '#7dffa8'); return 'beaten';
  }
  return null;
}
// Treffer auf den Schild eines Gegners: Äxte und Hämmer zerschlagen ihn. Liefert true, wenn er zerbricht.
export function hitShield(e, dmg, point) {
  if (!e.shield) return false;
  e.shieldHp -= dmg; e.shieldShake = 0.28; e.stam = Math.max(0, e.stam - 4 - dmg * 0.5); e.sp.c.z -= 0.1;
  if (e.shieldHp > 0) return false;
  burst(point, 0x7a5230, 20);
  dropItem(e, e.shield, null); e.shield = null;
  SFX.shatter();
  note(e, 'Schild zerbrochen!');
  e.stagger = Math.max(e.stagger, 0.5);
  return true;
}
// Schildstoß des Spielers: stumpfer Treffer, Gegner taumelt zurück und ist kurz offen
export function shoveEnemy(e, dir, power, point) {
  const r = applyHit(e, 'torso', { type: 'blunt', power: 9 * power, dir, point, knock: 3, knockdown: power >= 1.35 });
  if (!r.killed) { e.stagger = Math.max(e.stagger, 0.85); e.shieldZone = 'mid'; }
  return r;
}
function kill(e, dir, info = null) {
  if (e.state === 'dead') return;
  const wasYield = e.state === 'yield';
  release(e); endGrab(e);
  const fwd = t1.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
  e.state = 'dead'; e.t = 0; e.act = null; e.parry = null; e.shot = null; e.getup = null;
  e.fall = dir && fwd.dot(dir) > 0.2 ? 1 : -1; // von hinten getroffen: fällt nach vorne
  e.fallRoll = rand(-0.7, 0.7);
  if (e.downK > 0.6) { e.fall = -1; e.t = 0.95; e.fallRoll = 0; } // lag schon am Boden: bleibt liegen
  // Ragdoll: liegt er schon (Ragdoll aktiv oder eingefroren), bleibt er so liegen; sonst fällt er physikalisch
  const lying = !!(e.down && e.down.rag);
  e.ragDead = lying || !!startRagdoll(e, { point: info && info.point, dir: dir || t2.copy(fwd).multiplyScalar(0.4), power: info ? info.power : 8, carry: e.vel });
  e.downK = 0; e.down = null;
  dropItem(e, e.weapon, dir, e.weaponId); e.weapon = null;
  dropItem(e, e.shield, dir, 'shield'); e.shield = null;
  SFX3D.death(chestWorld(e, t2), 'runner');
  if (!wasYield) player.defeated(e, 'dead');
  // die anderen sehen ihn fallen
  for (const o of enemies) {
    if (o === e || o.state !== 'fight' || o.passive) continue;
    const d = o.pos.distanceTo(e.pos);
    if (d > 7) continue;
    if (o.persona === 'berserker') { o.rage = 6; note(o, 'rasend vor Wut!', '#ff7a5a'); }
    else moraleEvent(o, MORALE.allyDead * (d < 3 ? 1.3 : 1));
  }
}
// Zu Boden: mit Ragdoll (Budget frei) – sonst die prozedurale Sturz-Animation. Die Waffe bleibt in der Hand
// oder fliegt weg, je nach Wucht gegen Griffkraft (kein Würfeln, keine Rückkehr in die Hand).
function knockDown(e, dir, point, power) {
  release(e); endGrab(e);
  e.act = null; e.queue.length = 0; e.taunt = null; e.kick = null; e.parry = null; e.react = null; e.dodge = null; e.bash = null; e.recoil = null; e.rearm = null;
  const R = startRagdoll(e, { point, dir, power: power * 1.1, carry: e.vel });
  e.down = { t: 0, T: R ? rand(2.8, 3.8) : rand(2.3, 3.1), rag: !!R };
  if (e.weapon && e.weaponId !== 'fist' && e.weaponId !== 'bow' && power * (e.persona === 'fearful' ? 1.4 : 1) > 26 * e.A.grip * (0.5 + e.stam / 200)) {
    dropItem(e, e.weapon, dir, e.weaponId); e.weapon = null; setWeapon(e, 'fist'); e.lostInFall = true;
  }
  moraleEvent(e, MORALE.down);
  // Kameraden decken den Gestürzten: der nächste greift sofort an
  let best = null, bd = 4;
  for (const o of enemies) { if (o === e || o.state !== 'fight' || o.passive || o.down || o.weaponId === 'bow') continue; const d = o.pos.distanceTo(e.pos); if (d < bd) { bd = d; best = o; } }
  if (best && best.persona !== 'fearful') { if (!best.token) { tokens.add(best); best.token = true; } best.cool = Math.min(best.cool, 0.25); best.dbg.why = 'deckt Kamerad'; note(best, 'deckt seinen Kameraden', '#9ad'); }
}
// Aufstehen nach einem Ragdoll-Sturz: Becken-Lage übernehmen, Figur zum Spieler drehen, aus der liegenden
// Haltung über eine Hock-Haltung in die Kampfhaltung überblenden (Physik → Animation ohne Sprung)
function beginGetUp(e) {
  if (e.rag && e.rag.state === 'active') freezeRagdoll(e.rag);
  e.root.updateMatrixWorld(true);
  e.hips.getWorldPosition(t1);
  m2.copy(e.hips.matrixWorld);
  t1.y = 0;
  const p = walkable(t1.x, t1.z) ? t1 : nearestWalkable(t1);
  e.pos.set(p.x, 0, p.z); e.y = groundAt(e.pos.x, e.pos.z);
  e.yaw = Math.atan2(player.head.x - e.pos.x, player.head.z - e.pos.z);
  place(e);
  e.body.rotation.set(0, 0, 0); e.body.position.set(0, 0, 0);
  e.root.updateMatrixWorld(true);
  m1.copy(e.body.matrixWorld).invert().multiply(m2).decompose(e.hips.position, e.hips.quaternion, t2);
  e.hips.scale.set(1, 1, 1);
  e.getup = { t: 0, from: capturePose(e) };
  e.rag = null;
  e.prevPos.copy(e.pos);
}
const GETUP_T = 1.45;
const _gq = new THREE.Quaternion(), _gp = V();
function applyGetUp(e, dt) {
  const G = e.getup;
  G.t += dt;
  // Hocke: ein Knie am Boden, Oberkörper vorgebeugt – blendet bis GETUP_T in den Stand aus
  const c = 1 - THREE.MathUtils.smoothstep(G.t, 0.45, GETUP_T);
  e.hips.quaternion.identity(); e.hips.position.x = 0; e.hips.position.z = 0;
  for (const L of e.legs) { L.top.rotation.y = 0; L.top.rotation.z = 0; L.mid.rotation.y = 0; L.mid.rotation.z = 0; }
  if (c > 0) {
    e.hips.position.y = lerp(e.hips.position.y, 0.5, c);
    e.legs[0].top.rotation.x = lerp(e.legs[0].top.rotation.x, -1.45, c); e.legs[0].mid.rotation.x = lerp(e.legs[0].mid.rotation.x, 1.6, c);
    e.legs[1].top.rotation.x = lerp(e.legs[1].top.rotation.x, 0.15, c); e.legs[1].mid.rotation.x = lerp(e.legs[1].mid.rotation.x, 1.75, c);
    e.torso.rotation.x += 0.45 * c;
  }
  // Übergang aus der liegenden (Physik-)Haltung
  const b = THREE.MathUtils.smoothstep(G.t, 0, 0.7);
  if (b < 1) for (const F of G.from) {
    _gq.copy(F.bone.quaternion); _gp.copy(F.bone.position);
    F.bone.quaternion.slerpQuaternions(F.q, _gq, b);
    F.bone.position.lerpVectors(F.p, _gp, b);
  }
  if (G.t >= GETUP_T) {
    e.getup = null;
    // nach dem Aufstehen: Waffe verloren → suchen/aufheben bzw. Ersatzwaffe ziehen; Moral entscheidet über Kampf oder Flucht
    if (e.lostInFall && !e.noRearm) { e.rearm = { t: 0 }; e.lostInFall = false; }
    moraleCheck(e, false);
  }
}

// ---- Moral: Angst, Wut, Zahlenverhältnis → kämpfen, fliehen oder sich ergeben --------------------
function moraleEvent(e, amount) {
  if (e.passive || e.state === 'dead') return;
  if (amount < 0) amount *= e.persona === 'fearful' ? 1.4 : e.persona === 'berserker' ? 0.25 : e.persona === 'elite' ? 0.6 : 1;
  e.morale = clamp(e.morale + amount, 0, 100);
}
// regelmäßig (gestaffelt): Moral erholt sich zum Grundwert, mehr Verbündete geben Mut
function moraleTick(e, dt) {
  e.moraleT -= dt;
  if (e.rage > 0) e.rage -= dt;
  if (e.moraleT > 0) return;
  e.moraleT = 0.5;
  let allies = 0;
  for (const o of enemies) if (o !== e && o.state === 'fight' && o.pos.distanceTo(e.pos) < 6) allies++;
  const base = e.A.morale0 * aiOpts.morale + Math.min(18, allies * 6) - (e.hp < e.maxHp * 0.35 ? 15 : 0) - (e.bleed > 0.6 ? 8 : 0);
  e.morale = clamp(e.morale + (Math.min(100, base) - e.morale) * 0.04, 0, 100);
  if (e.state === 'fight' && !e.down && !e.getup) moraleCheck(e, false);
}
// Entscheidung bei niedriger Moral: Berserker ergeben sich nie, Ängstliche schnell
function moraleCheck(e, hit) {
  if (e.passive || e.state !== 'fight' || e.down || e.getup) return;
  const helpless = (e.crip.armR && e.crip.armL) || (e.weaponId === 'fist' && e.noRearm);
  const low = e.morale < (hit ? 22 : 15) || (helpless && e.morale < 45);
  if (!low) return;
  if (e.persona === 'berserker' && !helpless) return;
  const opens = surfacesOf('door', 'window').length > 0;
  const giveUp = e.A.surrender * (helpless ? 1.6 : 1) * (e.kneel ? 1.5 : 1) * (e.hp < e.maxHp * 0.3 ? 1.3 : 1);
  if (Math.random() < giveUp || (!opens && Math.random() < 0.5 + giveUp)) surrender(e);
  else if (opens && Math.random() < 0.35 + e.A.flee) startFlee(e);
  else e.moraleT = 1.5; // hält noch durch
}
// Ergeben: Waffe und Schild fallen lassen, Hände hoch, auf die Knie, um Gnade bitten
const MERCY = ['Gnade! Ich ergebe mich!', 'Nicht töten! Ich gebe auf!', 'Halt! Ich ergebe mich!', 'Bitte, Gnade!'];
export function surrender(e) {
  if (e.state === 'dead' || e.state === 'yield') return;
  release(e); endGrab(e);
  if (e.weapon && e.weaponId !== 'fist') { dropItem(e, e.weapon, null, e.weaponId); e.weapon = null; }
  if (e.shield) { dropItem(e, e.shield, null, 'shield'); e.shield = null; }
  setWeapon(e, 'fist');
  e.state = 'yield'; e.t = 0; e.act = null; e.queue.length = 0; e.parry = null; e.react = null; e.dodge = null; e.bash = null; e.kick = null; e.taunt = null; e.rearm = null; e.recoil = null; e.shot = null;
  e.fighting = false;
  const line = pick(MERCY);
  note(e, '🏳 ' + line, '#fff');
  player.say(e, line);
  player.defeated(e, 'yield');
  for (const o of enemies) if (o !== e && o.state === 'fight' && o.pos.distanceTo(e.pos) < 7) moraleEvent(o, MORALE.allyYield);
}
// Sandbox-Aktionen für Ergebene (Test-Menü)
export function yieldAction(e, what) {
  if (!e || e.state !== 'yield') return false;
  if (what === 'away') { // wegschicken: geht durch die nächste Tür/das nächste Fenster
    e.kneel = false; recompute(e);
    if (surfacesOf('door', 'window').length) { e.state = 'fight'; startFlee(e); e.sentAway = true; }
    else removeEnemy(e);
  } else if (what === 'fight') { // wieder kämpfen lassen
    e.kneel = false; recompute(e);
    e.state = 'fight'; e.morale = Math.max(40, e.A.morale0 * 0.7); e.cool = rand(0.8, 1.5);
    if (!e.noRearm) e.rearm = { t: 0 };
  } else if (what === 'disarmed') e.noRearm = !e.noRearm;
  else if (what === 'remove') removeEnemy(e);
  return true;
}
function yieldUpdate(e, dt) {
  e.fighting = false;
  turnTo(e, player.head.x, player.head.z, dt, 1.5);
  if (e.t > 0.9 && !e.kneel) { e.kneel = true; SFX.thud(0.2); }
  guardPose(e, dt, 1);
}
function startFlee(e) {
  const opens = surfacesOf('door', 'window');
  if (!opens.length) return;
  let best = null, bd = Infinity;
  for (const o of opens) { const d = o.mid.distanceTo(e.pos); if (d < bd) { bd = d; best = o; } }
  release(e);
  e.state = 'flee'; e.act = null; e.queue.length = 0; e.parry = null; e.path = null;
  const mid = best.mid.clone().setY(0);
  e.exitIn = mid.clone().addScaledVector(best.normal, 0.55);
  e.exitOut = mid.clone().addScaledVector(best.normal, -OUTSIDE);
  e.opening = best;
  SFX3D.scream(chestWorld(e, t2));
  note(e, 'flieht!', '#9ad');
}

// ---- Waffe des Spielers packen ---------------------------------------------------------------------
// Ein Gegner mit freier Hand greift nach einer langsamen/ruhenden Klinge in Reichweite (nach einem Stich,
// in der Bindung, beim Abwarten). Griff/Parierstange: sicherer Halt. Klinge: mit Handschuh möglich,
// mit bloßer Hand schneidet sie ihn, wenn der Spieler sie herauszieht. Entwaffnete versuchen es öfter.
// Kräftemessen über Hebel (Griffstelle, Griffkraft, Ausdauer, ein-/beidhändig, wie stark der Spieler zieht).
export function endGrab(e) { if (e.grab) { e.grab = null; e.grabCool = rand(3, 6); } }
const gloved = (e) => e.T.armor.arms !== 'none' && e.T.armor.arms !== 'cloth';
function tryGrab(e, dt, d) {
  e.grabT -= dt; e.grabCool -= dt;
  if (e.grabT > 0) return;
  e.grabT = 0.3;
  if (e.grabCool > 0 || d > 1.45 || e.kneel || e.act || e.parry || !player.blades.length) return;
  const oa = 1 - wArm(e), fist = e.weaponId === 'fist';
  const hand = fist ? (armOk(e, oa) ? oa : wArm(e)) : (!e.shield && !e.wdef.twoH && e.weaponId !== 'bow' && armOk(e, oa) ? oa : -1);
  if (hand < 0 || !armOk(e, hand)) return;
  const want = (fist ? 0.55 : 0.22) * e.A.smart * RE() * (e.forceGrab ? 10 : 1);
  const S = e.body.localToWorld(shoulder(e, hand, t1));
  for (const b of player.blades) {
    if (!b.w || !b.w.holder || b.speed > 1.0) continue;
    const dist = segPoint(b.a, b.b, S, _hit);
    if (dist > REACH * e.scale + 0.04) continue;
    if (Math.random() > want) continue;
    const L = b.a.distanceTo(b.b) || 1, u = clamp(t2.subVectors(_hit, b.a).dot(t3.subVectors(b.b, b.a)) / (L * L), 0, 1);
    e.grab = { t: 0, phase: 'reach', w: b.w, u, hand, local: e.body.worldToLocal(_hit.clone()), pt: _hit.clone(), yank: 0, armored: gloved(e), tension: 0, twist: 0, pull: 0, from: V() };
    e.body.worldToLocal(e.arms[hand].mid.localToWorld(e.grab.from.set(0, -L2, 0)));
    e.forceGrab = false;
    e.dbg.why = 'greift nach deiner Waffe';
    return;
  }
}
// main.js meldet jedes Bild: Abstand echte Hand ↔ gehaltener Punkt, Drehgeschwindigkeit um die Klinge (rad/s),
// Zuggeschwindigkeit weg vom Gegner (m/s), Gleiten entlang der Klinge (m/s)
export function grabFeedback(e, tension, twist, pull, slide) { if (e.grab) { const g = e.grab; g.tension = tension; g.twist = twist; g.pull = pull; g.slide = slide; } }
function updateGrab(e, dt) {
  const g = e.grab;
  g.t += dt;
  if (!g.w.holder || e.down || e.state !== 'fight' || !armOk(e, g.hand)) { endGrab(e); return; }
  if (g.phase === 'reach') {
    // die Hand folgt der Klinge, solange sie in Reichweite und langsam ist – zieht der Spieler sie schnell weg, greift er ins Leere
    const P = t1.copy(g.w.gA).lerp(g.w.gB, g.u);
    const S = e.body.localToWorld(shoulder(e, g.hand, t2));
    if (P.distanceTo(S) > REACH * e.scale + 0.08 || g.w.tipSpeed > 1.6) { endGrab(e); note(e, 'greift ins Leere'); return; }
    e.body.worldToLocal(g.local.copy(P));
    if (g.t < 0.28) return;
    g.phase = 'hold'; g.t = 0;
    e.body.worldToLocal(g.local.copy(P));
    player.grabbed(e, g.w, g.u);
    SFX.click(900, 0.3, 0.05);
    note(e, g.u < 0.22 ? 'packt deinen Griff!' : g.armored ? 'packt deine Klinge (Handschuh)!' : 'packt deine Klinge!', '#ffb04a');
    return;
  }
  // Halten: er zieht die Waffe langsam zu sich; Kräftemessen über den Hebel
  t3.set(e.arms[g.hand].sx * 0.12, 1.12 - e.drop, 0.32);
  g.local.lerp(t3, Math.min(1, dt * 0.8));
  e.body.localToWorld(g.pt.copy(g.local));
  // Hebel: wer die Klinge weit vorne fasst, hebelt gegen das Handgelenk des Spielers (Drehmoment wächst mit u);
  // am Griff kontrolliert er das Handgelenk direkt. Bloße Hand an der Schneide hält nur zaghaft fest.
  const lev = e.A.grip * (g.u < 0.22 ? 1.1 : 0.6 + 0.8 * g.u) * (g.u < 0.22 || g.armored ? 1 : 0.6) * (0.5 + e.stam / 200) * (e.weaponId === 'fist' ? 1.35 : 1);
  const res = (g.w.twoHand ? 1.8 : 1) * (0.5 + player.stam / 200) + clamp(g.pull, 0, 1.2) * 1.5; // langsames Gegenziehen hilft
  g.yank += (lev - res * 0.8) * dt;
  g.lev = lev; g.res = res;
  e.dbg.lever = `Hebel ${lev.toFixed(2)} gegen ${res.toFixed(2)}`;
  e.stam = Math.max(0, e.stam - dt * 6);
  const jerk = g.pull > (g.u < 0.22 ? 2 : 1.2); // ruckartig zurückgerissen
  if (g.twist > 6 || jerk || g.tension > 0.7) { // Spieler dreht/reißt die Waffe frei (bzw. Tracking-Sprung)
    const cut = g.u >= 0.22 && !g.armored && (g.slide > 0.6 || jerk);
    const hz = zoneOfArm(g.hand);
    endGrab(e);
    e.beaten = 0.35;
    if (cut) { applyHit(e, hz, { type: 'slash', power: 10 + 16 * Math.min(2, Math.max(g.slide, g.pull)), dir: t4.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).negate(), point: g.pt.clone() }); note(e, 'Hand an der Klinge zerschnitten!', '#7dffa8'); }
    else note(e, g.twist > 6 ? 'Klinge herausgedreht' : 'Waffe losgerissen', '#7dffa8');
  } else if (g.yank > 1) { // er reißt dem Spieler die Waffe aus der Hand
    const w = g.w; endGrab(e);
    const id = player.disarmed(e, w);
    note(e, 'reißt dir die Waffe aus der Hand!', '#ff8a7a');
    if (id && e.weaponId === 'fist' && EW[id]) { setWeapon(e, id); e.rearm = null; }
  } else if (g.yank < -0.8 || g.t > 2.8) { endGrab(e); note(e, 'verliert den Griff'); }
  else if (e.weaponId !== 'fist' && e.token) e.cool = Math.min(e.cool, 0.2); // Klinge kontrolliert: jetzt zustechen
}

// ---- Bewegung ---------------------------------------------------------------------------------
function tryMove(e, dx, dz, quiet = false) {
  const nx = e.pos.x + dx, nz = e.pos.z + dz;
  if (!walkable(nx, nz) || Math.abs(groundAt(nx, nz) - e.y) > STEP) return false;
  e.pos.x = nx; e.pos.z = nz;
  if (!quiet) e.moved += Math.hypot(dx, dz);
  return true;
}
function turnTo(e, x, z, dt, rate = 5) {
  const want = Math.atan2(x - e.pos.x, z - e.pos.z);
  const d = Math.atan2(Math.sin(want - e.yaw), Math.cos(want - e.yaw)), max = rate * dt;
  e.yaw += clamp(d, -max, max);
  return Math.abs(d);
}
// geradeaus zu einem Punkt; true = angekommen. check: Raster beachten und auf Hindernisse klettern
function walkTo(e, target, dt, check = false, speedMul = 1) {
  const dx = target.x - e.pos.x, dz = target.z - e.pos.z, d = Math.hypot(dx, dz);
  if (d < 0.06) return true;
  turnTo(e, target.x, target.z, dt, 6);
  if (check) {
    const ax = e.pos.x + dx / d * 0.22, az = e.pos.z + dz / d * 0.22, gh = groundAt(ax, az);
    if (Math.abs(gh - e.y) > STEP) { // Höhenunterschied voraus: hinaufklettern oder herunterspringen
      if (e.kneel && gh > e.y) return false; // kniend kommt keiner mehr hoch
      const to = new THREE.Vector3(e.pos.x + dx / d * 0.42, gh, e.pos.z + dz / d * 0.42);
      if (!walkable(to.x, to.z) || Math.abs(groundAt(to.x, to.z) - gh) > STEP) to.set(ax, gh, az);
      e.climb = { from: e.pos.clone().setY(e.y), to, t: 0, T: gh > e.y ? 1.3 / Math.max(0.5, e.moveMul) : 0.45, up: gh > e.y, back: e.state };
      e.state = 'climbUp';
      return false;
    }
  }
  const step = Math.min(d, e.speed * e.moveMul * speedMul * dt);
  const nx = dx / d * step, nz = dz / d * step;
  if (check) tryMove(e, nx, nz); else { e.pos.x += nx; e.pos.z += nz; e.moved += step; }
  return false;
}
function pathWalk(e, dt, goal, speedMul = 1) {
  e.pathT -= dt;
  if (!e.path || e.pathT <= 0 || !e.path.length) { e.path = findPath(e.pos, t1.set(goal.x, 0, goal.z)); e.pathT = rand(0.8, 1.2); }
  const next = e.path[0];
  if (next && walkTo(e, next, dt, true, speedMul)) e.path.shift();
}
// Beinarbeit im Kampf: Abstand halten (Angreifer auf Schlagdistanz, Wartende im Kreis), seitlich umkreisen
function footwork(e, dt, d, dx, dz, rush = false) {
  // Abstand: eigene Reichweite gegen die des Spielers – kürzere Waffe drängt hinein, längere hält ihn auf Abstand
  let want = (e.token || rush ? e.wdef.range : 2.25 + e.slot * 0.8) + (e.hp < e.maxHp * 0.5 && !rush ? 0.12 : 0);
  if (e.token && !rush) {
    if (e.cool > 0.25) want += e.A.dist * (e.morale < 40 ? 1.5 : 1); // Abstand halten – bereit zum Angriff tritt er hinein
    if (e.A.smart > 0.5 && player.reach > e.wdef.range + 0.25) want = Math.min(want, e.wdef.range * 0.85); // unterlaufen
    if (e.cool > 0.4 && (e.persona === 'elite' || e.persona === 'cautious')) want = Math.max(want, player.reach + 0.15); // Mensur: knapp außerhalb seiner Reichweite warten
  }
  const sp = e.speed * e.moveMul * (e.daze > 0 ? 0.6 : 1) * (rush ? 1.25 : 1);
  let f = 0;
  if (d > want + 0.12) f = 1; else if (d < want - 0.2) f = -0.75;
  let lat;
  if (rush) { // unter Beschuss ohne Schild: im Zickzack heranstürmen
    e.zigT -= dt;
    if (e.zigT <= 0) { e.zigT = rand(0.35, 0.75); e.strafe = -e.strafe; }
    lat = 0.9 * e.strafe;
  } else {
    // Platz im Ring: von den anderen wegrücken, Kluge suchen den Rücken des Spielers (slotDir aus tactics)
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafeT = rand(1.5, 4); if (Math.random() < 0.6) e.strafe = -e.strafe; }
    lat = Math.abs(e.slotDir) > 0.08 ? clamp(e.slotDir * 1.6, -1, 1) * 0.6 : (e.token ? 0.14 : 0.26) * e.strafe;
  }
  if (e.kneel) lat = 0;
  const vx = (dx * f + -dz * lat) * sp * dt, vz = (dz * f + dx * lat) * sp * dt;
  if (!tryMove(e, vx, vz)) {
    if (f > 0 && !tryMove(e, dx * f * sp * dt, dz * f * sp * dt)) e.pathMode = 1; // Hindernis im Weg: kurz dem Laufweg folgen
    e.strafe = -e.strafe;
  }
}
// ---- Taktik: die Gegner arbeiten zusammen ----------------------------------------------------------
// Verteilt die Nahkämpfer rund um den Spieler (umzingeln) und bestimmt, wer ihm in den Rücken fallen kann.
function tactics(dt) {
  tac.t -= dt;
  if (tac.t > 0) return;
  tac.t = 0.25;
  const P = player.head;
  // Reichweite des Spielers (längste Klinge + Arm) und Seite seines Schildes – sichtbare Informationen
  let reach = 0.55, sx = 0, sz = 0, hasShield = false;
  for (const b of player.blades) reach = Math.max(reach, 0.55 + b.a.distanceTo(b.b));
  player.reach = reach;
  for (const sh of player.shields) if (sh.w && sh.w.holder) { hasShield = true; sx += sh.c.x - P.x; sz += sh.c.z - P.z; }
  const lx = player.look.x, lz = player.look.z, ll = Math.hypot(lx, lz) || 1;
  const side = hasShield ? Math.sign(sx * -lz / ll + sz * lx / ll) || 1 : 0; // +1 = Schild rechts vom Spieler
  const openAng = hasShield ? Math.atan2(lx / ll * Math.cos(0.7) + (side * lz / ll) * Math.sin(0.7), lz / ll * Math.cos(0.7) - (side * lx / ll) * Math.sin(0.7)) : 0;
  const group = enemies.filter(e => e.state === 'fight' && !e.passive && !e.down && e.weaponId !== 'bow' && Math.abs(player.floor - e.y) < 0.45 && Math.hypot(e.pos.x - P.x, e.pos.z - P.z) < 5);
  const back = Math.atan2(-player.look.x, -player.look.z);
  let front = null, fd = Infinity;
  for (const e of group) {
    e.ang = Math.atan2(e.pos.x - P.x, e.pos.z - P.z);
    e.behind = Math.cos(e.ang - back) > 0.3;
    const off = Math.abs(wrap(e.ang - back - Math.PI));
    if (off < fd) { fd = off; front = e; }
  }
  const n = group.length, minSep = Math.min(2.1, Math.PI * 2 / Math.max(2, n));
  tac.backstabber = null;
  let bd = Infinity;
  for (const e of group) {
    let push = 0;
    for (const o of group) { if (o === e) continue; const dA = wrap(e.ang - o.ang); if (Math.abs(dA) < minSep) push += (dA >= 0 ? 1 : -1) * (minSep - Math.abs(dA)); }
    // einer bindet den Spieler von vorne, die Klugen gehen ihm in die Flanke und in den Rücken
    if (n > 1 && e !== front && !e.behind && !e.kneel) push += Math.sign(wrap(back - e.ang) || 1) * 0.7 * e.A.smart;
    // um den Schild herum: zur ungedeckten Seite des Spielers wandern
    if (hasShield && e.A.smart > 0.45) { const dA = wrap(openAng - e.ang); if (Math.abs(dA) > 0.15) push += Math.sign(dA) * 0.45 * e.A.smart; }
    e.slotDir = push;
    if (e.behind && armOk(e, wArm(e))) { const dd = Math.hypot(e.pos.x - P.x, e.pos.z - P.z); if (dd < 3.6 && dd < bd) { bd = dd; tac.backstabber = e; } }
  }
  for (const e of enemies) if (!group.includes(e)) { e.slotDir = 0; e.behind = false; }
}
// Der Spieler ist gerade gebunden (hat geblockt, daneben geschlagen, liegt mit dem Schild falsch):
// Verbündete in Reichweite schlagen sofort zu.
export function teamOpening(except) {
  for (const o of enemies) {
    if (o === except || o.state !== 'fight' || o.passive || o.act || o.down || o.stagger > 0 || o.weaponId === 'bow' || !armOk(o, wArm(o))) continue;
    const d = Math.hypot(player.head.x - o.pos.x, player.head.z - o.pos.z);
    if (d > o.wdef.range + 0.6 || Math.abs(player.floor - o.y) > 0.45 || Math.random() > o.A.smart * RE()) continue;
    if (!o.token && tokens.size < opts.tokens + 1) { tokens.add(o); o.token = true; }
    if (o.token) o.cool = Math.min(o.cool, rand(0.05, 0.3));
  }
}
// Deckt der Spieler die Bahn dieses Angriffs (Schild oder Klinge im Weg)?
function covered(e, name) {
  const A = ATK[name], T = t4.copy(player.head);
  if (A.target === 'legs') T.y = player.floor + 0.62; else if (A.target !== 'head' && A.target !== 'face') T.y -= 0.34;
  const from = e.body.localToWorld(toLocalPos(e, A.wind.hp, t5));
  if (clock >= player.shieldStun) for (const sh of player.shields) if (segDisc(from, T, sh.c, sh.n, sh.r + 0.05, 0.1, _hit)) return true;
  for (const b of player.blades) if (segSeg(from, T, b.a, b.b) < 0.1) return true;
  return false;
}
// Zielt der Spieler mit einer Fernwaffe auf diesen Gegner?
function aimedAt(e) {
  const a = player.aim;
  if (!a) return false;
  const c = chestWorld(e, t4), along = t5.subVectors(c, a.o).dot(a.d);
  return along > 1.2 && t5.copy(a.o).addScaledVector(a.d, along).distanceTo(c) < 0.75;
}
// Der Spieler hat geschossen: wer keinen Schild hat und es kommen sieht, springt zur Seite
export function notifyShot(o, d) {
  for (const e of enemies) {
    if (e.state !== 'fight' || e.passive || e.down || e.act || e.kneel || e.stagger > 0 || (e.shield && e.aimRoll === 1)) continue;
    const c = chestWorld(e, t4), along = t5.subVectors(c, o).dot(d);
    if (along < 2.5 || t5.copy(o).addScaledVector(d, along).distanceTo(c) > 0.6) continue;
    if (Math.random() > e.A.arrowDodge * RE()) continue;
    const side = Math.random() < 0.5 ? 1 : -1;
    e.dodge = { t: 0.24, dx: -d.z * side, dz: d.x * side, v: 3.2 };
  }
}

// ---- Angriffe -----------------------------------------------------------------------------------
function chooseAttack(e) {
  const w = e.wdef;
  let names = Object.keys(w.moves);
  if (e.kneel) names = names.filter(n => n !== 'oberhau' && n !== 'stichHoch');
  if (!names.length) names = Object.keys(w.moves);
  const K = e.know, ak = Math.min(1.5, e.A.adapt * aiOpts.adapt), dodgy = share(K, 'def', 'dodge');
  const weighted = () => {
    // Gewicht je Hieb: gedeckte Bahnen meiden (je klüger, desto konsequenter), Wiederholungen meiden,
    // gelernt: Ziele meiden, die der Spieler oft abwehrt; gegen Zurückweichen Stiche; Berserker lieben schwere Hiebe
    const smart = Math.min(1, e.A.smart * RE());
    const wt = names.map(n => w.moves[n] * (n === e.lastAtk ? 0.4 : 1) * (covered(e, n) ? 1 - 0.9 * smart : 1)
      * (1 - 0.8 * ak * share(K, 'at', bucket(ATK[n].target))) * (ATK[n].thrust ? 1 + 1.5 * ak * dodgy : 1) * (HEAVY.has(n) ? 1 + 2 * e.A.heavy : 1));
    let r = Math.random() * wt.reduce((a, b) => a + b, 0);
    for (let k = 0; k < names.length; k++) { r -= wt[k]; if (r <= 0) return names[k]; }
    return names[0];
  };
  let seq;
  if (!e.kneel && w.combos.length && Math.random() < 0.34 * AG(e)) {
    // Kombo: Kluge beginnen mit einem Hieb, den der Spieler gerade nicht deckt
    const open = w.combos.filter(c => !covered(e, c[0]));
    const pool = open.length && Math.random() < e.A.smart ? open : w.combos;
    const cw = pool.map(c => (HEAVY.has(c[0]) ? 1 + 2 * e.A.heavy : 1)); // Berserker beginnen Kombos gern mit schweren Hieben
    let r = Math.random() * cw.reduce((a, b) => a + b, 0), ci = 0;
    while (ci < pool.length - 1 && (r -= cw[ci]) > 0) ci++;
    seq = pool[ci].slice();
  } else seq = [weighted()];
  let feint = null;
  const fooled = 1 + 1.5 * ak * (share(K, 'def', 'parry') + share(K, 'def', 'shield')); // wer viel abwehrt, wird öfter getäuscht
  if (seq.length === 1 && !ATK[seq[0]].thrust && Math.random() < e.A.feint * RE() * fooled) {
    // Finte: zu einem Hieb ausholen, den der Spieler deckt bzw. decken wird – und dann in die Blöße schlagen
    const others = names.filter(n => n !== seq[0] && !ATK[n].thrust && ATK[n].target !== ATK[seq[0]].target);
    if (others.length) feint = pick(others);
  }
  return { seq, feint };
}
const HEAVY = new Set(['oberhau', 'zornR', 'zornL', 'kopf']);
const bucket = (target) => (target === 'head' || target === 'face' ? 'head' : target === 'legs' ? 'legs' : 'body');
const keyOf = (e, t, pose) => ({ t, hp: toLocalPos(e, pose.hp, V()), bd: toLocalDir(e, pose.bd, V()) });
function startAttack(e, name, feint = null, quick = false) {
  const A = ATK[name], w = e.wdef;
  const slow = e.atkSlow * (e.daze > 0 ? 1.3 : 1) * (e.stam < 25 ? 1.25 : 1) / opts.speed;
  e.stam = Math.max(0, e.stam - (e.wdef.heavy ? 16 : 10));
  let tw = w.tw * slow * (quick ? 0.62 : 1) * rand(0.93, 1.1);
  const act = { name, A, t: 0, tw, ts: w.ts * slow, tf: 0.2, tr: 0.3, keys: [{ t: 0, hp: e.wp.hp.clone(), bd: e.wp.bd.clone() }], locked: false, done: false, missed: false, feint };
  if (feint) { // Finte: erst zu einem anderen Hieb ausholen, dann blitzschnell umsetzen
    const tF = tw * 0.6;
    act.keys.push(keyOf(e, tF, ATK[feint].wind));
    tw = act.tw = tF + 0.27 * slow;
  }
  act.keys.push(keyOf(e, tw, A.wind));
  act.end = tw + 10;
  e.act = act; e.lastAtk = name; e.parry = null; e.defStreak = 0;
  ai.lastStart = clock;
  e.dbg.atk = (feint ? `Finte ${feint} → ` : '') + name + (quick ? ' (schnell)' : '');
  if (!quick && Math.random() < 0.5) SFX3D.growl(chestWorld(e, t2), 'runner');
}
// Ende des Ausholens: Ziel festlegen (wo der Spieler JETZT ist) und die Schlagbahn dorthin bauen.
// Danach wird nicht mehr nachgeführt – wer ausweicht, wird nicht getroffen.
function lockAttack(e, act) {
  const A = act.A, w = e.wdef, K = act.keys, wind = K[K.length - 1];
  const P = e.body.worldToLocal(t1.copy(player.head));
  const floorL = (player.floor - e.y) / e.scale;
  let ty = A.target === 'head' ? P.y - 0.02 : A.target === 'face' ? P.y - 0.07 : A.target === 'legs' ? floorL + 0.62 : P.y - 0.34;
  if (e.kneel) ty = Math.min(ty, floorL + 0.8);
  const T = t2.set(P.x, ty, P.z);
  const bdImp = V();
  if (A.thrust) bdImp.subVectors(T, wind.hp).normalize(); else toLocalDir(e, A.imp, bdImp);
  const L = A.thrust ? w.edge[1] - 0.04 : lerp(w.edge[0], w.edge[1], 0.72);
  const hpImp = V().copy(T).addScaledVector(bdImp, -L);
  const tw = act.tw, ts = act.ts;
  if (A.via) K.push({ t: tw + ts * 0.5, hp: V().lerpVectors(wind.hp, hpImp, 0.5), bd: toLocalDir(e, A.via, V()) });
  K.push({ t: tw + ts, hp: hpImp, bd: bdImp });
  const d = t3.set(-A.follow.d[0] * e.handed, A.follow.d[1], A.follow.d[2]);
  K.push({ t: tw + ts + act.tf, hp: V().copy(hpImp).add(d), bd: A.thrust ? bdImp.clone() : toLocalDir(e, A.follow.bd, V()) });
  K.push(keyOf(e, tw + ts + act.tf + act.tr, w.guard));
  act.live0 = tw + ts * 0.3; act.live1 = tw + ts + act.tf * 0.6; act.end = tw + ts + act.tf + act.tr;
  act.locked = true;
  SFX3D.swing(e.body.localToWorld(t4.copy(wind.hp)));
}
function evalAct(e, act, t, out) {
  const K = act.keys;
  let i = 0;
  while (i < K.length - 2 && t >= K[i + 1].t) i++;
  const a = K[i], b = K[i + 1];
  let k = clamp((t - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);
  if (b.t <= act.tw + 1e-6) k = k * k * (3 - 2 * k);                                   // Ausholen: weich
  else if (act.locked && a.t >= act.tw + act.ts - 1e-6) k = 1 - (1 - k) * (1 - k);      // Durchschwung: bremst
  out.hp.lerpVectors(a.hp, b.hp, k);
  slerpDir(a.bd, b.bd, k, out.bd);
  clampReach(e, wArm(e), out.hp);
  return out;
}
const _pose = { hp: V(), bd: V() }, _A = V(), _B = V(), _EA = V(), _EB = V(), _top = V(), _bot = V(), _hit = V();
function attackCollide(e, act, t0, t1e) {
  const w = e.wdef, n = clamp(Math.ceil((t1e - t0) / 0.012), 1, 6);
  for (let i = 1; i <= n; i++) {
    const t = lerp(t0, t1e, i / n);
    if (t < act.live0) continue;
    if (t > act.live1) { act.done = true; act.missed = true; observe(e.know, e.A, clock, 'def', 'dodge'); return; }
    evalAct(e, act, t, _pose);
    weaponSeg(e, w.haft, _A, _B, _pose);
    weaponSeg(e, w.edge, _EA, _EB, _pose);
    if (clock >= player.shieldStun) for (const s of player.shields) { // 1. Schild im Weg? (nicht, wenn er gerade weggetreten wurde)
      if (segDisc(_A, _B, s.c, s.n, s.r, 0.07, _hit)) { resolveBlock(e, act, 'shield', s, _hit); return; }
    }
    for (const b of player.blades) {  // 2. Klinge im Weg?
      if (segSeg(_A, _B, b.a, b.b, _c1, _c2) < w.r + 0.04) { if (resolveBlock(e, act, 'parry', b, _c1)) return; }
    }
    // 3. Körper des Spielers: Kopf (Kugel) und Rumpf/Beine (Kapsel)
    let zone = null;
    if (segPoint(_EA, _EB, player.head, _hit) < 0.125 + w.r) zone = 'head';
    else {
      _top.copy(player.head); _top.y -= 0.22;
      _bot.copy(player.head); _bot.y = Math.min(_top.y - 0.05, Math.max(player.floor + 0.42, player.head.y - 1.2));
      if (segSeg(_EA, _EB, _top, _bot, _hit) < player.bodyR + w.r) zone = _hit.y < player.floor + 0.95 ? 'legs' : 'body';
    }
    if (zone) {
      act.done = true;
      const dmg = w.dmg * e.atkDmg * DM() * (zone === 'head' ? 1.5 : zone === 'legs' ? 0.8 : 1) * (act.weak || 1);
      player.hit({ dmg, zone, e, type: w.type, name: act.A.name, point: _hit.clone(), from: chestWorld(e, V()) });
      return;
    }
  }
}
// Schlag wurde abgefangen. Liefert true, wenn der Angriff damit beendet ist.
function resolveBlock(e, act, how, obj, point) {
  const heavy = !!e.wdef.heavy;
  observe(e.know, e.A, clock, 'def', how === 'shield' ? 'shield' : 'parry');
  observe(e.know, e.A, clock, 'at', bucket(act.A.target));
  // anpassungsfähige Kombo: wurde oben abgewehrt, kommt der nächste Hieb sofort unten (und umgekehrt)
  if (e.A.adapt > 0.6 && Math.random() < 0.55 * e.A.smart * aiOpts.adapt) {
    const tgt = bucket(act.A.target), alt = Object.keys(e.wdef.moves).filter(n => bucket(ATK[n].target) !== tgt && !(e.kneel && (n === 'oberhau' || n === 'stichHoch')));
    if (alt.length) e.followUp = pick(alt);
  }
  teamOpening(e); // der Spieler ist gebunden: die anderen schlagen zu
  if (how === 'parry') {
    const active = obj.speed > 1.1 || obj.twoHand; // Klinge dem Schlag entgegengeführt (oder beidhändig gehalten)
    if ((heavy && !active) || player.stam < 8) { // schwere Waffe (oder Erschöpfung) schlägt durch eine nur hingehaltene Klinge – mit weniger Wucht
      if (!act.weak) { act.weak = 0.45; player.blocked({ how: 'weak', point: point.clone(), e, w: obj.w }); }
      return false;
    }
    act.done = true;
    // perfekte Parade: Klinge schnell dem Schlag entgegen (Richtung zum Angreifer)
    const toE = t5.subVectors(chestWorld(e, t4), point).normalize();
    const perfect = active && obj.speed > 1.8 && obj.vel.dot(toE) > 0.6;
    player.blocked({ how: active ? 'parry' : 'block', perfect, point: point.clone(), e, w: obj.w, power: e.wdef.dmg });
    startRecoil(e, act, active ? 0.95 : 0.45);
    if (active) parried(e, perfect);
  } else {
    const buckler = !!(obj.w && obj.w.def.shield && obj.w.def.shield.buckler);
    const bash = obj.w && obj.w.cVel && obj.w.cVel.dot(obj.n) > (buckler ? 0.6 : 1.0); // Schild dem Schlag entgegengestoßen
    // erschöpft: Schild wird weggedrückt · Buckler nur hingehalten: der Schlag rutscht ab und trifft gedämpft
    if (player.stam < 8 || (buckler && !bash)) { if (!act.weak) { act.weak = buckler ? 0.55 : 0.5; player.blocked({ how: 'weak', point: point.clone(), e, w: obj.w }); } return false; }
    act.done = true;
    player.blocked({ how: 'shield', perfect: bash, point: point.clone(), e, w: obj.w, heavy, power: e.wdef.dmg });
    startRecoil(e, act, heavy ? 0.42 : bash ? 1.0 : 0.6);
    if (bash) parried(e, false);
  }
  return true;
}
// Waffe prallt ab: Gegner ist kurz offen (Zeit für einen Gegenangriff)
function startRecoil(e, act, T) {
  const wind = act.keys.find(k => Math.abs(k.t - act.tw) < 1e-6) || act.keys[1];
  e.recoil = { t: 0, T, back: { hp: V().lerpVectors(e.wp.hp, wind.hp, 0.55), bd: slerpDir(e.wp.bd, wind.bd, 0.5, V()) } };
  e.act = null; e.queue.length = 0;
  e.cool = Math.max(e.cool, rand(0.25, 0.7));
  if (e.followUp) { e.recoil.T *= 0.65; e.cool = 0.05; e.dbg.why = 'passt Kombo an'; } // sofort ins andere Ziel nachsetzen
}
function finishAttack(e) {
  const act = e.act;
  e.act = null;
  // schwerer Hieb ins Leere: überzogen, stolpert nach vorn – offen für einen Konter
  if (act.missed && (e.wdef.heavy || HEAVY.has(act.name)) && Math.random() < e.A.overext) {
    e.stagger = 0.45 + 0.35 * e.A.overext; e.staggerDir = -1; e.queue.length = 0; note(e, 'überzieht den Hieb!', '#7dffa8'); e.cool = rand(0.6, 1); return;
  }
  if (e.queue.length && !act.missed) { startAttack(e, e.queue.shift(), null, true); return; }
  // Mensur: Elite und Vorsichtige gehen nach dem Angriff wieder aus der Reichweite
  if ((e.persona === 'elite' || e.persona === 'cautious') && !e.kneel && Math.random() < 0.55) e.dodge = { t: 0.26 };
  e.queue.length = 0;
  e.cool = rand(0.7, 1.5) / AG(e) * (e.daze > 0 ? 1.5 : 1) * (e.hurt.torso ? 1.3 : 1) * (e.hp < e.maxHp * 0.5 ? 1.35 : 1) * (e.stam < 25 ? 1.4 : 1) + (act.missed ? 0.35 : 0);
  // andere drankommen lassen
  if (enemies.some(o => o !== e && o.state === 'fight' && !o.token && !o.passive)) { release(e); e.tokenBan = rand(0.8, 1.8); }
}
function updateAttack(e, dt, d, dx, dz) {
  const act = e.act, t0 = act.t;
  act.t += dt;
  if (!act.locked) {
    turnTo(e, player.head.x, player.head.z, dt, 3.5);
    // Angriff abbrechen: der Spieler kommt mit einem schnellen Hieb/Stich zuvor (Kluge brechen ab und parieren)
    if (!act.checked && act.t > 0.08) {
      const th = threatBlade(e);
      if (th) {
        act.checked = true;
        if (e.A.smart > 0.55 && Math.random() < e.A.counter * 0.6 * RE()) { e.act = null; e.queue.length = 0; e.cool = Math.max(e.cool, 0.2); planDefense(e, th, 0.04); e.dbg.why = 'bricht Angriff ab'; return; }
      }
    }
    // Finte nach Lage: deckt der Spieler die Bahn jetzt, setzt ein Elite-Kämpfer im Ausholen um
    if (e.persona === 'elite' && !act.feint && !act.switched && act.t > act.tw * 0.35 && (frame & 3) === 0 && covered(e, act.name)) {
      const alt = Object.keys(e.wdef.moves).filter(n => n !== act.name && !covered(e, n));
      if (alt.length) {
        act.switched = true;
        const n2 = pick(alt), A2 = ATK[n2];
        act.name = n2; act.A = A2; act.keys = [{ t: 0, hp: e.wp.hp.clone(), bd: e.wp.bd.clone() }, keyOf(e, 0.24 * e.atkSlow, A2.wind)];
        act.t = 0; act.tw = 0.24 * e.atkSlow; act.end = act.tw + 10;
        e.dbg.atk = `umgesetzt → ${n2}`;
        return;
      }
    }
    if (act.t >= act.tw) {
      if (d > e.wdef.range + 1.0) { e.act = null; e.queue.length = 0; e.cool = 0.3; return; } // Spieler weg: nicht ins Leere schlagen
      lockAttack(e, act);
    }
  } else if (act.t < act.tw + act.ts) { // Ausfallschritt in den Schlag
    const s = e.wdef.lunge / act.ts * dt * (e.kneel ? 0.2 : 1);
    if (d > e.wdef.range * 0.75) tryMove(e, Math.sin(e.yaw) * s, Math.cos(e.yaw) * s);
  }
  evalAct(e, act, Math.min(act.t, act.end), e.wp);
  // Körper geht mit: aufdrehen beim Ausholen, in den Schlag lehnen
  const A = act.A, k = act.locked ? clamp((act.t - act.tw) / act.ts, 0, 1) : 0;
  e.twist = (act.locked ? lerp(0.5, -0.6, k) : 0.5 * clamp(act.t / act.tw, 0, 1)) * A.twist;
  e.lean = act.locked ? A.lean * Math.sin(Math.min(1, k) * Math.PI * 0.5) * (act.t > act.tw + act.ts + act.tf ? 0.5 : 1) : -0.06;
  if (act.locked && !act.done) attackCollide(e, act, t0, act.t);
  if (e.act === act && act.t >= act.end) finishAttack(e);
}
// Schildstoß eines Gegners: Schild schnellt nach vorne
function updateBash(e, dt, d) {
  const b = e.bash;
  b.t += dt;
  const k = b.t < 0.32 ? -0.4 * (b.t / 0.32) : b.t < 0.47 ? lerp(-0.4, 1, (b.t - 0.32) / 0.15) : Math.max(0, 1 - (b.t - 0.47) / 0.3);
  toLocalPos(e, SHIELD_POSE.mid.c, t1); t1.z += 0.34 * k; t1.y += 0.06 * Math.max(0, k);
  e.sp.c.lerp(t1, Math.min(1, dt * 30));
  e.lean = 0.2 * Math.max(0, k);
  if (b.t > 0.32 && b.t < 0.47) tryMove(e, Math.sin(e.yaw) * 1.6 * dt, Math.cos(e.yaw) * 1.6 * dt);
  if (!b.done && b.t >= 0.4 && e.shield) {
    shieldDisc(e, _sc, _sn);
    _top.copy(player.head); _top.y -= 0.2; _bot.copy(player.head); _bot.y -= 0.8;
    if (segPoint(_top, _bot, _sc, _hit) < 0.46) {
      b.done = true;
      const blockedBy = player.shields.find(s => s.c.distanceTo(_sc) < 0.5);
      if (blockedBy) { player.blocked({ how: 'shield', point: _sc.clone(), e, w: blockedBy.w }); e.stagger = 0.35; }
      else player.hit({ dmg: 7 * DM(), zone: 'body', e, type: 'blunt', name: 'Schildstoß', point: _hit.clone(), from: _sc.clone(), bash: true });
    }
  }
  if (b.t > 0.8) { e.bash = null; e.cool = rand(0.5, 1.1); }
}

// ---- Reaktionen auf Angriffe des Spielers: Schild führen, parieren, ausweichen -------------------
// schnelle Klinge des Spielers, die auf den Gegner zukommt (oder null)
function threatBlade(e) {
  const chest = chestWorld(e, t1);
  for (const b of player.blades) {
    if (b.speed < 1.4 || b.b.distanceTo(chest) > 1.25) continue;
    if (b.vel.dot(t2.subVectors(chest, b.b)) <= 0) continue;
    return b;
  }
  return null;
}
function reactions(e, dt) {
  if (e.parry) { e.parry.t += dt; if (e.parry.t > e.parry.T) e.parry = null; }
  if (e.shieldHold > 0) { e.shieldHold -= dt; if (e.shieldHold <= 0) e.shieldZone = 'mid'; }
  if (e.react) {
    e.react.delay -= dt;
    if (e.react.delay <= 0) {
      const r = e.react; e.react = null;
      if (r.kind === 'shield') { e.shieldZone = r.zone; e.shieldHold = 0.9; }
      else if (r.kind === 'parry') e.parry = { zone: r.zone, t: 0, T: 0.6, hp: r.hp, bd: r.bd };
      else if (r.kind === 'dodge') e.dodge = r.side ? { t: 0.24, dx: Math.cos(e.yaw) * r.side, dz: -Math.sin(e.yaw) * r.side, v: 2.6 } : { t: 0.26 };
    }
  }
  // Bedrohung: eine schnelle Klinge nähert sich
  const threat = threatBlade(e);
  if (!threat) {
    e.threatT += dt;
    if (e.threatT > 0.25 && e.threatOn) {
      e.threatOn = false;
      // der Hieb des Spielers ging ins Leere: kontern (wer gelernt hat, dass der Spieler oft verfehlt, lauert darauf)
      if (clock - e.lastHitT > 0.6) {
        observe(e.know, e.A, clock, 'miss', null);
        const ak = e.A.adapt * aiOpts.adapt;
        if (e.token && Math.random() < e.A.counter * RE() * (1 + ak * Math.min(1, e.know.miss / 4))) { e.cool = Math.min(e.cool, 0.1); e.dbg.why = 'kontert Fehlschlag'; }
        else teamOpening(null);
      }
    }
    return;
  }
  e.threatT = 0;
  if (e.threatOn) return;
  e.threatOn = true; // je Schwung eine Entscheidung
  planDefense(e, threat, -1);
}
// Abwehr planen: Art des Hiebs wahrnehmen (lernen), Vorhersage aus dem Gelernten, Abwehr wählen
const _tl = V(), _bl = V(), _pc = V();
function planDefense(e, threat, delayOverride) {
  const L = e.body.worldToLocal(_tl.copy(threat.b));
  if (L.z < -0.1) return; // von hinten: keine Chance
  // Wahrnehmung: woher kommt der Hieb? (Stich = Bewegung entlang der Klinge)
  _bl.subVectors(threat.b, threat.a).normalize();
  const thrust = Math.abs(t3.copy(threat.vel).normalize().dot(_bl)) > 0.7;
  const kind = thrust ? 'thrust' : L.y > 1.42 - e.drop ? 'high' : L.y < 0.88 - e.drop ? 'low' : L.x > 0 ? 'left' : 'right';
  observe(e.know, e.A, clock, 'sw', kind);
  // Vorhersage: kommt er so, wie er es meistens tut, ist der Gegner vorbereitet (schneller, sicherer)
  const ak = Math.min(1.5, e.A.adapt * aiOpts.adapt), expect = share(e.know, 'sw', kind);
  const prepared = 1 + 1.2 * ak * expect;
  // keine endlosen Abwehrschleifen: nach mehreren Abwehren hintereinander bricht er aus (Gegenangriff oder Rückzug)
  e.defStreak++;
  if (e.defStreak >= 4 && e.token && !e.kneel) {
    e.defStreak = 0;
    if (e.persona === 'cautious' || e.persona === 'fearful') { e.dodge = { t: 0.3 }; e.dbg.why = 'löst sich (zu viel Druck)'; }
    else { e.cool = 0; e.dbg.why = 'bricht aus der Deckung aus'; }
    return;
  }
  e.stam = Math.max(0, e.stam - 3);
  // Reaktionsgüte: benommen schlecht, erschöpft schlechter, verwundet vorsichtiger (deckt öfter)
  const skill = RE() * prepared * (e.daze > 0 ? 0.25 : 1) * (e.stam < 20 ? 0.6 : 1) * (e.hp < e.maxHp * 0.5 ? 1.25 : 1) * (e.beaten > 0 ? 0 : 1), r = -L.x * e.handed;
  const delay = delayOverride >= 0 ? delayOverride : e.A.react * rand(0.8, 1.3) / RE() * (e.daze > 0 ? 1.6 : 1) * (1 - 0.45 * Math.min(1, ak * expect * 1.5));
  e.dbg.delay = delay; e.dbg.expect = expect; e.dbg.seen = kind; e.dbg.n = (e.dbg.n || 0) + 1;
  if (e.shield && armOk(e, 1 - wArm(e))) {
    if (Math.random() < DF(e.A.guard) * skill * (e.hurt[zoneOfArm(1 - wArm(e))] ? 0.6 : 1)) e.react = { kind: 'shield', zone: L.y > 1.42 - e.drop ? 'high' : L.y < 0.88 - e.drop ? 'low' : 'mid', delay };
  } else if (e.weapon && e.weaponId !== 'bow' && armOk(e, wArm(e)) && Math.random() < DF(e.A.parry) * skill * (e.hurt[zoneOfArm(wArm(e))] ? 0.5 : 1)) {
    // dynamische Parade: Waffe quer zur heranfliegenden Klinge, zwischen Brust und Hieb
    const zone = L.y > 1.5 - e.drop ? 'high' : L.y < 0.85 - e.drop ? 'low' : r > 0 ? 'right' : 'left';
    _pc.set(0, 1.22 - e.drop, 0.1);
    const to = t4.subVectors(L, _pc);
    const dist = to.length();
    let hp = null, bd = null;
    if (dist > 0.05) {
      to.divideScalar(dist);
      const BL = t5.copy(_bl).transformDirection(m1.copy(e.body.matrixWorld).invert()).normalize();
      bd = V().crossVectors(BL, to);
      if (bd.lengthSq() > 0.05) {
        bd.normalize(); if (bd.y < -0.2) bd.negate();
        hp = V().copy(_pc).addScaledVector(to, 0.4).addScaledVector(bd, -e.wdef.haft[1] * 0.45);
        hp.y = clamp(hp.y, 0.7 - e.drop, 1.75 - e.drop); hp.z = Math.max(hp.z, 0.22);
      } else bd = null;
    }
    e.react = { kind: 'parry', zone, delay, hp, bd };
  } else if (!e.kneel && Math.random() < DF(e.A.dodge) * skill) e.react = { kind: 'dodge', delay: 0.05, side: Math.random() < 0.45 ? (r > 0 ? -1 : 1) * e.handed : 0 };
}
// Der Gegner hat einen Hieb des Spielers pariert: was jetzt? (Riposte, aus der Bindung stechen, Stoß, Rückzug)
export function enemyParried(e) {
  if (e.state !== 'fight' || e.passive) return;
  const P = e.persona, r = Math.random();
  const moves = e.wdef.moves;
  if (P === 'berserker' && !e.kneel && r < 0.5) { e.kick = { t: 0, done: false }; e.dbg.why = 'Parade → Tritt'; }
  else if ((P === 'cautious' || P === 'fearful') && r < 0.45) { e.dodge = { t: 0.28 }; e.dbg.why = 'Parade → Rückzug'; }
  else if (r < e.A.counter + 0.15) {
    e.followUp = P === 'elite' && moves.stich ? 'stich' : pick(Object.keys(moves));
    if (!e.token && tokens.size < opts.tokens + 1) { tokens.add(e); e.token = true; }
    e.cool = 0; e.parry = null;
    e.dbg.why = P === 'elite' ? 'Parade → Stich aus der Bindung' : 'Parade → Riposte';
  }
}
// Waffe und Schild in die Grundstellung (oder Parade) führen
function guardPose(e, dt, low = 0) {
  const w = e.wdef;
  let rate = 9;
  if (e.parry) { if (e.parry.hp) { t1.copy(e.parry.hp); t2.copy(e.parry.bd); } else { toLocalPos(e, PARRY[e.parry.zone].hp, t1); toLocalDir(e, PARRY[e.parry.zone].bd, t2); } rate = 22; }
  else if (e.taunt) { // Drohgebärde: Waffe hochreißen und brüllen bzw. auf den Schild schlagen
    const k = e.taunt.t / e.taunt.T;
    if (e.taunt.kind === 'bang' && e.shield) { t1.copy(e.sp.c).addScaledVector(e.sp.n, 0.12 + 0.1 * Math.abs(Math.cos(k * Math.PI * 3))); t1.y += 0.12; t2.set(-0.5 * e.handed, 0.6, 0.6).normalize(); rate = 18; }
    else { toLocalPos(e, [0.36, 1.86, 0.05], t1); t1.y += Math.sin(k * 30) * 0.02; toLocalDir(e, [0.25, 0.94, 0.2], t2); rate = 10; }
  } else {
    const G = e.stance && e.fighting && !low && (e.weaponId === 'sword' || e.weaponId === 'mace') ? STANCES[e.stance] : w.guard;
    toLocalPos(e, G.hp, t1); toLocalDir(e, G.bd, t2);
    if (e.bindOff) t1.add(e.bindOff); // in der Bindung weggedrückt
    if (!e.fighting || low) { const k = low || 1; t1.y -= 0.22 * k; t1.z -= 0.08 * k; t2.y -= 0.5 * k; t2.normalize(); } // Waffe gesenkt
  }
  e.wp.hp.lerp(t1, Math.min(1, dt * rate));
  slerpDir(e.wp.bd, t2, Math.min(1, dt * rate), e.wp.bd);
}
function shieldPose(e, dt) {
  if (!e.shield || e.bash) return;
  const hurt = e.hurt[zoneOfArm(1 - wArm(e))];
  if (e.shieldShake > 0) e.shieldShake -= dt;
  // Der Spieler zielt mit Bogen/Armbrust: Schild genau in die Schusslinie halten
  const a = player.aim;
  if (a && e.aimRoll === 1 && !e.down && e.stagger <= 0.25 && !(e.act && e.act.locked)) {
    const A = e.body.worldToLocal(t1.copy(a.o)), B = e.body.worldToLocal(t2.copy(a.o).add(a.d));
    const D = B.sub(A);
    if (D.z < -0.05) {
      const t = (0.4 - A.z) / D.z, c = t3.copy(A).addScaledVector(D, t);
      c.x = clamp(c.x, -0.34, 0.34); c.y = clamp(c.y, 0.84 - e.drop, 1.62 - e.drop); // die Schienbeine bleiben frei
      const rate = (hurt ? 4 : 10) * dt;
      e.sp.c.lerp(c, Math.min(1, rate));
      e.sp.n.lerp(D.normalize().negate(), Math.min(1, rate)).normalize();
      return;
    }
  }
  const z = e.down ? 'down' : e.stagger > 0.25 || e.daze > 1.5 || e.stam < 12 ? 'down' : e.act && e.act.locked ? 'open' : e.fighting ? e.shieldZone : 'open';
  const P = SHIELD_POSE[z], rate = (hurt ? 4 : 9) * dt;
  toLocalPos(e, P.c, t1);
  if (e.shieldShake > 0) t1.z -= 0.09 * Math.sin(e.shieldShake * 40) * e.shieldShake * 3; // Schild federt beim Treffer
  e.sp.c.lerp(t1, Math.min(1, rate));
  e.sp.n.lerp(toLocalDir(e, P.n, t2), Math.min(1, rate)).normalize();
}

// ---- Bogenschütze -------------------------------------------------------------------------------
const shots = []; // fliegende Pfeile der Gegner
const raycaster = new THREE.Raycaster();
function archer(e, dt, d, dx, dz, sameLevel) {
  const a = e.shot || (e.shot = { phase: 'idle', t: 0, hold: 0 });
  turnTo(e, player.head.x, player.head.z, dt, 4);
  e.twist = a.phase === 'draw' ? 0.6 : 0; // beim Spannen seitlich zum Ziel
  if (d < 1.25 && sameLevel) { // Nahkampf: Bogen fallen lassen, Dolch ziehen
    dropItem(e, e.weapon, null, 'bow'); e.weapon = null; e.shot = null;
    setWeapon(e, 'dagger');
    return;
  }
  e.losT -= dt;
  if (e.losT <= 0) {
    e.losT = 0.3;
    const eye = e.head.getWorldPosition(t1), dir = t2.subVectors(player.head, eye), len = dir.length();
    raycaster.set(eye, dir.normalize()); raycaster.far = len;
    e.los = raycaster.intersectObjects(roomOccluders(), false).length === 0;
  }
  if (a.phase === 'idle') {
    if (d < 2.6 && sameLevel) { if (!tryMove(e, -dx * e.speed * e.moveMul * 0.8 * dt, -dz * e.speed * e.moveMul * 0.8 * dt)) footwork(e, dt, d, dx, dz); }
    else if (d > 7 || !e.los || !sameLevel) pathWalk(e, dt, player.head);
    else { e.strafeT -= dt; if (e.strafeT <= 0) { e.strafeT = rand(2, 4); e.strafe = -e.strafe; } tryMove(e, -dz * 0.25 * e.strafe * e.speed * dt, dx * 0.25 * e.strafe * e.speed * dt); }
    e.cool -= dt;
    if (e.cool <= 0 && e.los && d < 9 && d > 1.6) { a.phase = 'nock'; a.t = 0; a.hold = rand(0.15, 0.5); }
  } else if (a.phase === 'nock') { // Pfeil aus dem Köcher ziehen und einlegen
    a.t += dt;
    if (a.t > 0.6) { a.phase = 'draw'; a.t = 0; SFX.click(420, 0.2, 0.05); }
  } else {
    a.t += dt;
    const T = 1.15 * e.atkSlow / opts.speed;
    if (a.t > T + a.hold) { // Schuss
      const from = e.weapon.getWorldPosition(V());
      const v = 21, tt = d / v;
      // Zielpunkt: Brust – außer der Schild des Spielers deckt sie, dann Kopf oder Beine
      const aim = t3.copy(player.head), spots = [-0.32, -0.02, -(player.head.y - player.floor - 0.55)];
      let off = spots[0];
      if (Math.random() < e.A.smart * RE()) for (const o of spots) { off = o; t4.copy(player.head).setY(player.head.y + o); if (!player.shields.some(sh => segDisc(from, t4, sh.c, sh.n, sh.r + 0.04, 0.1, _hit))) break; }
      aim.y += off; aim.addScaledVector(player.vel, tt * 0.6); aim.y += 0.5 * 9.81 * 0.5 * tt * tt;
      const dir = aim.sub(from).normalize();
      const err = 0.035 / RE() * (e.hurt.armR || e.hurt.armL ? 2 : 1);
      dir.x += rand(-err, err); dir.y += rand(-err, err); dir.z += rand(-err, err); dir.normalize();
      const obj = makeArrowMesh(2);
      obj.position.copy(from);
      scene.add(obj);
      shots.push({ obj, vel: dir.clone().multiplyScalar(v), life: 5, stuck: false, e });
      SFX3D.swing(from);
      a.phase = 'idle'; a.t = 0;
      e.cool = rand(2.2, 3.6) / AG(e);
      e.strafe = -e.strafe; e.strafeT = rand(1.5, 3); // Stellung wechseln
    }
  }
}
function archerPose(e) {
  const a = e.shot, drawing = a && a.phase === 'draw';
  const draw = drawing ? clamp(a.t / (1.15 * e.atkSlow / opts.speed), 0, 1) : 0;
  const bowArm = 1 - wArm(e), strArm = wArm(e), sxB = e.arms[bowArm].sx;
  // Zielrichtung im Körper-Raum
  const aim = e.body.worldToLocal(t1.copy(player.head)); aim.y -= 0.3;
  const bp = t2.set(sxB * 0.12, 1.36 - e.drop, drawing ? 0.5 : 0.3);
  if (!drawing) bp.set(sxB * 0.26, 1.02 - e.drop, 0.24);
  clampReach(e, bowArm, bp);
  const dir = t3.subVectors(aim, bp).normalize();
  if (!drawing) dir.set(0, -0.2, 0.98).normalize();
  e.weapon.position.copy(bp);
  e.weapon.quaternion.setFromUnitVectors(ZAXIS, dir);
  solveArm(e, bowArm, bp);
  const sp = t4.copy(bp).addScaledVector(dir, drawing ? -(0.2 + draw * 0.42) : -0.25);
  if (!drawing) sp.set(e.arms[strArm].sx * 0.22, 1.0 - e.drop, 0.18);
  if (a && a.phase === 'nock') { const k = a.t / 0.6; t5.set(e.arms[strArm].sx * 0.16, 1.52 - e.drop, -0.14); sp.lerpVectors(k < 0.5 ? sp : t5, k < 0.5 ? t5 : bp, k < 0.5 ? k * 2 : k * 2 - 1); } // Griff zum Köcher über der Schulter
  solveArm(e, strArm, clampReach(e, strArm, sp));
}
function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.life -= dt;
    if (s.stuck) { if (s.life <= 0) { scene.remove(s.obj); shots.splice(i, 1); } continue; }
    s.vel.y -= 9.81 * 0.5 * dt;
    const dir = t1.copy(s.vel).normalize();
    s.obj.quaternion.setFromUnitVectors(t2.set(0, 0, -1), dir);
    const a = t3.copy(s.obj.position).addScaledVector(dir, ARROW_LEN);          // Spitze vorher
    const b = t4.copy(a).addScaledVector(s.vel, dt);                             // Spitze nachher
    let done = false;
    for (const sh of player.shields) { // Pfeil bleibt im Schild stecken
      if (segDisc(a, b, sh.c, sh.n, sh.r, 0.05, _hit)) {
        s.obj.position.copy(_hit).addScaledVector(dir, -ARROW_LEN + 0.06);
        shots.splice(i, 1); player.arrowStuck(s.obj, sh.w, _hit.clone()); done = true; break;
      }
    }
    if (done) continue;
    for (const bl of player.blades) { // mit der Klinge weggeschlagen
      if (bl.speed > 1.5 && segSeg(a, b, bl.a, bl.b, _c1) < 0.06) {
        shots.splice(i, 1);
        addDebris(s.obj, new THREE.Vector3(rand(-2, 2), rand(0.5, 2), rand(-2, 2)), 3);
        player.blocked({ how: 'deflect', point: _c1.clone(), e: s.e, w: bl.w }); done = true; break;
      }
    }
    if (done) continue;
    let zone = null;
    if (segPoint(a, b, player.head, _hit) < 0.12) zone = 'head';
    else {
      _top.copy(player.head); _top.y -= 0.22;
      _bot.copy(player.head); _bot.y = Math.min(_top.y - 0.05, Math.max(player.floor + 0.42, player.head.y - 1.2));
      if (segSeg(a, b, _top, _bot, _hit) < player.bodyR) zone = _hit.y < player.floor + 0.95 ? 'legs' : 'body';
    }
    if (zone) {
      scene.remove(s.obj); shots.splice(i, 1);
      player.hit({ dmg: EW.bow.dmg * DM() * (zone === 'head' ? 1.5 : zone === 'legs' ? 0.8 : 1), zone, e: s.e, type: 'thrust', name: 'Pfeil', point: _hit.clone(), from: s.obj.position.clone(), arrow: true });
      continue;
    }
    const len = a.distanceTo(b);
    raycaster.set(a, t5.subVectors(b, a).normalize()); raycaster.far = len;
    const wall = raycaster.intersectObjects(roomOccluders(), false)[0];
    if (wall || b.y <= 0.01 || s.life <= 0) {
      const p = wall ? wall.point : b;
      s.obj.position.copy(p).addScaledVector(dir, -ARROW_LEN + 0.04);
      s.stuck = true; s.life = 6;
      SFX.thud(0.2);
      continue;
    }
    s.obj.position.addScaledVector(s.vel, dt);
  }
}

// ---- Kampf-Logik eines Gegners ------------------------------------------------------------------
function fight(e, dt) {
  const hx = player.head.x - e.pos.x, hz = player.head.z - e.pos.z, d = Math.hypot(hx, hz) || 1e-3;
  const dx = hx / d, dz = hz / d;
  const sameLevel = Math.abs(player.floor - e.y) < 0.45;
  e.fighting = d < 3.8 && sameLevel;
  e.lean = 0; e.twist = 0;
  // Erholung: Gleichgewicht und Ausdauer kommen zurück, wenn er nicht angreift
  e.balT -= dt;
  if (e.balT <= 0) e.bal = Math.min(e.A.balance, e.bal + dt * 25);
  if (!e.act) e.stam = Math.min(100, e.stam + dt * (e.token ? 10 : 18));
  if (e.bindOff) e.bindOff.multiplyScalar(Math.exp(-dt * 1.2)); // er drückt langsam zurück in seine Deckung
  if (e.getup) { guardPose(e, dt, 1); return; } // steht gerade auf
  if (e.down && e.down.rag) { // Ragdoll-Sturz: fällt (Physik), liegt benommen, orientiert sich, steht auf
    const D = e.down;
    D.t += dt;
    if (e.stagger > 0) e.stagger -= dt;
    if (e.rag && e.rag.state === 'frozen' && D.t > 1.2) { e.head.rotation.y = Math.sin(clock * 1.4 + e.slot * 5) * 0.35; e.head.updateMatrixWorld(true); } // sieht sich um
    if (D.t >= D.T && (!e.rag || e.rag.state !== 'active' || D.t > D.T + 1.5)) { e.down = null; beginGetUp(e); e.cool = rand(0.6, 1.1); }
    return;
  }
  if (e.beaten > 0) { e.beaten -= dt; guardPose(e, dt, 0.5); return; } // Deckung weggeschlagen: kurz offen
  if (e.rearm && !e.down && e.stagger <= 0 && !e.passive && rearm(e, dt, d)) return;
  if (e.down) { // am Boden (ohne Ragdoll, Budget voll): fällt, liegt (wehrlos), rappelt sich wieder auf
    const D = e.down;
    D.t += dt;
    const k = D.t < 0.45 ? D.t / 0.45 : D.t < D.T - 0.9 ? 1 : Math.max(0, (D.T - D.t) / 0.9);
    e.downK = k * k * (3 - 2 * k);
    if (e.stagger > 0) e.stagger -= dt;
    guardPose(e, dt, 1);
    if (D.t >= D.T) { e.down = null; e.downK = 0; e.cool = rand(0.4, 0.9); }
    return;
  }
  if (e.stagger > 0) { // getroffen: taumelt (stolpert ein paar Schritte), Deckung offen
    e.stagger -= dt;
    e.lean = -0.3 * Math.min(1, e.stagger * 3) * e.staggerDir;
    if (!e.kneel) { const k = -0.7 * Math.min(1, e.stagger * 2) * e.staggerDir * e.moveMul * dt; tryMove(e, Math.sin(e.yaw) * k, Math.cos(e.yaw) * k, true); }
    guardPose(e, dt, 0.6);
    return;
  }
  if (e.recoil) { // Waffe abgeprallt
    const r = e.recoil;
    r.t += dt;
    if (r.t < r.T * 0.4) { e.wp.hp.lerp(r.back.hp, Math.min(1, dt * 16)); slerpDir(e.wp.bd, r.back.bd, Math.min(1, dt * 16), e.wp.bd); e.lean = -0.14; }
    else guardPose(e, dt, 0.3);
    if (r.t >= r.T) e.recoil = null;
    return;
  }
  if (e.passive) { guardPose(e, dt); return; }
  if (e.grab) updateGrab(e, dt);
  if (e.act) { updateAttack(e, dt, d, dx, dz); return; }
  if (e.bash) { turnTo(e, player.head.x, player.head.z, dt, 3); updateBash(e, dt, d); guardPose(e, dt); return; }
  if (e.kick) { turnTo(e, player.head.x, player.head.z, dt, 3); updateKick(e, dt); guardPose(e, dt); return; }
  if (e.dodge) { // Sprung zurück oder zur Seite
    e.dodge.t -= dt;
    if (e.dodge.v) tryMove(e, e.dodge.dx * e.dodge.v * dt, e.dodge.dz * e.dodge.v * dt); else tryMove(e, -dx * 2.3 * dt, -dz * 2.3 * dt);
    if (e.dodge.t <= 0) { e.dodge = null; e.cool = Math.max(e.cool, 0.3); }
    guardPose(e, dt);
    return;
  }
  if (e.weaponId === 'bow') { archer(e, dt, d, dx, dz, sameLevel); return; }
  const canAttack = armOk(e, wArm(e));
  const allies = enemies.filter(o => o !== e && o.state === 'fight' && !o.passive && !o.down).length;
  // Schwer verletzt und nicht allein: hinter die anderen zurückziehen und verschnaufen
  if (!e.retreated && allies > 0 && e.hp < e.maxHp * 0.4 && e.A.smart > 0.5 && !e.kneel) { e.retreated = true; release(e); e.tokenBan = rand(4, 6.5); e.slot = 1.2; note(e, 'zieht sich zurück', '#9ad'); }
  // Rolle: Angreifer (hat eine „Marke“) oder Wartender, der den Spieler umkreist.
  // Wer dem Spieler im Rücken steht, bekommt den Vortritt.
  e.tokenBan -= dt;
  const bs = tac.backstabber;
  if (!e.token && canAttack && e.tokenBan <= 0 && sameLevel && d < 3.8 && tokens.size < opts.tokens && (!bs || bs === e || bs.token || bs.tokenBan > 0)) { tokens.add(e); e.token = true; e.taunt = null; }
  if (e.token && (d > 4.8 || !sameLevel || !canAttack)) release(e);
  // Wird auf mich gezielt? Schildträger entscheiden einmal je Zielvorgang, ob sie den Schild richtig halten
  const aimed = aimedAt(e);
  if (!aimed) e.aimRoll = -1;
  else if (e.aimRoll < 0) e.aimRoll = e.shield && armOk(e, 1 - wArm(e)) && Math.random() < Math.min(0.97, (DF(e.A.guard) + 0.1) * RE()) ? 1 : 0;
  // Bewegung: weit weg oder Hindernis → Laufweg (mit Klettern), sonst Beinarbeit
  e.pathMode -= dt;
  const turn = (e.T.speed > 0.7 ? 4.2 : 2.8) * (e.daze > 0 ? 0.5 : 1) * Math.max(0.5, e.moveMul);
  const zig = aimed && e.aimRoll !== 1 && d > 2.2 && d < 7 && sameLevel && e.los; // ohne Schild im Zickzack heran
  if (zig && e.pathMode <= 0) { turnTo(e, player.head.x, player.head.z, dt, turn); footwork(e, dt, d, dx, dz, true); }
  else if (!sameLevel || d > 3.0 || e.pathMode > 0) pathWalk(e, dt, player.head, player.ranged && d > 2.5 ? 1.3 : 1); // gegen Fernwaffen: schnell heran
  else { turnTo(e, player.head.x, player.head.z, dt, turn); footwork(e, dt, d, dx, dz); }
  // Sichtlinie (für Zickzack/Deckung) gelegentlich prüfen
  e.losT -= dt;
  if (e.losT <= 0) { e.losT = 0.4; const eye = e.head.getWorldPosition(t1), dir = t2.subVectors(player.head, eye), len = dir.length(); raycaster.set(eye, dir.normalize()); raycaster.far = len; e.los = raycaster.intersectObjects(roomOccluders(), false).length === 0; }
  reactions(e, dt);
  if (!e.grab && e.weaponId !== 'bow') tryGrab(e, dt, d);
  // Wartende drohen: brüllen mit erhobener Waffe oder schlagen auf den Schild
  if (e.taunt) { e.taunt.t += dt; if (e.taunt.kind === 'bang' && Math.floor(e.taunt.t / e.taunt.T * 3) !== e.taunt.n) { e.taunt.n = Math.floor(e.taunt.t / e.taunt.T * 3); SFX.thud(0.25); SFX.click(700, 0.2, 0.04); } if (e.taunt.t >= e.taunt.T) e.taunt = null; }
  else if (!e.token && e.fighting && !e.kneel && !aimed) {
    e.tauntT -= dt;
    if (e.tauntT <= 0) { e.tauntT = rand(6, 13); e.taunt = { t: 0, T: e.shield ? 1.2 : 1.5, kind: e.shield ? 'bang' : 'roar', n: -1 }; if (!e.shield) SFX3D.scream(chestWorld(e, t1)); }
  }
  // Grundstellung wechseln (Pflug, Ochs, Alber, vom Tag)
  e.stanceT -= dt;
  if (e.stanceT <= 0) { e.stanceT = rand(2.2, 5); e.stance = e.A.smart > 0.4 && Math.random() < 0.7 ? Math.floor(Math.random() * STANCES.length) : 0; }
  // Angriff beginnen – nie gleichzeitig mit einem anderen (gestaffelt), Ängstliche zögern
  e.cool -= dt;
  if (e.token && e.cool <= 0 && !e.parry && !e.react && sameLevel && d < e.wdef.range + 0.3 && clock - ai.lastStart > 0.32) {
    const facing = Math.sin(e.yaw) * dx + Math.cos(e.yaw) * dz;
    if (facing > 0.92 && e.A.hesitate > 0 && !e.followUp && Math.random() < e.A.hesitate * (1 - e.morale / 100) * 1.2) {
      e.cool = rand(0.5, 1.1); e.dodge = { t: 0.18 }; e.dbg.why = 'zögert'; if (Math.random() < 0.35) note(e, 'zögert …', '#c9a0ff');
    } else if (facing > 0.92 && e.followUp) { const n = e.followUp; e.followUp = null; if (e.wdef.moves[n]) startAttack(e, n, null, true); }
    else if (facing > 0.92) {
      // Der Spieler verschanzt sich hinter dem Schild: wegtreten (dann schlagen die anderen zu) oder mit dem Schild rammen
      const turtled = clock >= player.shieldStun && player.shields.some(sh => segDisc(chestWorld(e, t1), t2.copy(player.head).setY(player.head.y - 0.34), sh.c, sh.n, sh.r, 0.12, _hit));
      if (turtled && d < 1.35 && !e.kneel && Math.random() < 0.35 * e.A.smart + 0.08) e.kick = { t: 0, done: false };
      else if (e.shield && d < 1.15 && Math.random() < 0.22) e.bash = { t: 0, done: false };
      else { const c = chooseAttack(e); e.queue = c.seq.slice(1); startAttack(e, c.seq[0], c.feint); }
    }
  }
  guardPose(e, dt);
}
// Entwaffnet: zur nächsten Waffe am Boden laufen und sie aufheben – sonst Ersatzdolch ziehen bzw. mit Fäusten kämpfen
function rearm(e, dt, d) {
  const R = e.rearm;
  R.t += dt;
  if (!R.target && R.t > 0.3) {
    let best = null, bd = 3.5;
    for (const f of player.floorWeapons()) { if (!EW[f.id]) continue; const fd = Math.hypot(f.pos.x - e.pos.x, f.pos.z - e.pos.z); if (fd < bd && Math.abs(f.pos.y - e.y) < 0.6) { bd = fd; best = f; } }
    if (best && d > 1.2) R.target = best;
    else if (R.t > 0.3) { e.rearm = null; if (e.T.weapons.includes('dagger') || e.type === 'bandit') return false; R.draw = true; e.rearm = { t: 0, draw: true }; return true; }
  }
  if (R.draw) { // Ersatzdolch vom Gürtel ziehen
    toLocalPos(e, [0.22, 0.95, 0.05], t1); e.wp.hp.lerp(t1, Math.min(1, dt * 8));
    if (R.t > 0.6) { setWeapon(e, 'dagger'); e.rearm = null; note(e, 'zieht einen Dolch'); }
    return true;
  }
  if (R.target) {
    const T = R.target.pos;
    if (!R.target.valid()) { e.rearm = { t: 0.3 }; return true; }
    if (Math.hypot(T.x - e.pos.x, T.z - e.pos.z) > 0.45) { pathWalk(e, dt, T, 1.2); guardPose(e, dt, 1); return true; }
    e.lean = 0.9; e.fl.dip = 0.25; // bückt sich
    if (!R.bend) R.bend = 0;
    R.bend += dt;
    if (R.bend > 0.5) { const id = R.target.id; if (R.target.take()) { setWeapon(e, id); note(e, 'hebt eine Waffe auf'); } e.rearm = null; }
    return true;
  }
  return false;
}
// Tritt: gegen den Schild des Spielers (reißt ihn kurz zur Seite) oder in den Bauch
function updateKick(e, dt) {
  const k = e.kick;
  k.t += dt;
  e.lean = -0.16;
  if (!k.done && k.t >= 0.4) {
    k.done = true;
    const foot = e.legs[0].mid.localToWorld(t1.set(0, -SHIN, 0.08));
    // trifft jeden Schild, der vor dem Rumpf gehalten wird (nicht einen hoch über den Kopf gehobenen)
    const sh = player.shields.find(x => Math.hypot(x.c.x - foot.x, x.c.z - foot.z) < 0.5 && x.c.y - player.floor < 1.5 && x.c.y - x.r < foot.y + 0.5);
    SFX3D.swing(foot);
    if (sh) { // Schild weggetreten: für einen Moment deckt er nicht
      player.shieldStun = clock + 0.65;
      player.blocked({ how: 'kicked', point: sh.c.clone(), e, w: sh.w });
      teamOpening(null);
      e.cool = Math.min(e.cool, 0.2);
    } else {
      _top.copy(player.head); _top.y -= 0.3; _bot.copy(player.head); _bot.y -= 0.95;
      if (segPoint(_top, _bot, foot, _hit) < 0.36) player.hit({ dmg: 6 * DM(), zone: 'body', e, type: 'blunt', name: 'Tritt', point: _hit.clone(), from: chestWorld(e, V()) });
    }
  }
  if (k.t > 0.85) { e.kick = null; e.cool = Math.max(e.cool, rand(0.3, 0.7)); }
}

// ---- Körperhaltung: Beine, Rumpf, Arme (Arme folgen Waffe/Schild per Inverser Kinematik) ---------
function solveArm(e, i, target) {
  const arm = e.arms[i], inv = q1.copy(e.torso.quaternion).invert();
  const T = t5.copy(target).sub(e.hips.position).applyQuaternion(inv);
  const S = arm.top.position;
  const d = t6.subVectors(T, S);
  let dist = d.length();
  const maxD = L1 + L2 - 0.004;
  if (dist > maxD) { d.multiplyScalar(maxD / dist); dist = maxD; }
  if (dist < 0.1) { d.set(0, -0.1, 0.02); dist = d.length(); }
  const dir = t7.copy(d).divideScalar(dist);
  const cosA = clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  // Ellbogen zeigt nach außen-unten-hinten
  const pole = t8.set(arm.sx * 0.55, -0.75, -0.35).applyQuaternion(inv);
  pole.addScaledVector(dir, -pole.dot(dir));
  if (pole.lengthSq() < 1e-6) pole.set(arm.sx, 0, 0);
  pole.normalize();
  const u = pole.multiplyScalar(sinA).addScaledVector(dir, cosA); // Richtung Oberarm
  arm.top.quaternion.setFromUnitVectors(DOWN, u);
  const f = dir.copy(d).addScaledVector(u, -L1).normalize().applyQuaternion(q2.copy(arm.top.quaternion).invert());
  arm.mid.quaternion.setFromUnitVectors(DOWN, f);
}
const _x = V(), _z = V();
function orient(obj, bd, hint) { // +Y entlang der Klinge, +X (Schneide) in Schwungrichtung
  _x.copy(hint).addScaledVector(bd, -hint.dot(bd));
  if (_x.lengthSq() < 1e-4) _x.set(1, 0, 0).addScaledVector(bd, -bd.x);
  _x.normalize();
  _z.crossVectors(_x, bd);
  obj.quaternion.setFromRotationMatrix(m1.makeBasis(_x, bd, _z));
}
function limpArm(e, i, sw) {
  const A = e.arms[i];
  A.top.quaternion.setFromEuler(new THREE.Euler(0.12 + sw * 0.2, 0, A.sx * 0.1));
  A.mid.quaternion.setFromEuler(new THREE.Euler(-0.18, 0, 0));
}
function pose(e, dt) {
  const sp = e.moved / Math.max(dt, 1e-4);
  e.gait = damp(e.gait, sp > 0.08 ? 1 : 0, 10, dt);
  e.phase += e.moved * 5.2 / e.scale;
  const a = e.gait, fighting = e.state === 'fight';
  // Beine
  let sag = 0;
  for (let i = 0; i < 2; i++) {
    const Lg = e.legs[i], zone = i === 0 ? 'legR' : 'legL', ph = e.phase + i * Math.PI, s = Math.sin(ph), c = Math.cos(ph);
    if (e.kneel) { Lg.top.rotation.x = 0.08 + s * 0.1 * a; Lg.mid.rotation.x = 1.5; continue; }
    const crip = e.crip[zone], hurt = e.inj[zone] >= LIMP;
    const amp = (crip ? 0.16 : hurt ? 0.36 : 0.56) * a;
    const stance = (i === 1 ? -0.24 : 0.17) * (1 - a) * (fighting ? 1 : 0.25); // Kampfstellung: linker Fuß vorn
    Lg.top.rotation.x = -s * amp + stance;
    Lg.mid.rotation.x = Math.max(0, c) * 0.95 * a * (crip ? 0.25 : 1) + (fighting ? 0.2 : 0.05) * (1 - a) + (crip ? 0.12 : 0);
    if ((crip || hurt) && s < 0) sag = Math.max(sag, -s * (crip ? 0.09 : 0.045) * a); // hinken: Körper sackt ab
    e.limpSide = hurt || crip ? Lg.sx : e.limpSide;
  }
  // Tritt: rechtes Bein anziehen und nach vorne stoßen
  if (e.kick) {
    const kt = e.kick.t, Lg = e.legs[0];
    const up = kt < 0.3 ? kt / 0.3 : kt < 0.45 ? 1 : Math.max(0, 1 - (kt - 0.45) / 0.35), ext = kt < 0.3 ? 0 : kt < 0.42 ? (kt - 0.3) / 0.12 : Math.max(0, 1 - (kt - 0.45) / 0.3);
    Lg.top.rotation.x = -1.35 * up; Lg.mid.rotation.x = 1.5 * up * (1 - ext);
  }
  // Treffer-Reaktionen klingen ab
  const F = e.fl, dec = Math.exp(-dt * 6);
  F.hx *= dec; F.hy *= dec; F.lean *= dec; F.tw *= dec; F.dip *= dec; F.roll = (F.roll || 0) * dec;
  // am Boden liegen / wieder aufstehen
  if (fighting || e.downK > 0) { e.body.rotation.x = -e.downK * 1.5; e.body.position.y = 0.13 * e.downK; }
  const breathe = Math.sin(clock * 1.7 + e.slot * 6) * 0.006;
  const hy = e.kneel ? 0.52 : HIP - (fighting ? 0.035 : 0) - Math.abs(Math.cos(e.phase)) * 0.022 * a - sag - F.dip + breathe - (e.downK > 0 && e.downK < 1 ? 0.2 * Math.sin(e.downK * Math.PI) : 0);
  e.hips.position.y = damp(e.hips.position.y, hy, 12, dt);
  e.drop = HIP - e.hips.position.y;
  // Rumpf und Kopf
  e.leanCur = damp(e.leanCur, e.lean + (fighting ? 0.07 : 0.03) + (e.hurt.torso ? 0.1 : 0), 14, dt);
  e.twistCur = damp(e.twistCur, -e.twist * e.handed, 14, dt);
  const wob = e.daze > 0 ? Math.sin(clock * 5) * 0.07 * Math.min(1, e.daze) : 0;
  const pant = e.stam < 30 ? Math.sin(clock * 9) * 0.025 * (1 - e.stam / 30) : 0; // erschöpft: keucht sichtbar
  e.torso.rotation.set(e.leanCur + F.lean + pant, e.twistCur + F.tw, wob + sag * 1.2 * (e.limpSide || 0) + Math.sin(e.phase) * 0.03 * a + F.roll);
  // Blick: Kopf dreht sich gedämpft zum Spieler (begrenzt wie ein echter Hals)
  let lookY = 0, lookX = 0;
  if (fighting && !e.down && e.weaponId) {
    const L = e.body.worldToLocal(t1.copy(player.head));
    lookY = clamp(Math.atan2(L.x, L.z) - e.twistCur, -1.0, 1.0);
    lookX = clamp(-Math.atan2(L.y - (e.hips.position.y + 1.1), Math.hypot(L.x, L.z)), -0.5, 0.45);
  }
  e.lookY = damp(e.lookY || 0, lookY, 7, dt); e.lookX = damp(e.lookX || 0, lookX, 7, dt);
  e.head.rotation.set(e.lookX - e.leanCur * 0.5 + (e.daze > 0 ? 0.15 : 0) + F.hx, e.lookY + F.hy, wob * 1.5);
  // Waffe, Schild und Arme
  const wa = wArm(e), oa = 1 - wa, sw = Math.sin(e.phase) * a;
  if (e.weaponId === 'bow' && e.weapon) { archerPose(e); return; }
  if (armOk(e, wa)) {
    clampReach(e, wa, e.wp.hp);
    // Schneide zeigt in Schwungrichtung
    t1.subVectors(e.wp.hp, e.lastHp);
    if (t1.lengthSq() > 1e-5) e.hint.lerp(t1.normalize(), 0.5).normalize();
    e.lastHp.copy(e.wp.hp);
    if (e.weapon) { e.weapon.position.copy(e.wp.hp); orient(e.weapon, e.wp.bd, e.hint); }
    solveArm(e, wa, e.wp.hp);
  } else limpArm(e, wa, sw);
  if (!armOk(e, oa)) limpArm(e, oa, -sw);
  else if (e.shield) {
    clampReach(e, oa, e.sp.c, 0.04);
    e.shield.position.copy(e.sp.c);
    e.shield.quaternion.setFromUnitVectors(ZAXIS, e.sp.n);
    solveArm(e, oa, t1.copy(e.sp.c).addScaledVector(e.sp.n, -0.05));
  } else if (e.wdef.twoH && armOk(e, wa)) { // zweite Hand am Schaft (rutscht nach, wenn sie nicht hinkommt)
    const S = shoulder(e, oa, t2);
    let s = e.wdef.twoH;
    for (const tryS of [e.wdef.twoH, 0.3, 0.16]) { s = tryS; if (t1.copy(e.wp.hp).addScaledVector(e.wp.bd, tryS).distanceTo(S) <= REACH) break; }
    solveArm(e, oa, t1.copy(e.wp.hp).addScaledVector(e.wp.bd, s));
  } else if (fighting) solveArm(e, oa, t1.set(e.arms[oa].sx * 0.2, 1.14 - e.drop, 0.27)); // freie Hand vor der Brust
  else if (e.state !== 'yield') limpArm(e, oa, -sw);
  // freie Hand greift nach der Waffe des Spielers bzw. hält sie fest
  if (e.grab) {
    const g = e.grab, k = g.phase === 'reach' ? THREE.MathUtils.smoothstep(g.t / 0.28, 0, 1) : 1;
    solveArm(e, g.hand, t1.lerpVectors(g.from, g.local, k));
  }
  // ergeben: beide Hände hoch
  if (e.state === 'yield') {
    const k = Math.min(1, e.t / 0.5);
    for (let i = 0; i < 2; i++) if (armOk(e, i)) solveArm(e, i, t1.set(e.arms[i].sx * lerp(0.2, 0.3, k), lerp(1.0, 1.78, k) - e.drop, lerp(0.25, 0.12, k)));
    if (e.morale < 30) e.torso.rotation.z += Math.sin(clock * 23) * 0.01; // zittert
  }
}
// Kletter-Haltung (durchs Fenster / auf ein Hindernis)
function climbPose(e, k) {
  const s = Math.sin(k * Math.PI);
  e.legs[0].top.rotation.x = -0.9 * s; e.legs[0].mid.rotation.x = 1.1 * s;
  e.legs[1].top.rotation.x = -0.5 * s; e.legs[1].mid.rotation.x = 0.8 * s;
  e.lean = 0.4 * s;
}

// ---- Hauptschleife ------------------------------------------------------------------------------
export function updateEnemies(dt) {
  frame++; clock += dt;
  updateRagdolls(dt);  // nach dem Physik-Schritt: Ragdoll-Körper → Knochen
  updateRagArrows(dt);
  updateShots(dt);
  tactics(dt);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.t += dt;
    e.moved = 0;
    if (e.state === 'dead') { deadUpdate(e, dt); continue; }
    // Wissen über den Spieler: gestaffelt alle 0,5 s aktualisieren (Verzögerung + Vergessen)
    const K = e.know;
    K.acc = (K.acc || 0) + dt; K.tick -= dt;
    if (K.tick <= 0) { tickKnow(K, K.acc, clock); K.acc = 0; K.tick = 0.5; }
    if (e.state === 'fight' && !e.passive) moraleTick(e, dt);
    if (e.daze > 0) e.daze -= dt;
    // Blutung
    if (e.bleed > 0.05) {
      e.hp -= e.bleed * dt; e.bleed *= 1 - 0.06 * dt;
      e.bleedT -= dt;
      if (e.bleedT <= 0) { e.bleedT = rand(0.35, 0.8); burst(chestWorld(e, t1), BLOOD, 2); if (Math.random() < 0.3) floorDecal(e.pos, 'blood', rand(0.12, 0.25)); }
      if (e.hp <= 0) { kill(e, null); continue; }
    }
    e.groanT -= dt;
    if (e.groanT <= 0) { e.groanT = rand(5, 11); if (e.state === 'fight' && !e.passive) SFX3D.growl(chestWorld(e, t1), 'runner'); }

    if (e.state === 'rise') {
      e.body.position.y = Math.min(0, e.body.position.y + dt * 1.4);
      turnTo(e, player.head.x, player.head.z, dt);
      if (Math.random() < dt * 8) puff(t1.copy(e.pos).setY(0.05), 0x5a4a3a, 0.15, 0.8, 0.2, 0.4);
      if (e.body.position.y >= 0) e.state = 'fight';
      guardPose(e, dt);
    } else if (e.state === 'approach') { // draußen zur Tür/zum Fenster
      if (walkTo(e, e.entry, dt)) { if (e.opening.type === 'window') { e.state = 'climbIn'; e.t = 0; e.climbFrom = e.pos.clone(); } else e.state = 'enter'; }
      guardPose(e, dt);
    } else if (e.state === 'enter') {
      if (walkTo(e, e.inside, dt)) e.state = 'fight';
      guardPose(e, dt);
    } else if (e.state === 'climbIn') { // durchs Fenster: auf die Brüstung, hinüber, herunter
      const sill = Math.min(1.4, e.opening.bottom), k = Math.min(1, e.t / 1.6);
      e.pos.lerpVectors(e.climbFrom, e.inside, THREE.MathUtils.smoothstep(k, 0.25, 0.85));
      const up = k < 0.4 ? THREE.MathUtils.smoothstep(k, 0, 0.4) : k < 0.75 ? 1 : 1 - THREE.MathUtils.smoothstep(k, 0.75, 1);
      e.body.position.y = up * sill / e.scale;
      guardPose(e, dt, 1);
      if (k >= 1) { e.body.position.y = 0; e.state = 'fight'; SFX3D.step(e.pos, 1.2); }
    } else if (e.state === 'climbUp') { // auf Bett/Tisch klettern bzw. herunterspringen
      const c = e.climb;
      c.t += dt;
      const k = Math.min(1, c.t / c.T);
      if (c.up) { e.y = lerp(c.from.y, c.to.y, THREE.MathUtils.smoothstep(k, 0.05, 0.7)); e.pos.lerpVectors(c.from, c.to, THREE.MathUtils.smoothstep(k, 0.45, 1)).setY(0); }
      else { e.pos.lerpVectors(c.from, c.to, k).setY(0); e.y = lerp(c.from.y, c.to.y, k * k) + Math.sin(k * Math.PI) * 0.12; }
      guardPose(e, dt, 1);
      if (k >= 1) { e.y = c.to.y; e.state = c.back === 'flee' ? 'flee' : 'fight'; e.path = null; e.climb = null; SFX3D.step(t1.copy(e.pos).setY(e.y), 1.1); }
    } else if (e.state === 'fight') {
      fight(e, dt);
      if (e.down && e.down.rag) { e.prevPos.copy(e.pos); continue; } // liegt als Ragdoll: Physik bewegt den Körper
      shieldPose(e, dt);
      const g = groundAt(e.pos.x, e.pos.z);
      if (Math.abs(g - e.y) <= STEP) e.y = lerp(e.y, g, Math.min(1, dt * 10));
    } else if (e.state === 'yield') {
      yieldUpdate(e, dt);
    } else if (e.state === 'flee') { // zur nächsten Tür/zum Fenster und hinaus
      e.fighting = false;
      if (Math.hypot(e.exitIn.x - e.pos.x, e.exitIn.z - e.pos.z) < 0.35) { e.state = 'exit'; e.t = 0; e.climbFrom = e.pos.clone(); }
      else pathWalk(e, dt, e.exitIn, 1.35);
      guardPose(e, dt, 1); shieldPose(e, dt);
    } else if (e.state === 'exit') {
      if (e.opening.type === 'window') {
        const sill = Math.min(1.4, e.opening.bottom), k = Math.min(1, e.t / 1.5);
        e.pos.lerpVectors(e.climbFrom, e.exitOut, THREE.MathUtils.smoothstep(k, 0.2, 0.9));
        e.body.position.y = Math.sin(k * Math.PI) * sill / e.scale;
        e.yaw = Math.atan2(e.exitOut.x - e.climbFrom.x, e.exitOut.z - e.climbFrom.z);
        if (k >= 1) { if (!e.sentAway) player.defeated(e, 'fled'); removeEnemy(e); continue; }
      } else if (walkTo(e, e.exitOut, dt, false, 1.35)) { if (!e.sentAway) player.defeated(e, 'fled'); removeEnemy(e); continue; }
      guardPose(e, dt, 1);
    }
    // Abstand zu anderen Gegnern und zum Spieler
    if (e.state === 'fight' && !e.passive) {
      for (const o of enemies) {
        if (o === e || o.state === 'dead' || (o.down && o.down.rag) || Math.abs(o.y - e.y) > 0.5) continue;
        const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z, od = Math.hypot(ox, oz);
        if (od > 0.001 && od < 0.6) { const p = (0.6 - od) * 0.5 * Math.min(1, dt * 10); tryMove(e, ox / od * p, oz / od * p, true); }
      }
      const px = e.pos.x - player.head.x, pz = e.pos.z - player.head.z, pd = Math.hypot(px, pz);
      if (pd > 0.001 && pd < 0.55 && Math.abs(player.floor - e.y) < 0.5) tryMove(e, px / pd * (0.55 - pd), pz / pd * (0.55 - pd), true);
    }
    if (e.state === 'climbIn' || e.state === 'climbUp' || (e.state === 'exit' && e.opening.type === 'window')) {
      const k = e.state === 'climbUp' ? Math.min(1, e.climb ? e.climb.t / e.climb.T : 1) : Math.min(1, e.t / 1.6);
      pose(e, dt); climbPose(e, k);
    } else { pose(e, dt); if (e.getup) applyGetUp(e, dt); }
    // Schritte hörbar
    const stepPh = Math.floor(e.phase / Math.PI);
    if (stepPh !== e.stepPh) { e.stepPh = stepPh; if (e.gait > 0.5) SFX3D.step(t1.copy(e.pos).setY(e.y), e.type === 'knight' ? 1.3 : 0.7); }
    place(e);
    // eigene Geschwindigkeit (geht in den Sturz ein)
    if (dt > 0) e.vel.lerp(t1.subVectors(e.pos, e.prevPos).divideScalar(dt), 0.3);
    e.prevPos.copy(e.pos);
  }
}
// Sterben: Knie geben nach, Körper kippt um und bleibt liegen, verschwindet nach einer Weile
function deadUpdate(e, dt) {
  const t = e.t;
  if (e.ragDead) { // Ragdoll: die Physik hat ihn hingelegt; nach einer Weile versinkt er
    if (!e.landed && t > 0.6) { e.landed = true; SFX.thud(0.5); if (e.inj.torso + e.inj.head + e.bleed * 10 > 15) floorDecal(e.hips.getWorldPosition(t1).setY(0), 'blood', rand(0.5, 0.8)); }
    if (t > 9) {
      if (e.rag && e.rag.state === 'active') freezeRagdoll(e.rag);
      e.body.position.y -= dt * 0.25 / e.scale;
      if (t > 10.5) { removeEnemy(e); return; }
      e.root.updateMatrixWorld(true);
    }
    return;
  }
  if (t < 1.0) {
    const k1 = Math.min(1, t / 0.3), k2 = clamp((t - 0.2) / 0.7, 0, 1), ease = k2 * k2 * (3 - 2 * k2);
    e.hips.position.y = lerp(e.hips.position.y, HIP - 0.3 * k1 * (1 - ease), 0.5);
    for (const L of e.legs) { L.top.rotation.x = lerp(L.top.rotation.x, -0.5 * k1 * (1 - ease), 0.3); L.mid.rotation.x = lerp(L.mid.rotation.x, 1.0 * k1 * (1 - ease), 0.3); }
    e.body.rotation.x = e.fall * ease * Math.PI / 2;
    e.body.rotation.z = e.fallRoll * ease;
    e.body.position.y = 0.13 * ease;
    e.torso.rotation.set(e.fall * 0.2 * (1 - ease), 0.25 * ease, 0);
    e.head.rotation.set(-e.fall * 0.3 * ease, 0.5 * ease, 0);
    for (const A of e.arms) { A.top.quaternion.slerp(q1.setFromEuler(new THREE.Euler(-e.fall * 0.6, 0, A.sx * 0.9)), 0.15); A.mid.quaternion.slerp(q2.setFromEuler(new THREE.Euler(-0.5, 0, 0)), 0.15); }
    if (!e.landed && t > 0.85) { e.landed = true; SFX.thud(0.5); if (e.inj.torso + e.inj.head + e.bleed * 10 > 15) floorDecal(t1.copy(e.pos).addScaledVector(t2.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)), e.fall * 0.8), 'blood', rand(0.5, 0.8)); }
  } else if (t > 9) {
    e.body.position.y -= dt * 0.25;
    if (t > 10.5) { removeEnemy(e); return; }
  }
  e.root.updateMatrixWorld(true);
}
// Knochen einer Trefferzone (z. B. damit ein Pfeil dort stecken bleibt)
// Vorwärmen: alle Gesichter, Gegner-Typen, Waffen und Schilde einmal erzeugen (Geometrien, Texturen, Shader),
// damit beim ersten Erscheinen im Kampf nichts ruckelt. Liefert eine Gruppe zum einmaligen Zeichnen.
export function warmupGroup() {
  warmFaces();
  const g = new THREE.Group();
  TYPE_ORDER.forEach((t, i) => {
    const f = buildFighter(t);
    f.root.position.set(i * 0.2, 0, 0);
    for (const id of ENEMY_TYPES[t].weapons) f.body.add(makeWeapon(id));
    if (ENEMY_TYPES[t].shield) f.body.add(makeShield(ENEMY_TYPES[t].shield, f.tunic));
    g.add(f.root);
  });
  for (const id of ['dagger', 'fist']) g.add(makeWeapon(id));
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.05), bloodMat); g.add(b); g.add(makeBlob());
  return g;
}
export function boneOf(e, zone) {
  return zone === 'head' ? e.head : zone === 'torso' ? e.torso : zone === 'armR' ? e.arms[0].top : zone === 'armL' ? e.arms[1].top : zone === 'legR' ? e.legs[0].top : e.legs[1].top;
}

// ---- Gefallene anstoßen: Treffer auf einen Liegenden/Toten bewegt den Körper (Ragdoll wird bei Bedarf reaktiviert) ----
export function corpseTest(a, b, radius = 0.03) {
  for (const e of enemies) {
    if (!(e.state === 'dead' && e.t < 9) && !(e.down && e.down.rag)) continue;
    if (segPoint(a, b, e.hips.getWorldPosition(_mid)) > 1.4) continue;
    for (const z of zones(e)) if (segSeg(a, b, z.a, z.b, _c1, _c2) - z.r - radius < 0) return { e, zone: z.zone, point: _c1.clone() };
  }
  return null;
}
export function pushCorpse(e, point, dir, power) {
  if (e.down && e.down.rag) return false; // Lebende am Boden: über applyHit
  if (e.rag && e.rag.state === 'active') { pokeRagdoll(e.rag, point, dir, power); return true; }
  const R = startRagdoll(e, { point, dir, power });
  if (R) { e.ragDead = true; e.t = Math.min(e.t, 6); }
  return !!R;
}

// ---- Test-Menü: gezielt auslösen ----------------------------------------------------------------------
export const debugApi = {
  knockdown(e) { // Stolpern/Sturz ohne Schaden
    if (!e || e.state !== 'fight' || e.down || e.getup) return false;
    const dir = t1.set(e.pos.x - player.head.x, 0, e.pos.z - player.head.z).normalize().clone();
    knockDown(e, dir, chestWorld(e, V()), 30); note(e, 'Zu Boden! (Test)');
    return true;
  },
  stumble(e) {
    if (!e || e.state !== 'fight' || e.down) return false;
    e.stagger = 0.9; e.staggerDir = 1; e.act = null; e.queue.length = 0; note(e, 'stolpert (Test)');
    return true;
  },
  disarm(e) { if (!e || !e.weapon || e.weaponId === 'fist' || e.weaponId === 'bow') return false; disarm(e, t1.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize()); return true; },
  grab(e) { if (!e || e.state !== 'fight') return false; e.forceGrab = true; e.grabCool = 0; e.grabT = 0; return true; },
  surrender(e) { if (!e || e.state !== 'fight') return false; surrender(e); return true; },
  persona(e, pid) {
    if (!e || !PERSONAS[pid]) return false;
    const m = e.morale / Math.max(1, e.A.morale0);
    e.A = makeAttrs(e.T, pid); e.persona = pid; e.morale = clamp(e.A.morale0 * m, 0, 100);
    e.bal = Math.min(e.bal, e.A.balance);
    return true;
  },
  setMorale(e, v) { if (!e) return false; e.morale = clamp(v, 0, 100); return true; }
};
// Zustand eines Gegners in Worten (Test-Anzeige)
export function describe(e) {
  const st = e.state === 'fight' ? (e.getup ? 'steht auf' : e.down ? (e.down.rag ? 'liegt (Ragdoll)' : 'liegt') : e.grab ? (e.grab.phase === 'hold' ? 'hält deine Waffe' : 'greift zu') : e.act ? 'greift an' : e.parry ? 'pariert' : e.recoil ? 'abgeprallt' : e.stagger > 0 ? 'taumelt' : e.rearm ? 'sucht Waffe' : e.token ? 'Angreifer' : 'lauert')
    : { yield: 'ergeben', flee: 'flieht', dead: 'tot', approach: 'kommt', enter: 'kommt herein', climbIn: 'klettert', climbUp: 'klettert', exit: 'geht', rise: 'taucht auf' }[e.state] || e.state;
  const phys = e.rag ? (e.rag.state === 'active' ? 'Ragdoll aktiv' : 'Ragdoll eingefroren') : e.getup ? 'Übergang Physik → Animation' : (e.state === 'dead' ? 'Sturz-Animation' : 'Animation');
  return { st, phys, atk: e.dbg.atk, why: e.dbg.why, lever: e.dbg.lever || '', pat: patterns(e.know) };
}
