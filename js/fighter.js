import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// =============================================================================
// Kämpfer: menschliche Gegner aus einfachen Formen (je Knochen EIN zusammengefasstes Netz mit
// Vertex-Farben → wenige Zeichenaufrufe), dazu alle Daten: Gegner-Typen, Rüstungen, Waffen, Angriffe.
// Blickrichtung +Z. Rechte Körperseite = -X (Index 0), linke = +X (Index 1).
// =============================================================================
export const HIP = 0.92, SH_X = 0.2, SH_Y = 0.5, L1 = 0.3, L2 = 0.31, THIGH = 0.46, SHIN = 0.42, REACH = 0.6;

// ---- Rüstung: Faktor auf den Schaden je Art (Hieb, Stich, stumpf) ------------------------
export const ARMOR = {
  none: { slash: 1, thrust: 1, blunt: 0.9, name: '' },
  cloth: { slash: 0.9, thrust: 0.95, blunt: 0.9, name: 'Stoff' },
  leather: { slash: 0.65, thrust: 0.85, blunt: 0.8, name: 'Leder' },
  gambeson: { slash: 0.5, thrust: 0.8, blunt: 0.7, name: 'Gambeson' },   // gepolstert: schluckt Hiebe und Schläge, Stiche gehen durch
  mail: { slash: 0.2, thrust: 0.6, blunt: 0.9, name: 'Kettenhemd' },        // Hiebe gleiten ab, Stiche und stumpfe Schläge wirken
  plate: { slash: 0.08, thrust: 0.3, blunt: 0.75, name: 'Plattenrüstung' }, // nur stumpfe Wucht (oder Lücken) hilft
  helmCap: { slash: 0.65, thrust: 0.85, blunt: 0.8, name: 'Lederkappe' },
  helmIron: { slash: 0.2, thrust: 0.45, blunt: 0.7, name: 'Eisenhelm' },
  helmGreat: { slash: 0.08, thrust: 0.22, blunt: 0.6, name: 'Topfhelm' }
};
const HELM_ARMOR = { none: 'none', hood: 'cloth', cap: 'helmCap', nasal: 'helmIron', kettle: 'helmIron', great: 'helmGreat' };

// ---- Gegner-Typen ---------------------------------------------------------------------------
// parry/guard/dodge: Wahrscheinlichkeit zu parieren / den Schild richtig zu führen / auszuweichen
// feint: Anteil Finten · aggro: Angriffslust · flee: Fluchtneigung, wenn es schlecht steht
export const ENEMY_TYPES = {
  bandit: { name: 'Räuber', hp: 70, smart: 0.3, arrowDodge: 0.35, speed: 0.95, weapons: ['dagger', 'club'], armor: { torso: 'cloth', arms: 'none', legs: 'cloth' }, helmets: ['hood', 'none', 'hood'],
    parry: 0.1, guard: 0, dodge: 0.35, feint: 0, aggro: 1.25, flee: 0.6, react: 0.3, tunic: [0x5a4a36, 0x4a5236, 0x5a3a2e, 0x3e3a34] },
  soldier: { name: 'Söldner', hp: 95, smart: 0.7, arrowDodge: 0.3, speed: 0.82, weapons: ['sword', 'sword', 'mace'], armor: { torso: 'gambeson', arms: 'gambeson', legs: 'cloth' }, helmets: ['cap', 'nasal', 'none'],
    parry: 0.45, guard: 0, dodge: 0.1, feint: 0.2, aggro: 1, flee: 0.15, react: 0.22, tunic: [0x7a2a22, 0x2a3f6a, 0x3f5a2a] },
  shield: { name: 'Schildträger', hp: 100, smart: 0.75, arrowDodge: 0, speed: 0.75, weapons: ['sword'], shield: 'round', armor: { torso: 'mail', arms: 'gambeson', legs: 'cloth' }, helmets: ['nasal'],
    parry: 0.08, guard: 0.75, dodge: 0, feint: 0.1, aggro: 0.9, flee: 0.1, react: 0.2, tunic: [0x7a2a22, 0x2a3f6a, 0x6a5a1a] },
  spear: { name: 'Speerträger', hp: 85, smart: 0.6, arrowDodge: 0.25, speed: 0.8, weapons: ['spear'], armor: { torso: 'gambeson', arms: 'gambeson', legs: 'cloth' }, helmets: ['kettle'],
    parry: 0.25, guard: 0, dodge: 0.2, feint: 0.15, aggro: 0.95, flee: 0.2, react: 0.24, tunic: [0x3f5a2a, 0x2a3f6a] },
  axe: { name: 'Axtkämpfer', hp: 120, smart: 0.3, arrowDodge: 0.1, speed: 0.76, weapons: ['axe'], armor: { torso: 'leather', arms: 'none', legs: 'cloth' }, helmets: ['none'], beard: true,
    parry: 0.08, guard: 0, dodge: 0.05, feint: 0, aggro: 1.1, flee: 0, react: 0.3, tunic: [0x4a3020] },
  archer: { name: 'Bogenschütze', hp: 60, smart: 0.6, arrowDodge: 0.4, speed: 0.9, weapons: ['bow'], armor: { torso: 'cloth', arms: 'cloth', legs: 'cloth' }, helmets: ['hood'],
    parry: 0.05, guard: 0, dodge: 0.3, feint: 0, aggro: 1, flee: 0.5, react: 0.3, tunic: [0x35502a, 0x4a4a2a] },
  knight: { name: 'Ritter', hp: 130, smart: 0.9, arrowDodge: 0, speed: 0.62, weapons: ['sword', 'mace'], shield: 'heater', armor: { torso: 'plate', arms: 'plate', legs: 'mail' }, helmets: ['great'],
    parry: 0.3, guard: 0.9, dodge: 0, feint: 0.25, aggro: 0.9, flee: 0, react: 0.17, tunic: [0x8a1a1a, 0x1a2a7a, 0xd8d0b8] },
  halberd: { name: 'Hellebardier', hp: 105, smart: 0.7, arrowDodge: 0.15, speed: 0.74, weapons: ['halberd'], armor: { torso: 'mail', arms: 'gambeson', legs: 'cloth' }, helmets: ['kettle'],
    parry: 0.3, guard: 0, dodge: 0.1, feint: 0.1, aggro: 0.95, flee: 0.1, react: 0.24, tunic: [0x6a5a1a, 0x7a2a22] }
};
export const TYPE_ORDER = ['bandit', 'soldier', 'shield', 'spear', 'halberd', 'axe', 'archer', 'knight'];

// ---- Angriffe im „Angriffsraum“: r = zur Waffenseite, u = hoch, f = nach vorne (zum Ziel) ----
// wind = Ausholen (Hand + Klingenrichtung) · via = Klingenrichtung auf halbem Weg (für den Bogen)
// imp = Klingenrichtung beim Auftreffen · target = worauf gezielt wird · follow = Durchschwung
export const ATK = {
  oberhau: { name: 'Oberhau', wind: { hp: [0.2, 1.8, -0.04], bd: [0.08, 0.72, -0.69] }, via: [0.03, 0.85, 0.52], imp: [0, -0.4, 0.92], target: 'head',
    follow: { d: [-0.04, -0.5, 0.02], bd: [0, -0.82, 0.57] }, lean: 0.3, twist: 0.15 },
  rechts: { name: 'Hieb von rechts', wind: { hp: [0.5, 1.4, -0.06], bd: [0.74, 0.46, -0.49] }, via: [0.72, 0.1, 0.68], imp: [-0.22, 0, 0.975], target: 'side',
    follow: { d: [-0.5, -0.1, -0.1], bd: [-0.88, -0.05, 0.47] }, lean: 0.12, twist: 0.5 },
  links: { name: 'Hieb von links', wind: { hp: [-0.3, 1.45, 0.08], bd: [-0.78, 0.48, -0.4] }, via: [-0.72, 0.1, 0.68], imp: [0.22, 0, 0.975], target: 'side',
    follow: { d: [0.55, -0.1, -0.1], bd: [0.88, -0.05, 0.47] }, lean: 0.12, twist: -0.5 },
  unten: { name: 'Tiefer Hieb', wind: { hp: [0.5, 1.15, -0.08], bd: [0.8, 0.3, -0.52] }, via: [0.75, -0.2, 0.63], imp: [-0.2, -0.38, 0.9], target: 'legs',
    follow: { d: [-0.45, -0.1, -0.1], bd: [-0.85, -0.3, 0.43] }, lean: 0.38, twist: 0.4 },
  zornR: { name: 'Zornhau', wind: { hp: [0.36, 1.72, -0.05], bd: [0.45, 0.7, -0.55] }, via: [0.42, 0.62, 0.66], imp: [-0.3, -0.3, 0.905], target: 'side',
    follow: { d: [-0.4, -0.42, -0.02], bd: [-0.7, -0.52, 0.49] }, lean: 0.26, twist: 0.45 },
  zornL: { name: 'Zornhau von links', wind: { hp: [-0.26, 1.72, 0.05], bd: [-0.5, 0.7, -0.5] }, via: [-0.42, 0.62, 0.66], imp: [0.3, -0.3, 0.905], target: 'side',
    follow: { d: [0.45, -0.42, -0.02], bd: [0.7, -0.52, 0.49] }, lean: 0.26, twist: -0.45 },
  unterhau: { name: 'Unterhau', wind: { hp: [0.42, 0.78, -0.1], bd: [0.5, -0.72, -0.48] }, via: [0.62, -0.5, 0.6], imp: [-0.2, 0.36, 0.91], target: 'side',
    follow: { d: [-0.3, 0.42, -0.02], bd: [-0.5, 0.72, 0.48] }, lean: 0.18, twist: 0.4 },
  kopf: { name: 'Zwerchhau zum Kopf', wind: { hp: [0.46, 1.7, -0.05], bd: [0.8, 0.32, -0.5] }, via: [0.75, 0.12, 0.65], imp: [-0.25, 0, 0.968], target: 'face',
    follow: { d: [-0.5, -0.05, -0.1], bd: [-0.9, 0, 0.44] }, lean: 0.1, twist: 0.5 },
  stich: { name: 'Stich', wind: { hp: [0.3, 1.22, -0.2], bd: [0, 0.04, 1] }, imp: [0, 0, 1], target: 'chest', thrust: true,
    follow: { d: [0, 0, 0.04], bd: [0, 0, 1] }, lean: 0.24, twist: 0.3 },
  stichHoch: { name: 'Stich zum Kopf', wind: { hp: [0.3, 1.5, -0.22], bd: [0, -0.02, 1] }, imp: [0, 0, 1], target: 'face', thrust: true,
    follow: { d: [0, 0, 0.04], bd: [0, 0, 1] }, lean: 0.2, twist: 0.3 },
  stichTief: { name: 'Stich zum Bein', wind: { hp: [0.3, 1.05, -0.22], bd: [0, -0.2, 0.98] }, imp: [0, 0, 1], target: 'legs', thrust: true,
    follow: { d: [0, 0, 0.04], bd: [0, 0, 1] }, lean: 0.34, twist: 0.3 }
};

// ---- Waffen der Gegner (entlang +Y, Griff im Ursprung) --------------------------------------
// haft = Bereich, der pariert werden kann · edge = Bereich, der verletzt · r = Radius der Trefferfläche
// range = bevorzugter Abstand zum Spieler · tw/ts = Ausholen/Schlag in Sekunden · moves = Gewichte
export const EW = {
  sword: { name: 'Schwert', len: 0.88, haft: [0.04, 0.88], edge: [0.24, 0.88], r: 0.02, range: 1.22, dmg: 16, type: 'slash', tw: 0.62, ts: 0.2, lunge: 0.22,
    guard: { hp: [0.24, 1.12, 0.3], bd: [-0.18, 0.82, 0.54] },
    moves: { oberhau: 3, rechts: 2.5, links: 2, unten: 1.5, stich: 2, zornR: 2.5, zornL: 1.5, unterhau: 1.5, kopf: 1.5 },
    combos: [['rechts', 'links'], ['oberhau', 'stich'], ['links', 'oberhau'], ['stich', 'rechts'], ['zornR', 'unterhau'], ['kopf', 'unten'], ['zornL', 'zornR', 'stich']] },
  dagger: { name: 'Dolch', len: 0.28, haft: [0.03, 0.28], edge: [0.07, 0.28], r: 0.02, range: 0.8, dmg: 9, type: 'slash', tw: 0.36, ts: 0.14, lunge: 0.28,
    guard: { hp: [0.24, 1.15, 0.32], bd: [0, 0.45, 0.89] },
    moves: { stich: 4, rechts: 2, links: 2, stichHoch: 1 }, combos: [['stich', 'stich'], ['rechts', 'links', 'stich'], ['links', 'stich']] },
  club: { name: 'Keule', len: 0.7, haft: [0.05, 0.7], edge: [0.36, 0.7], r: 0.05, range: 1.1, dmg: 14, type: 'blunt', tw: 0.7, ts: 0.2, lunge: 0.22,
    guard: { hp: [0.26, 1.1, 0.28], bd: [-0.1, 0.9, 0.42] },
    moves: { oberhau: 4, rechts: 3, links: 1.5 }, combos: [['rechts', 'oberhau'], ['oberhau', 'oberhau']] },
  axe: { name: 'Streitaxt', len: 1.0, haft: [-0.3, 1.0], edge: [0.78, 1.0], r: 0.09, range: 1.42, dmg: 26, type: 'slash', tw: 0.95, ts: 0.24, lunge: 0.3, heavy: true, twoH: 0.42,
    guard: { hp: [0.2, 1.02, 0.2], bd: [-0.4, 0.88, 0.25] },
    moves: { oberhau: 4, rechts: 3, links: 2, zornR: 3, zornL: 2 }, combos: [['rechts', 'links'], ['zornR', 'zornL']] },
  mace: { name: 'Streitkolben', len: 0.62, haft: [0.05, 0.62], edge: [0.44, 0.62], r: 0.055, range: 1.08, dmg: 17, type: 'blunt', tw: 0.6, ts: 0.2, lunge: 0.24,
    guard: { hp: [0.26, 1.12, 0.28], bd: [-0.1, 0.9, 0.42] },
    moves: { oberhau: 4, rechts: 3, links: 2, zornR: 3, kopf: 1.5 }, combos: [['rechts', 'oberhau'], ['zornR', 'links'], ['oberhau', 'oberhau']] },
  halberd: { name: 'Hellebarde', len: 1.78, haft: [-0.5, 1.78], edge: [1.42, 1.78], r: 0.07, range: 2.08, dmg: 23, type: 'slash', tw: 0.86, ts: 0.24, lunge: 0.3, heavy: true, twoH: 0.6,
    guard: { hp: [0.28, 1.05, -0.2], bd: [-0.05, 0.42, 0.9] },
    moves: { stich: 3.5, oberhau: 3, stichTief: 1.5, rechts: 1.5, stichHoch: 1.5 }, combos: [['stich', 'oberhau'], ['stichTief', 'stichHoch']] },
  spear: { name: 'Speer', len: 1.56, haft: [-0.6, 1.56], edge: [1.3, 1.56], r: 0.025, range: 1.95, dmg: 17, type: 'thrust', tw: 0.6, ts: 0.2, lunge: 0.3, twoH: 0.55,
    guard: { hp: [0.28, 1.08, -0.15], bd: [-0.03, 0.1, 0.99] },
    moves: { stich: 4, stichHoch: 2, stichTief: 2 }, combos: [['stich', 'stichHoch'], ['stichTief', 'stich']] },
  bow: { name: 'Bogen', len: 0.5, haft: [0, 0], edge: [0, 0], r: 0, range: 5, dmg: 20, type: 'thrust', tw: 1, ts: 0.1, lunge: 0, guard: { hp: [0.2, 1.0, 0.2], bd: [0, 1, 0] }, moves: {}, combos: [] },
  fist: { name: 'Faust', len: 0.08, haft: [0, 0.08], edge: [0, 0.08], r: 0.05, range: 0.72, dmg: 5, type: 'blunt', tw: 0.32, ts: 0.13, lunge: 0.25,
    guard: { hp: [0.2, 1.25, 0.3], bd: [0, 0.3, 0.95] }, moves: { stich: 3, stichHoch: 2 }, combos: [['stich', 'stichHoch']] }
};
// Grundstellungen („Huten“), zwischen denen geübte Kämpfer wechseln: Pflug, Ochs, Alber, vom Tag
export const STANCES = [
  { hp: [0.24, 1.12, 0.3], bd: [-0.18, 0.82, 0.54] },
  { hp: [0.3, 1.62, 0.12], bd: [-0.25, -0.12, 0.96] },
  { hp: [0.22, 0.95, 0.32], bd: [-0.1, -0.45, 0.89] },
  { hp: [0.3, 1.5, 0.02], bd: [0.1, 0.92, -0.35] }
];
// Parade-Stellungen (Hand, Klingenrichtung) je Zone, aus der der Hieb des Spielers kommt
export const PARRY = {
  high: { hp: [0.3, 1.64, 0.32], bd: [-0.97, 0.2, 0.08] },
  right: { hp: [0.4, 1.0, 0.36], bd: [0.05, 0.99, 0.1] },
  left: { hp: [-0.14, 1.0, 0.4], bd: [-0.1, 0.99, 0.06] },
  low: { hp: [0.26, 1.08, 0.38], bd: [-0.45, -0.87, 0.18] }
};
// Schild-Stellungen (Mitte, Normale) – der Schild sitzt am linken Arm (r negativ)
export const SHIELD_POSE = {
  high: { c: [-0.1, 1.52, 0.36], n: [0, 0.28, 0.96] },
  mid: { c: [-0.13, 1.2, 0.38], n: [0, 0, 1] },
  low: { c: [-0.12, 0.84, 0.36], n: [0, -0.2, 0.98] },
  open: { c: [-0.36, 1.12, 0.2], n: [-0.5, 0, 0.87] },   // beim eigenen Angriff: Schild weicht zur Seite (Blöße!)
  down: { c: [-0.3, 0.86, 0.16], n: [-0.3, -0.25, 0.92] } // getroffen/benommen: Schild sinkt
};

// ---- Geometrie-Bausteine -----------------------------------------------------------------------
const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export const bloodMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xd07878 });
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _t = new THREE.Vector3();
function paint(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
// Teil: Geometrie einfärben und an ihren Platz setzen
function part(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  paint(geo, hex);
  geo.applyMatrix4(_m.compose(_t.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)));
  return geo;
}
const merge = (parts) => mergeGeometries(parts.map(g => (g.index ? g : g)), false);
const geoCache = new Map();
const cached = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; };
const capsule = (r, L) => new THREE.CapsuleGeometry(r, Math.max(0.01, L - 2 * r), 3, 10).translate(0, -L / 2, 0);
const mk = (geo, mat = bodyMat) => { const o = new THREE.Mesh(geo, mat); o.castShadow = true; return o; };

const SKIN = [0xe0b090, 0xd09a78, 0xc68a64, 0xeabf9f];
const HAIR = [0x2a1c12, 0x4a3018, 0x1a1a1a, 0x7a5a30, 0x8a3a1a];
const STEEL = 0xaab0b8, DARK_STEEL = 0x70757c, LEATHER = 0x5a3a20, WOOD = 0x6a4a2a, BOOTS = 0x2e2018, BRASS = 0xb08a3a;
const ARMOR_COLOR = { gambeson: 0xc2ad82, leather: 0x6a4428, mail: 0x8d9095, plate: 0xc3c8d0 };

// ---- Gesicht: auf die Kopf-Kugel gemalt (Vorderseite liegt bei u = 0.25) ------------------------
const faceCache = new Map();
function faceTexture(skin, variant, hair) {
  const key = skin + '|' + variant + '|' + hair;
  if (faceCache.has(key)) return faceCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const css = (h) => '#' + h.toString(16).padStart(6, '0');
  g.fillStyle = css(skin); g.fillRect(0, 0, 256, 128);
  const cx = 64;
  // Schatten unter Brauen und Wangen
  g.fillStyle = 'rgba(60,30,20,0.18)'; g.fillRect(cx - 30, 44, 60, 9); g.fillRect(cx - 34, 70, 68, 30);
  // Augen
  for (const s of [-1, 1]) {
    g.fillStyle = '#f2ece2'; g.beginPath(); g.ellipse(cx + s * 15, 57, 6.5, 3.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = ['#3a2a1a', '#2a3a4a', '#30402a', '#1a1a1a'][variant % 4]; g.beginPath(); g.arc(cx + s * 15, 57, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000'; g.beginPath(); g.arc(cx + s * 15, 57, 1.4, 0, Math.PI * 2); g.fill();
    // grimmige Brauen (nach innen unten)
    g.strokeStyle = css(hair); g.lineWidth = 3.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx + s * 24, 47); g.lineTo(cx + s * 7, 51.5); g.stroke();
  }
  // Nase
  g.strokeStyle = 'rgba(70,35,20,0.55)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx - 1, 58); g.lineTo(cx - 4, 74); g.lineTo(cx + 4, 75); g.stroke();
  // Mund (verkniffen)
  g.strokeStyle = '#5a2a20'; g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(cx - 11, 87); g.quadraticCurveTo(cx, 84 + (variant % 2) * 3, cx + 11, 87); g.stroke();
  // Bartschatten / Narbe
  if (variant % 3 !== 0) { g.fillStyle = 'rgba(30,20,15,0.22)'; g.beginPath(); g.ellipse(cx, 92, 30, 17, 0, 0, Math.PI * 2); g.fill(); }
  if (variant % 4 === 1) { g.strokeStyle = 'rgba(120,40,40,0.7)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx + 20, 46); g.lineTo(cx + 12, 72); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshLambertMaterial({ map: t });
  faceCache.set(key, m);
  return m;
}
const skullGeo = new THREE.SphereGeometry(0.105, 20, 14).scale(0.9, 1.08, 0.98).translate(0, 0.1, 0);

function headGearGeo(kind, hair, cloth, beard) {
  return cached(`gear|${kind}|${hair}|${cloth}|${beard}`, () => {
    const p = [];
    if (kind === 'none') p.push(part(new THREE.SphereGeometry(0.111, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 0, 0.105, -0.008, -0.3, 0, 0, 0.93, 1.08, 1.0));
    if (kind === 'hood') {
      p.push(part(new THREE.SphereGeometry(0.122, 16, 12, Math.PI / 2 + 0.85, Math.PI * 2 - 1.7, 0, Math.PI * 0.82), cloth, 0, 0.1, 0, 0, 0, 0, 0.95, 1.1, 1.03));
      p.push(part(new THREE.CylinderGeometry(0.1, 0.17, 0.1, 12, 1, true), cloth, 0, -0.03, 0));
      p.push(part(new THREE.SphereGeometry(0.123, 16, 6, 0, Math.PI * 2, 0, Math.PI * 0.36), cloth, 0, 0.102, -0.004, 0, 0, 0, 0.95, 1.1, 1.03)); // Kapuze oben geschlossen
    }
    if (kind === 'cap') p.push(part(new THREE.SphereGeometry(0.113, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), LEATHER, 0, 0.105, 0, -0.12, 0, 0, 0.93, 1.1, 1.0));
    if (kind === 'nasal') {
      p.push(part(new THREE.SphereGeometry(0.117, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), STEEL, 0, 0.105, 0, 0, 0, 0, 0.94, 1.14, 1.02));
      p.push(part(new THREE.BoxGeometry(0.022, 0.1, 0.014), DARK_STEEL, 0, 0.085, 0.113));
      p.push(part(new THREE.TorusGeometry(0.108, 0.008, 5, 18), DARK_STEEL, 0, 0.09, 0, Math.PI / 2, 0, 0, 0.96, 1.03, 1));
    }
    if (kind === 'kettle') {
      p.push(part(new THREE.SphereGeometry(0.114, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), STEEL, 0, 0.115, 0, 0, 0, 0, 0.94, 1.0, 1.0));
      p.push(part(new THREE.CylinderGeometry(0.115, 0.2, 0.04, 20), DARK_STEEL, 0, 0.105, 0));
    }
    if (kind === 'great') {
      p.push(part(new THREE.CylinderGeometry(0.126, 0.12, 0.27, 16), STEEL, 0, 0.1, 0));
      p.push(part(new THREE.CylinderGeometry(0.1, 0.126, 0.03, 16), DARK_STEEL, 0, 0.25, 0));
      p.push(part(new THREE.BoxGeometry(0.17, 0.016, 0.02), 0x0a0a0a, 0, 0.128, 0.117));
      p.push(part(new THREE.BoxGeometry(0.02, 0.2, 0.012), BRASS, 0, 0.09, 0.127));
      p.push(part(new THREE.BoxGeometry(0.2, 0.02, 0.012), BRASS, 0, 0.15, 0.122));
    }
    if (beard) p.push(part(new THREE.SphereGeometry(0.072, 10, 8), hair, 0, 0.035, 0.062, 0, 0, 0, 1.05, 1.15, 0.72));
    if (!p.length) p.push(part(new THREE.SphereGeometry(0.01, 4, 3), hair, 0, 0.1, 0));
    return merge(p);
  });
}

function torsoGeo(armor, tunic, sleeve, skin) {
  return cached(`torso|${armor}|${tunic}|${sleeve}|${skin}`, () => {
    const main = ARMOR_COLOR[armor] || tunic, plate = armor === 'plate';
    const p = [
      part(new THREE.CylinderGeometry(0.178, 0.148, 0.5, 14), main, 0, 0.26, 0, 0, 0, 0, 1, 1, 0.7),
      part(new THREE.SphereGeometry(plate ? 0.1 : 0.086, 10, 8), plate ? STEEL : sleeve, -SH_X, SH_Y, 0),
      part(new THREE.SphereGeometry(plate ? 0.1 : 0.086, 10, 8), plate ? STEEL : sleeve, SH_X, SH_Y, 0),
      part(new THREE.CylinderGeometry(0.05, 0.056, 0.12, 8), skin, 0, 0.55, 0),
      part(new THREE.CylinderGeometry(0.153, 0.153, 0.05, 14), 0x3a2616, 0, 0.03, 0, 0, 0, 0, 1, 1, 0.73),
      part(new THREE.BoxGeometry(0.04, 0.04, 0.012), BRASS, 0, 0.03, 0.112),
      part(new THREE.CylinderGeometry(0.15, 0.2, 0.22, 14, 1, true), plate ? tunic : (armor === 'mail' ? ARMOR_COLOR.mail : tunic), 0, -0.1, 0, 0, 0, 0, 1, 1, 0.76)
    ];
    if (plate) p.push(part(new THREE.BoxGeometry(0.012, 0.3, 0.02), DARK_STEEL, 0, 0.32, 0.12));
    if (armor === 'gambeson') for (const x of [-0.09, 0, 0.09]) p.push(part(new THREE.BoxGeometry(0.008, 0.42, 0.008), 0x9a875f, x, 0.27, 0.118 - Math.abs(x) * 0.12));
    if (armor === 'mail') p.push(part(new THREE.CylinderGeometry(0.18, 0.176, 0.06, 14), tunic, 0, 0.5, 0, 0, 0, 0, 1, 1, 0.7)); // Kragen/Überwurf
    return merge(p);
  });
}
const hipsGeo = (pants) => cached('hips|' + pants, () => merge([part(new THREE.SphereGeometry(0.14, 10, 8), pants, 0, -0.02, 0, 0, 0, 0, 1.1, 0.72, 0.8)]));
const upperArmGeo = (col) => cached('ua|' + col, () => merge([part(capsule(0.056, L1), col)]));
const foreArmGeo = (col, hand) => cached(`fa|${col}|${hand}`, () => merge([part(capsule(0.047, 0.27), col), part(new THREE.SphereGeometry(0.046, 8, 6), hand, 0, -L2 + 0.01, 0)]));
const thighGeo = (col) => cached('th|' + col, () => merge([part(capsule(0.083, THIGH), col)]));
const shinGeo = (col, boots) => cached(`sh|${col}|${boots}`, () => merge([
  part(capsule(0.06, SHIN), col),
  part(new THREE.CylinderGeometry(0.067, 0.062, 0.24, 8), boots, 0, -0.3, 0),
  part(new THREE.BoxGeometry(0.1, 0.07, 0.25), boots, 0, -SHIN - 0.005, 0.055)
]));

// ---- Waffen- und Schild-Modelle (entlang +Y, Griff im Ursprung; Schneide entlang X) ---------------
export function weaponGeo(id) {
  return cached('w|' + id, () => {
    if (id === 'sword') return merge([
      part(new THREE.BoxGeometry(0.046, 0.68, 0.008), STEEL, 0, 0.49, 0),
      part(new THREE.ConeGeometry(0.0325, 0.07, 4).rotateY(Math.PI / 4), STEEL, 0, 0.865, 0, 0, 0, 0, 1, 1, 0.18),
      part(new THREE.BoxGeometry(0.17, 0.022, 0.028), DARK_STEEL, 0, 0.138, 0),
      part(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), LEATHER, 0, 0.055, 0),
      part(new THREE.SphereGeometry(0.022, 8, 6), DARK_STEEL, 0, -0.03, 0)
    ]);
    if (id === 'dagger') return merge([
      part(new THREE.BoxGeometry(0.03, 0.17, 0.006), STEEL, 0, 0.155, 0),
      part(new THREE.ConeGeometry(0.0212, 0.05, 4).rotateY(Math.PI / 4), STEEL, 0, 0.265, 0, 0, 0, 0, 1, 1, 0.2),
      part(new THREE.BoxGeometry(0.075, 0.016, 0.02), DARK_STEEL, 0, 0.064, 0),
      part(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 8), LEATHER, 0, 0.01, 0)
    ]);
    if (id === 'club') return merge([
      part(new THREE.CylinderGeometry(0.05, 0.02, 0.74, 8), 0x4a3018, 0, 0.32, 0),
      part(new THREE.CylinderGeometry(0.053, 0.053, 0.03, 8), DARK_STEEL, 0, 0.6, 0),
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 8), DARK_STEEL, 0, 0.46, 0)
    ]);
    if (id === 'axe') return merge([
      part(new THREE.CylinderGeometry(0.019, 0.019, 1.35, 8), WOOD, 0, 0.325, 0),
      part(new THREE.BoxGeometry(0.16, 0.22, 0.012), STEEL, 0.095, 0.9, 0),
      part(new THREE.BoxGeometry(0.05, 0.3, 0.012), STEEL, 0.165, 0.9, 0),
      part(new THREE.BoxGeometry(0.06, 0.1, 0.034), DARK_STEEL, 0, 0.9, 0)
    ]);
    if (id === 'spear') return merge([
      part(new THREE.CylinderGeometry(0.016, 0.016, 2.0, 8), WOOD, 0, 0.3, 0),
      part(new THREE.ConeGeometry(0.034, 0.27, 4).rotateY(Math.PI / 4), STEEL, 0, 1.43, 0, 0, 0, 0, 1, 1, 0.3),
      part(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 8), DARK_STEEL, 0, 1.3, 0)
    ]);
    if (id === 'mace') return merge([
      part(new THREE.CylinderGeometry(0.014, 0.016, 0.56, 8), WOOD, 0, 0.26, 0),
      part(new THREE.SphereGeometry(0.05, 10, 8), DARK_STEEL, 0, 0.55, 0),
      ...[0, 1, 2].map(i => part(new THREE.BoxGeometry(0.135, 0.09, 0.012), STEEL, 0, 0.55, 0, 0, i * Math.PI / 3, 0)),
      part(new THREE.ConeGeometry(0.016, 0.05, 6), STEEL, 0, 0.625, 0)
    ]);
    if (id === 'halberd') return merge([
      part(new THREE.CylinderGeometry(0.018, 0.018, 2.0, 8), WOOD, 0, 0.5, 0),
      part(new THREE.BoxGeometry(0.2, 0.26, 0.012), STEEL, 0.11, 1.5, 0),
      part(new THREE.BoxGeometry(0.06, 0.34, 0.012), STEEL, 0.2, 1.5, 0),
      part(new THREE.ConeGeometry(0.03, 0.14, 4).rotateZ(Math.PI / 2), STEEL, -0.08, 1.5, 0, 0, 0, 0, 1, 1, 0.3),
      part(new THREE.ConeGeometry(0.026, 0.3, 4).rotateY(Math.PI / 4), STEEL, 0, 1.64, 0, 0, 0, 0, 1, 1, 0.35)
    ]);
    if (id === 'bow') { // senkrecht, Bauch nach vorne (+Z), Griff im Ursprung
      const R = 0.75, A = 1.5;
      const arc = new THREE.TorusGeometry(R, 0.013, 5, 18, A).rotateZ(-A / 2).rotateY(-Math.PI / 2).translate(0, 0, -R);
      return merge([
        part(arc, 0x5a3a20),
        part(new THREE.CylinderGeometry(0.003, 0.003, 2 * R * Math.sin(A / 2), 4), 0xe8e0d0, 0, 0, R * Math.cos(A / 2) - R)
      ]);
    }
    return merge([part(new THREE.SphereGeometry(0.01, 4, 3), 0x000000)]); // Faust: nichts zu sehen
  });
}
export function shieldGeo(kind, color) {
  return cached(`s|${kind}|${color}`, () => {
    if (kind === 'heater') return merge([
      part(new THREE.BoxGeometry(0.46, 0.4, 0.03), color, 0, 0.09, 0),
      part(new THREE.ConeGeometry(0.325, 0.3, 4).rotateY(Math.PI / 4).rotateZ(Math.PI), color, 0, -0.26, 0, 0, 0, 0, 1, 1, 0.066),
      part(new THREE.BoxGeometry(0.1, 0.62, 0.006), 0xe8e0d0, 0, -0.02, 0.016),
      part(new THREE.BoxGeometry(0.46, 0.1, 0.006), 0xe8e0d0, 0, 0.12, 0.017),
      part(new THREE.BoxGeometry(0.04, 0.14, 0.04), LEATHER, 0, 0, -0.035)
    ]);
    return merge([
      part(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 24), WOOD, 0, 0, 0, Math.PI / 2, 0, 0),
      part(new THREE.TorusGeometry(0.3, 0.012, 6, 28), DARK_STEEL, 0, 0, 0),
      part(new THREE.SphereGeometry(0.065, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), DARK_STEEL, 0, 0, 0.012, Math.PI / 2, 0, 0),
      part(new THREE.BoxGeometry(0.56, 0.085, 0.004), color, 0, 0, 0.0165),
      part(new THREE.BoxGeometry(0.085, 0.56, 0.004), color, 0, 0, 0.0167),
      part(new THREE.BoxGeometry(0.04, 0.14, 0.04), LEATHER, 0, 0, -0.035)
    ]);
  });
}
export const SHIELD_R = { round: 0.3, heater: 0.31 };
export const SHIELD_HP = { round: 70, heater: 120 }; // Haltbarkeit: Äxte und Hämmer zerschlagen Schilde

// ---- Kämpfer zusammenbauen -------------------------------------------------------------------
const pick = (a) => a[Math.floor(Math.random() * a.length)];
export function buildFighter(typeId) {
  const T = ENEMY_TYPES[typeId];
  const skin = pick(SKIN), hair = pick(HAIR), tunic = pick(T.tunic), helmet = pick(T.helmets);
  const pants = pick([0x3a3028, 0x2e2a26, 0x4a3b2a, 0x35302a]);
  const A = T.armor;
  const sleeve = A.arms === 'none' ? skin : (ARMOR_COLOR[A.arms] || tunic);
  const handCol = A.arms === 'plate' ? DARK_STEEL : (A.arms === 'gambeson' ? LEATHER : skin);
  const legCol = ARMOR_COLOR[A.legs] || pants;

  const root = new THREE.Group(), body = new THREE.Group(), hips = new THREE.Group(), torso = new THREE.Group(), head = new THREE.Group();
  root.add(body); body.add(hips); hips.position.y = HIP; hips.add(torso);
  const hipsMesh = mk(hipsGeo(A.legs === 'cloth' ? pants : legCol)); hips.add(hipsMesh);
  const torsoMesh = mk(torsoGeo(A.torso, tunic, sleeve, skin)); torso.add(torsoMesh);
  head.position.y = 0.6; torso.add(head);
  const face = mk(skullGeo, helmet === 'great' ? faceTexture(skin, 0, hair) : faceTexture(skin, Math.floor(Math.random() * 8), hair)); head.add(face);
  const gear = mk(headGearGeo(helmet, hair, tunic, !!T.beard)); head.add(gear);

  const arms = [-1, 1].map(sx => {
    const top = new THREE.Group(); top.position.set(sx * SH_X, SH_Y, 0); torso.add(top);
    const upper = mk(upperArmGeo(sleeve)); top.add(upper);
    const mid = new THREE.Group(); mid.position.y = -L1; top.add(mid);
    const fore = mk(foreArmGeo(A.arms === 'none' ? skin : sleeve, handCol)); mid.add(fore);
    return { top, mid, upper, fore, sx };
  });
  const legs = [-1, 1].map(sx => {
    const top = new THREE.Group(); top.position.set(sx * 0.095, 0, 0); hips.add(top);
    const upper = mk(thighGeo(legCol)); top.add(upper);
    const mid = new THREE.Group(); mid.position.y = -THIGH; top.add(mid);
    const lower = mk(shinGeo(legCol, A.legs === 'mail' ? DARK_STEEL : BOOTS)); mid.add(lower);
    return { top, mid, upper, lower, sx };
  });
  const scale = THREE.MathUtils.randFloat(0.96, 1.05);
  root.scale.setScalar(scale);
  return {
    root, body, hips, torso, head, face, gear, arms, legs, scale, helmet, tunic,
    armor: { head: ARMOR[HELM_ARMOR[helmet]], torso: ARMOR[A.torso], armR: ARMOR[A.arms], armL: ARMOR[A.arms], legR: ARMOR[A.legs], legL: ARMOR[A.legs] },
    zoneMeshes: { head: [face, gear], torso: [torsoMesh, hipsMesh], armR: [arms[0].upper, arms[0].fore], armL: [arms[1].upper, arms[1].fore], legR: [legs[0].upper, legs[0].lower], legL: [legs[1].upper, legs[1].lower] }
  };
}
export const makeWeapon = (id) => mk(weaponGeo(id));
export const makeShield = (kind, color) => mk(shieldGeo(kind, color));
