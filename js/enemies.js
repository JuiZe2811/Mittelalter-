import * as THREE from 'three';
import { surfacesOf, roomOccluders } from './room.js?v=9';
import { buildNav, findPath, walkable, nearestWalkable, groundAt, STEP } from './nav.js?v=9';
import { SFX, SFX3D } from './sfx.js?v=9';
import { puff, addDebris, burst, sparks, floorDecal, floatingText } from './effects.js?v=9';
import { segSeg, segPoint, segDisc, slerpDir } from './geom.js?v=9';
import { makeArrowMesh, ARROW_LEN } from './arrow.js?v=9';
import { HIP, SH_X, SH_Y, L1, L2, THIGH, SHIN, REACH, ENEMY_TYPES, TYPE_ORDER, ATK, EW, PARRY, SHIELD_POSE, SHIELD_R, SHIELD_HP, STANCES, bloodMat, buildFighter, makeWeapon, makeShield, makeBlob, warmFaces } from './fighter.js?v=9';

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
  look: new THREE.Vector3(0, 0, -1), ranged: false, shieldStun: 0, // Blickrichtung · hält Fernwaffe · Schild weggetreten bis (Zeit)
  hit() {}, blocked() {}, arrowStuck() {}, defeated() {},
  dropped() { return false; } // eine Waffe/ein Schild fällt: main.js macht daraus eine aufhebbare Waffe (true = übernommen)
};
// Einstellungen: Schaden, Reaktionsvermögen und Tempo der Gegner, Texte, gleichzeitige Angreifer
export const opts = { dmg: 1, react: 1, speed: 1, texts: true, tokens: 2 };
export function initEnemies(s) { scene = s; }
export const aliveCount = () => enemies.filter(e => e.state !== 'dead').length;
export function prepareNav(head) { buildNav(head); }

const LIMP = 22, CRIP = 50;   // Verletzung einer Zone: ab hier beeinträchtigt / unbrauchbar
const OUTSIDE = 1.6;
const rand = THREE.MathUtils.randFloat, clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp, damp = THREE.MathUtils.damp;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const V = () => new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0), ZAXIS = new THREE.Vector3(0, 0, 1);
const t1 = V(), t2 = V(), t3 = V(), t4 = V(), t5 = V(), t6 = V(), t7 = V(), t8 = V();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), m1 = new THREE.Matrix4();
const BLOOD = 0x8a0a0a;
const tokens = new Set(); // wer gerade angreifen darf (die anderen umkreisen den Spieler)
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const tac = { t: 0, backstabber: null };

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
  const e = Object.assign(buildFighter(type), {
    type, T, name: T.name, pos: V(), y: 0, yaw: 0, t: 0, state: 'approach',
    hp: T.hp, maxHp: T.hp, inj: { head: 0, torso: 0, armR: 0, armL: 0, legR: 0, legL: 0 }, hurt: {}, crip: {}, bleed: 0, bleedT: 0,
    handed: 1, weaponId: null, wdef: null, weapon: null, shield: null, shieldKind: null, shieldR: 0, helmOff: false,
    wp: { hp: V(), bd: V() }, sp: { c: V(), n: V() }, hint: new THREE.Vector3(0, 0, 1), lastHp: V(),
    act: null, queue: [], cool: rand(0.5, 1.3), stagger: 0, staggerDir: 1, daze: 0, recoil: null, parry: null, react: null, dodge: null, bash: null, shot: null,
    threatOn: false, threatT: 0, shieldZone: 'mid', shieldHold: 0,
    path: null, pathT: 0, pathMode: 0, phase: rand(0, 6), gait: 0, moved: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1.5, 4), slot: Math.random(),
    token: false, tokenBan: 0, fighting: false, losT: 0, los: true,
    speed: T.speed * rand(0.93, 1.07) * (o.speedMul || 1), moveMul: 1, atkSlow: 1, atkDmg: 1, kneel: false, drop: 0,
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
  release(e);
  scene.remove(e.root);
  if (e.blob) scene.remove(e.blob);
  const i = enemies.indexOf(e);
  if (i >= 0) enemies.splice(i, 1);
}
export function clearEnemies() {
  for (const e of enemies.splice(0)) { scene.remove(e.root); if (e.blob) scene.remove(e.blob); }
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
    if (e.parry && e.parry.t > 0.07 && e.weapon) {
      weaponSeg(e, e.wdef.haft, _ha, _hb);
      if (segSeg(a, b, _ha, _hb, _c1) < 0.06 + radius) { blocked = true; offer({ kind: 'parry', e, zone: null, point: _c1.clone() }, ordered ? along(_c1) : -1); }
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
  const raw = e.armor[zone][info.type] ?? 1;
  const mul = raw + (1 - raw) * (info.pen || 0); // Durchschlag (Axt, Hammer, Armbrustbolzen) hebt einen Teil der Rüstung auf
  const dmg = info.power * mul * (e.down ? 1.25 : 1);
  res.armor = mul <= 0.36;
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
  // sichtbare Treffer-Reaktion je Körperteil
  if (zone === 'torso') e.fl.lean = 0.3;
  else if (zone === 'armR' || zone === 'armL') e.fl.tw = (zone === 'armR' ? 1 : -1) * 0.45;
  else if (zone === 'legR' || zone === 'legL') e.fl.dip = 0.14;
  // zu Boden gehen: wuchtige stumpfe Treffer, Hammer, harter Schildstoß
  if (!e.kneel && !e.down && e.hp > 0 && e.state === 'fight' && (info.knockdown || (info.type === 'blunt' && dmg >= 38 && Math.random() < 0.6))) {
    e.down = { t: 0, T: rand(2.3, 3.1) }; release(e); N.unshift('Zu Boden!');
    e.act = null; e.queue.length = 0; e.taunt = null; e.kick = null;
  }
  // Angriff unterbrechen, taumeln, Rückstoß
  if (e.act) { const armored = e.wdef.heavy && e.act.locked; if (!armored && (dmg >= 8 || !e.act.locked)) { e.act = null; e.queue.length = 0; } }
  if (dmg >= 5) {
    e.stagger = Math.max(e.stagger, Math.min(1.3, zone === 'head' ? 0.55 + dmg / 60 : 0.22 + dmg / 80));
    e.staggerDir = t1.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).dot(dir) > 0.2 ? -1 : 1; // von hinten getroffen: nach vorne taumeln
    e.parry = null; e.react = null; e.bash = null; e.taunt = null; e.kick = null;
  }
  if (info.knock) { const k = 0.08 * info.knock; tryMove(e, dir.x * k, dir.z * k, true); }
  if (e.hp <= 0) { kill(e, dir); res.killed = true; }
  else {
    SFX3D.hurt(chestWorld(e, t2), 'runner');
    // Moral: wer schwer angeschlagen oder wehrlos ist, flieht vielleicht
    if (!e.passive && e.state === 'fight' && !e.kneel && (e.hp < e.maxHp * 0.3 || (e.crip.armR && e.crip.armL)) && Math.random() < (e.crip.armR && e.crip.armL ? 1 : e.T.flee)) startFlee(e);
  }
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
// Treffer auf den Schild eines Gegners: Äxte und Hämmer zerschlagen ihn. Liefert true, wenn er zerbricht.
export function hitShield(e, dmg, point) {
  if (!e.shield) return false;
  e.shieldHp -= dmg; e.shieldShake = 0.28;
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
function kill(e, dir) {
  if (e.state === 'dead') return;
  release(e);
  const fwd = t1.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
  e.state = 'dead'; e.t = 0; e.act = null; e.parry = null; e.shot = null;
  e.fall = dir && fwd.dot(dir) > 0.2 ? 1 : -1; // von hinten getroffen: fällt nach vorne
  e.fallRoll = rand(-0.7, 0.7);
  if (e.downK > 0.6) { e.fall = -1; e.t = 0.95; e.fallRoll = 0; } // lag schon am Boden: bleibt liegen
  e.downK = 0; e.down = null;
  dropItem(e, e.weapon, dir, e.weaponId); e.weapon = null;
  dropItem(e, e.shield, dir, 'shield'); e.shield = null;
  SFX3D.death(chestWorld(e, t2), 'runner');
  player.defeated(e, 'dead');
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
  const want = e.token || rush ? e.wdef.range : 2.25 + e.slot * 0.8;
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
    if (n > 1 && e !== front && !e.behind && !e.kneel) push += Math.sign(wrap(back - e.ang) || 1) * 0.7 * e.T.smart;
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
    if (d > o.wdef.range + 0.6 || Math.abs(player.floor - o.y) > 0.45 || Math.random() > o.T.smart * opts.react) continue;
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
    if (Math.random() > e.T.arrowDodge * opts.react) continue;
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
  const weighted = () => {
    // Gewicht je Hieb: gedeckte Bahnen meiden (je klüger, desto konsequenter), Wiederholungen meiden
    const smart = Math.min(1, e.T.smart * opts.react);
    const wt = names.map(n => w.moves[n] * (n === e.lastAtk ? 0.4 : 1) * (covered(e, n) ? 1 - 0.9 * smart : 1));
    let r = Math.random() * wt.reduce((a, b) => a + b, 0);
    for (let k = 0; k < names.length; k++) { r -= wt[k]; if (r <= 0) return names[k]; }
    return names[0];
  };
  let seq;
  if (!e.kneel && w.combos.length && Math.random() < 0.34 * e.T.aggro) {
    // Kombo: Kluge beginnen mit einem Hieb, den der Spieler gerade nicht deckt
    const open = w.combos.filter(c => !covered(e, c[0]));
    seq = pick(open.length && Math.random() < e.T.smart ? open : w.combos).slice();
  } else seq = [weighted()];
  let feint = null;
  if (seq.length === 1 && !ATK[seq[0]].thrust && Math.random() < e.T.feint * opts.react) {
    // Finte: zu einem Hieb ausholen, den der Spieler deckt bzw. decken wird – und dann in die Blöße schlagen
    const others = names.filter(n => n !== seq[0] && !ATK[n].thrust && ATK[n].target !== ATK[seq[0]].target);
    if (others.length) feint = pick(others);
  }
  return { seq, feint };
}
const keyOf = (e, t, pose) => ({ t, hp: toLocalPos(e, pose.hp, V()), bd: toLocalDir(e, pose.bd, V()) });
function startAttack(e, name, feint = null, quick = false) {
  const A = ATK[name], w = e.wdef;
  const slow = e.atkSlow * (e.daze > 0 ? 1.3 : 1) / opts.speed;
  let tw = w.tw * slow * (quick ? 0.62 : 1) * rand(0.93, 1.1);
  const act = { name, A, t: 0, tw, ts: w.ts * slow, tf: 0.2, tr: 0.3, keys: [{ t: 0, hp: e.wp.hp.clone(), bd: e.wp.bd.clone() }], locked: false, done: false, missed: false, feint };
  if (feint) { // Finte: erst zu einem anderen Hieb ausholen, dann blitzschnell umsetzen
    const tF = tw * 0.6;
    act.keys.push(keyOf(e, tF, ATK[feint].wind));
    tw = act.tw = tF + 0.27 * slow;
  }
  act.keys.push(keyOf(e, tw, A.wind));
  act.end = tw + 10;
  e.act = act; e.lastAtk = name; e.parry = null;
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
    if (t > act.live1) { act.done = true; act.missed = true; return; }
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
      const dmg = w.dmg * e.atkDmg * opts.dmg * (zone === 'head' ? 1.5 : zone === 'legs' ? 0.8 : 1) * (act.weak || 1);
      player.hit({ dmg, zone, e, type: w.type, name: act.A.name, point: _hit.clone(), from: chestWorld(e, V()) });
      return;
    }
  }
}
// Schlag wurde abgefangen. Liefert true, wenn der Angriff damit beendet ist.
function resolveBlock(e, act, how, obj, point) {
  const heavy = !!e.wdef.heavy;
  teamOpening(e); // der Spieler ist gebunden: die anderen schlagen zu
  if (how === 'parry') {
    const active = obj.speed > 1.1 || obj.twoHand; // Klinge dem Schlag entgegengeführt (oder beidhändig gehalten)
    if (heavy && !active) { // schwere Waffe schlägt durch eine nur hingehaltene Klinge (mit weniger Wucht)
      if (!act.weak) { act.weak = 0.45; player.blocked({ how: 'weak', point: point.clone(), e, w: obj.w }); }
      return false;
    }
    act.done = true;
    player.blocked({ how: active ? 'parry' : 'block', point: point.clone(), e, w: obj.w });
    startRecoil(e, act, active ? 0.95 : 0.45);
  } else {
    act.done = true;
    player.blocked({ how: 'shield', point: point.clone(), e, w: obj.w, heavy });
    startRecoil(e, act, heavy ? 0.42 : 0.6);
  }
  return true;
}
// Waffe prallt ab: Gegner ist kurz offen (Zeit für einen Gegenangriff)
function startRecoil(e, act, T) {
  const wind = act.keys.find(k => Math.abs(k.t - act.tw) < 1e-6) || act.keys[1];
  e.recoil = { t: 0, T, back: { hp: V().lerpVectors(e.wp.hp, wind.hp, 0.55), bd: slerpDir(e.wp.bd, wind.bd, 0.5, V()) } };
  e.act = null; e.queue.length = 0;
  e.cool = Math.max(e.cool, rand(0.25, 0.7));
}
function finishAttack(e) {
  const act = e.act;
  e.act = null;
  if (e.queue.length && !act.missed) { startAttack(e, e.queue.shift(), null, true); return; }
  e.queue.length = 0;
  e.cool = rand(0.7, 1.5) / e.T.aggro * (e.daze > 0 ? 1.5 : 1) * (e.hurt.torso ? 1.3 : 1) + (act.missed ? 0.35 : 0);
  // andere drankommen lassen
  if (enemies.some(o => o !== e && o.state === 'fight' && !o.token && !o.passive)) { release(e); e.tokenBan = rand(0.8, 1.8); }
}
function updateAttack(e, dt, d, dx, dz) {
  const act = e.act, t0 = act.t;
  act.t += dt;
  if (!act.locked) {
    turnTo(e, player.head.x, player.head.z, dt, 3.5);
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
      else player.hit({ dmg: 7 * opts.dmg, zone: 'body', e, type: 'blunt', name: 'Schildstoß', point: _hit.clone(), from: _sc.clone(), bash: true });
    }
  }
  if (b.t > 0.8) { e.bash = null; e.cool = rand(0.5, 1.1); }
}

// ---- Reaktionen auf Angriffe des Spielers: Schild führen, parieren, ausweichen -------------------
function reactions(e, dt) {
  if (e.parry) { e.parry.t += dt; if (e.parry.t > e.parry.T) e.parry = null; }
  if (e.shieldHold > 0) { e.shieldHold -= dt; if (e.shieldHold <= 0) e.shieldZone = 'mid'; }
  if (e.react) {
    e.react.delay -= dt;
    if (e.react.delay <= 0) {
      const r = e.react; e.react = null;
      if (r.kind === 'shield') { e.shieldZone = r.zone; e.shieldHold = 0.9; }
      else if (r.kind === 'parry') e.parry = { zone: r.zone, t: 0, T: 0.6 };
      else if (r.kind === 'dodge') e.dodge = r.side ? { t: 0.24, dx: Math.cos(e.yaw) * r.side, dz: -Math.sin(e.yaw) * r.side, v: 2.6 } : { t: 0.26 };
    }
  }
  // Bedrohung: eine schnelle Klinge nähert sich
  let threat = null;
  const chest = chestWorld(e, t1);
  for (const b of player.blades) {
    if (b.speed < 1.4 || b.b.distanceTo(chest) > 1.25) continue;
    if (b.vel.dot(t2.subVectors(chest, b.b)) <= 0) continue;
    threat = b; break;
  }
  if (!threat) {
    e.threatT += dt;
    if (e.threatT > 0.25 && e.threatOn) {
      e.threatOn = false;
      // der Hieb des Spielers ging ins Leere: sofort kontern
      if (clock - e.lastHitT > 0.6 && e.token && Math.random() < e.T.smart * opts.react) e.cool = Math.min(e.cool, 0.1);
      else if (clock - e.lastHitT > 0.6) teamOpening(null);
    }
    return;
  }
  e.threatT = 0;
  if (e.threatOn) return;
  e.threatOn = true; // je Schwung eine Entscheidung
  const L = e.body.worldToLocal(t3.copy(threat.b));
  if (L.z < -0.1) return; // von hinten: keine Chance
  const skill = opts.react * (e.daze > 0 ? 0.25 : 1), r = -L.x * e.handed;
  const delay = e.T.react * rand(0.8, 1.3) / opts.react * (e.daze > 0 ? 1.6 : 1);
  if (e.shield && armOk(e, 1 - wArm(e))) {
    if (Math.random() < e.T.guard * skill * (e.hurt[zoneOfArm(1 - wArm(e))] ? 0.6 : 1)) e.react = { kind: 'shield', zone: L.y > 1.42 - e.drop ? 'high' : L.y < 0.88 - e.drop ? 'low' : 'mid', delay };
  } else if (e.weapon && e.weaponId !== 'bow' && armOk(e, wArm(e)) && Math.random() < e.T.parry * skill * (e.hurt[zoneOfArm(wArm(e))] ? 0.5 : 1)) {
    e.react = { kind: 'parry', zone: L.y > 1.5 - e.drop ? 'high' : L.y < 0.85 - e.drop ? 'low' : r > 0 ? 'right' : 'left', delay };
  } else if (!e.kneel && Math.random() < e.T.dodge * skill) e.react = { kind: 'dodge', delay: 0.05, side: Math.random() < 0.45 ? (r > 0 ? -1 : 1) * e.handed : 0 };
}
// Waffe und Schild in die Grundstellung (oder Parade) führen
function guardPose(e, dt, low = 0) {
  const w = e.wdef;
  let rate = 9;
  if (e.parry) { toLocalPos(e, PARRY[e.parry.zone].hp, t1); toLocalDir(e, PARRY[e.parry.zone].bd, t2); rate = 22; }
  else if (e.taunt) { // Drohgebärde: Waffe hochreißen und brüllen bzw. auf den Schild schlagen
    const k = e.taunt.t / e.taunt.T;
    if (e.taunt.kind === 'bang' && e.shield) { t1.copy(e.sp.c).addScaledVector(e.sp.n, 0.12 + 0.1 * Math.abs(Math.cos(k * Math.PI * 3))); t1.y += 0.12; t2.set(-0.5 * e.handed, 0.6, 0.6).normalize(); rate = 18; }
    else { toLocalPos(e, [0.36, 1.86, 0.05], t1); t1.y += Math.sin(k * 30) * 0.02; toLocalDir(e, [0.25, 0.94, 0.2], t2); rate = 10; }
  } else {
    const G = e.stance && e.fighting && !low && (e.weaponId === 'sword' || e.weaponId === 'mace') ? STANCES[e.stance] : w.guard;
    toLocalPos(e, G.hp, t1); toLocalDir(e, G.bd, t2);
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
  const z = e.down ? 'down' : e.stagger > 0.25 || e.daze > 1.5 ? 'down' : e.act && e.act.locked ? 'open' : e.fighting ? e.shieldZone : 'open';
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
      if (Math.random() < e.T.smart * opts.react) for (const o of spots) { off = o; t4.copy(player.head).setY(player.head.y + o); if (!player.shields.some(sh => segDisc(from, t4, sh.c, sh.n, sh.r + 0.04, 0.1, _hit))) break; }
      aim.y += off; aim.addScaledVector(player.vel, tt * 0.6); aim.y += 0.5 * 9.81 * 0.5 * tt * tt;
      const dir = aim.sub(from).normalize();
      const err = 0.035 / opts.react * (e.hurt.armR || e.hurt.armL ? 2 : 1);
      dir.x += rand(-err, err); dir.y += rand(-err, err); dir.z += rand(-err, err); dir.normalize();
      const obj = makeArrowMesh(2);
      obj.position.copy(from);
      scene.add(obj);
      shots.push({ obj, vel: dir.clone().multiplyScalar(v), life: 5, stuck: false, e });
      SFX3D.swing(from);
      a.phase = 'idle'; a.t = 0;
      e.cool = rand(2.2, 3.6) / e.T.aggro;
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
      player.hit({ dmg: EW.bow.dmg * opts.dmg * (zone === 'head' ? 1.5 : zone === 'legs' ? 0.8 : 1), zone, e: s.e, type: 'thrust', name: 'Pfeil', point: _hit.clone(), from: s.obj.position.clone(), arrow: true });
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
  if (e.down) { // am Boden: fällt, liegt (wehrlos), rappelt sich wieder auf
    const D = e.down;
    D.t += dt;
    const k = D.t < 0.45 ? D.t / 0.45 : D.t < D.T - 0.9 ? 1 : Math.max(0, (D.T - D.t) / 0.9);
    e.downK = k * k * (3 - 2 * k);
    if (e.stagger > 0) e.stagger -= dt;
    guardPose(e, dt, 1);
    if (D.t >= D.T) { e.down = null; e.downK = 0; e.cool = rand(0.4, 0.9); }
    return;
  }
  if (e.stagger > 0) { // getroffen: taumelt, Deckung offen
    e.stagger -= dt;
    e.lean = -0.3 * Math.min(1, e.stagger * 3) * e.staggerDir;
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
  if (!e.retreated && allies > 0 && e.hp < e.maxHp * 0.4 && e.T.smart > 0.5 && !e.kneel) { e.retreated = true; release(e); e.tokenBan = rand(4, 6.5); e.slot = 1.2; note(e, 'zieht sich zurück', '#9ad'); }
  // Rolle: Angreifer (hat eine „Marke“) oder Wartender, der den Spieler umkreist.
  // Wer dem Spieler im Rücken steht, bekommt den Vortritt.
  e.tokenBan -= dt;
  const bs = tac.backstabber;
  if (!e.token && canAttack && e.tokenBan <= 0 && sameLevel && d < 3.8 && tokens.size < opts.tokens && (!bs || bs === e || bs.token || bs.tokenBan > 0)) { tokens.add(e); e.token = true; e.taunt = null; }
  if (e.token && (d > 4.8 || !sameLevel || !canAttack)) release(e);
  // Wird auf mich gezielt? Schildträger entscheiden einmal je Zielvorgang, ob sie den Schild richtig halten
  const aimed = aimedAt(e);
  if (!aimed) e.aimRoll = -1;
  else if (e.aimRoll < 0) e.aimRoll = e.shield && armOk(e, 1 - wArm(e)) && Math.random() < Math.min(0.97, (e.T.guard + 0.1) * opts.react) ? 1 : 0;
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
  // Wartende drohen: brüllen mit erhobener Waffe oder schlagen auf den Schild
  if (e.taunt) { e.taunt.t += dt; if (e.taunt.kind === 'bang' && Math.floor(e.taunt.t / e.taunt.T * 3) !== e.taunt.n) { e.taunt.n = Math.floor(e.taunt.t / e.taunt.T * 3); SFX.thud(0.25); SFX.click(700, 0.2, 0.04); } if (e.taunt.t >= e.taunt.T) e.taunt = null; }
  else if (!e.token && e.fighting && !e.kneel && !aimed) {
    e.tauntT -= dt;
    if (e.tauntT <= 0) { e.tauntT = rand(6, 13); e.taunt = { t: 0, T: e.shield ? 1.2 : 1.5, kind: e.shield ? 'bang' : 'roar', n: -1 }; if (!e.shield) SFX3D.scream(chestWorld(e, t1)); }
  }
  // Grundstellung wechseln (Pflug, Ochs, Alber, vom Tag)
  e.stanceT -= dt;
  if (e.stanceT <= 0) { e.stanceT = rand(2.2, 5); e.stance = e.T.smart > 0.4 && Math.random() < 0.7 ? Math.floor(Math.random() * STANCES.length) : 0; }
  // Angriff beginnen
  e.cool -= dt;
  if (e.token && e.cool <= 0 && !e.parry && !e.react && sameLevel && d < e.wdef.range + 0.3) {
    const facing = Math.sin(e.yaw) * dx + Math.cos(e.yaw) * dz;
    if (facing > 0.92) {
      // Der Spieler verschanzt sich hinter dem Schild: wegtreten (dann schlagen die anderen zu) oder mit dem Schild rammen
      const turtled = clock >= player.shieldStun && player.shields.some(sh => segDisc(chestWorld(e, t1), t2.copy(player.head).setY(player.head.y - 0.34), sh.c, sh.n, sh.r, 0.12, _hit));
      if (turtled && d < 1.35 && !e.kneel && Math.random() < 0.35 * e.T.smart + 0.08) e.kick = { t: 0, done: false };
      else if (e.shield && d < 1.15 && Math.random() < 0.22) e.bash = { t: 0, done: false };
      else { const c = chooseAttack(e); e.queue = c.seq.slice(1); startAttack(e, c.seq[0], c.feint); }
    }
  }
  guardPose(e, dt);
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
      if (segPoint(_top, _bot, foot, _hit) < 0.36) player.hit({ dmg: 6 * opts.dmg, zone: 'body', e, type: 'blunt', name: 'Tritt', point: _hit.clone(), from: chestWorld(e, V()) });
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
  F.hx *= dec; F.hy *= dec; F.lean *= dec; F.tw *= dec; F.dip *= dec;
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
  e.torso.rotation.set(e.leanCur + F.lean, e.twistCur + F.tw, wob + sag * 1.2 * (e.limpSide || 0) + Math.sin(e.phase) * 0.03 * a);
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
  else limpArm(e, oa, -sw);
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
  updateShots(dt);
  tactics(dt);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.t += dt;
    e.moved = 0;
    if (e.state === 'dead') { deadUpdate(e, dt); continue; }
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
      shieldPose(e, dt);
      const g = groundAt(e.pos.x, e.pos.z);
      if (Math.abs(g - e.y) <= STEP) e.y = lerp(e.y, g, Math.min(1, dt * 10));
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
        if (k >= 1) { player.defeated(e, 'fled'); removeEnemy(e); continue; }
      } else if (walkTo(e, e.exitOut, dt, false, 1.35)) { player.defeated(e, 'fled'); removeEnemy(e); continue; }
      guardPose(e, dt, 1);
    }
    // Abstand zu anderen Gegnern und zum Spieler
    if (e.state === 'fight' && !e.passive) {
      for (const o of enemies) {
        if (o === e || o.state === 'dead' || Math.abs(o.y - e.y) > 0.5) continue;
        const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z, od = Math.hypot(ox, oz);
        if (od > 0.001 && od < 0.6) { const p = (0.6 - od) * 0.5 * Math.min(1, dt * 10); tryMove(e, ox / od * p, oz / od * p, true); }
      }
      const px = e.pos.x - player.head.x, pz = e.pos.z - player.head.z, pd = Math.hypot(px, pz);
      if (pd > 0.001 && pd < 0.55 && Math.abs(player.floor - e.y) < 0.5) tryMove(e, px / pd * (0.55 - pd), pz / pd * (0.55 - pd), true);
    }
    if (e.state === 'climbIn' || e.state === 'climbUp' || (e.state === 'exit' && e.opening.type === 'window')) {
      const k = e.state === 'climbUp' ? Math.min(1, e.climb ? e.climb.t / e.climb.T : 1) : Math.min(1, e.t / 1.6);
      pose(e, dt); climbPose(e, k);
    } else pose(e, dt);
    // Schritte hörbar
    const stepPh = Math.floor(e.phase / Math.PI);
    if (stepPh !== e.stepPh) { e.stepPh = stepPh; if (e.gait > 0.5) SFX3D.step(t1.copy(e.pos).setY(e.y), e.type === 'knight' ? 1.3 : 0.7); }
    place(e);
  }
}
// Sterben: Knie geben nach, Körper kippt um und bleibt liegen, verschwindet nach einer Weile
function deadUpdate(e, dt) {
  const t = e.t;
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
