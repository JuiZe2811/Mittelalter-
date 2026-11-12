import * as THREE from 'three';
import { room, surfacesOf } from './room.js?v=11';

// =============================================================================
// Laufwege: Raster über dem eingezeichneten Raum + A*-Wegsuche.
// Wände (außer an Türen) und Stühle sind blockiert. Niedrige Tische/Betten (bis CLIMB_MAX) sind begehbar:
// Gegner klettern hinauf (z. B. wenn der Spieler auf dem Bett steht). Höhere Möbel werden umgangen.
// =============================================================================
const nav = { cell: 0.15, minX: 0, minZ: 0, w: 0, h: 0, blocked: null, hgt: null };
const RADIUS = 0.18; // Abstand zu Wänden/Möbeln
export const CLIMB_MAX = 1.05; // bis zu dieser Höhe klettern Gegner auf Tische/Betten
export const STEP = 0.2;       // ab diesem Höhenunterschied wird geklettert bzw. heruntergesprungen
const hyp = (a, b) => Math.sqrt(a * a + b * b);

export function buildNav(head) {
  const walls = surfacesOf('wall');
  let minX = head.x - 6, maxX = head.x + 6, minZ = head.z - 6, maxZ = head.z + 6;
  for (const w of walls) {
    const bx = w.a.x + w.right.x * w.width, bz = w.a.z + w.right.z * w.width;
    minX = Math.min(minX, w.a.x, bx); maxX = Math.max(maxX, w.a.x, bx);
    minZ = Math.min(minZ, w.a.z, bz); maxZ = Math.max(maxZ, w.a.z, bz);
  }
  minX = Math.max(minX - 2, head.x - 12); maxX = Math.min(maxX + 2, head.x + 12);
  minZ = Math.max(minZ - 2, head.z - 12); maxZ = Math.min(maxZ + 2, head.z + 12);
  nav.minX = minX; nav.minZ = minZ;
  nav.w = Math.ceil((maxX - minX) / nav.cell);
  nav.h = Math.ceil((maxZ - minZ) / nav.cell);
  nav.blocked = new Uint8Array(nav.w * nav.h);
  nav.hgt = new Float32Array(nav.w * nav.h);
  const climbable = (s) => s.type === 'table' && s.height <= CLIMB_MAX;
  const boxes = room.surfaces.filter(s => (s.type === 'table' && !climbable(s)) || s.type === 'chair');
  const tops = room.surfaces.filter(climbable);
  // Türen je Wand als begehbare Abschnitte (mindestens 0,8 m breit freihalten)
  const wallInfo = walls.map(w => ({
    w, doors: surfacesOf('door').filter(o => Math.abs(o.normal.dot(w.normal)) > 0.8 && Math.abs((o.mid.x - w.mid.x) * w.normal.x + (o.mid.z - w.mid.z) * w.normal.z) < 0.6)
      .map(o => { const u = (o.mid.x - w.a.x) * w.right.x + (o.mid.z - w.a.z) * w.right.z, half = Math.max(0.4, o.width / 2 + 0.05); return [u - half, u + half]; })
  }));
  for (let j = 0; j < nav.h; j++) for (let i = 0; i < nav.w; i++) {
    const x = minX + (i + 0.5) * nav.cell, z = minZ + (j + 0.5) * nav.cell;
    let blocked = false;
    for (const s of boxes) {
      const dx = x - s.center.x, dz = z - s.center.z;
      if (Math.abs(dx * s.X.x + dz * s.X.z) <= s.hx + RADIUS && Math.abs(dx * s.Z.x + dz * s.Z.z) <= s.hz + RADIUS) { blocked = true; break; }
    }
    if (!blocked) for (const { w, doors } of wallInfo) {
      const u = (x - w.a.x) * w.right.x + (z - w.a.z) * w.right.z;
      const d = (x - w.a.x) * w.normal.x + (z - w.a.z) * w.normal.z;
      if (u < -RADIUS || u > w.width + RADIUS || Math.abs(d) > RADIUS) continue;
      if (!doors.some(([u0, u1]) => u > u0 && u < u1)) { blocked = true; break; }
    }
    nav.blocked[j * nav.w + i] = blocked ? 1 : 0;
    for (const s of tops) { // Zelle liegt auf einem Tisch/Bett: dessen Höhe
      const dx = x - s.center.x, dz = z - s.center.z;
      if (Math.abs(dx * s.X.x + dz * s.X.z) <= s.hx && Math.abs(dx * s.Z.x + dz * s.Z.z) <= s.hz) nav.hgt[j * nav.w + i] = Math.max(nav.hgt[j * nav.w + i], s.height);
    }
  }
}

const cellOf = (x, z) => [Math.floor((x - nav.minX) / nav.cell), Math.floor((z - nav.minZ) / nav.cell)];
const inGrid = (i, j) => i >= 0 && j >= 0 && i < nav.w && j < nav.h;
const isFreeCell = (i, j) => inGrid(i, j) && !nav.blocked[j * nav.w + i];
export function walkable(x, z) {
  if (!nav.blocked) return true;
  const [i, j] = cellOf(x, z);
  return !inGrid(i, j) || !nav.blocked[j * nav.w + i];
}
// Bodenhöhe an einer Stelle (0 = Boden, sonst Oberfläche eines Tisches/Betts)
export function groundAt(x, z) {
  if (!nav.hgt) return 0;
  const [i, j] = cellOf(x, z);
  return inGrid(i, j) ? nav.hgt[j * nav.w + i] : 0;
}
function nearestFree(i, j) {
  if (isFreeCell(i, j)) return [i, j];
  for (let r = 1; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) === r && isFreeCell(i + di, j + dj)) return [i + di, j + dj];
  }
  return null;
}
// Ein Stück von einer blockierten Stelle weg auf die nächste freie Zelle
export function nearestWalkable(p) {
  if (!nav.blocked) return p.clone();
  const f = nearestFree(...cellOf(p.x, p.z));
  return f ? new THREE.Vector3(nav.minX + (f[0] + 0.5) * nav.cell, 0, nav.minZ + (f[1] + 0.5) * nav.cell) : p.clone();
}
// freie Sichtlinie auf dem Raster (mit etwas Seitenabstand)
function lineFree(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, len = hyp(dx, dz), h0 = groundAt(a.x, a.z);
  const n = Math.ceil(len / (nav.cell * 0.5));
  const px = len > 0 ? -dz / len * 0.08 : 0, pz = len > 0 ? dx / len * 0.08 : 0;
  for (let k = 1; k <= n; k++) {
    const t = k / n, x = a.x + dx * t, z = a.z + dz * t;
    if (!walkable(x, z) || !walkable(x + px, z + pz) || !walkable(x - px, z - pz)) return false;
    if (Math.abs(groundAt(x, z) - h0) > STEP) return false; // Kletterstellen bleiben eigene Wegpunkte
  }
  return true;
}
// A* mit Binär-Heap; liefert geglättete Wegpunkte (y = 0)
let gScore, fScore, came, closed, heapArr;
export function findPath(from, to) {
  if (!nav.blocked) return [to.clone().setY(0)];
  const s = nearestFree(...cellOf(from.x, from.z)), g = nearestFree(...cellOf(to.x, to.z));
  if (!s || !g) return [to.clone().setY(0)];
  const W = nav.w, N = W * nav.h, start = s[1] * W + s[0], goal = g[1] * W + g[0];
  if (!gScore || gScore.length !== N) { gScore = new Float32Array(N); fScore = new Float32Array(N); came = new Int32Array(N); closed = new Uint8Array(N); heapArr = new Int32Array(N * 4); }
  gScore.fill(Infinity); came.fill(-1); closed.fill(0);
  let size = 0;
  const push = (k) => { let i = size++; heapArr[i] = k; while (i > 0) { const p = (i - 1) >> 1; if (fScore[heapArr[p]] <= fScore[heapArr[i]]) break; const t = heapArr[p]; heapArr[p] = heapArr[i]; heapArr[i] = t; i = p; } };
  const pop = () => { const top = heapArr[0]; heapArr[0] = heapArr[--size]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < size && fScore[heapArr[l]] < fScore[heapArr[m]]) m = l; if (r < size && fScore[heapArr[r]] < fScore[heapArr[m]]) m = r; if (m === i) break; const t = heapArr[m]; heapArr[m] = heapArr[i]; heapArr[i] = t; i = m; } return top; };
  const gx = g[0], gy = g[1];
  gScore[start] = 0; fScore[start] = hyp(s[0] - gx, s[1] - gy); push(start);
  let found = start === goal;
  while (size > 0 && !found) {
    if (size >= heapArr.length - 8) break;
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) { found = true; break; }
    closed[cur] = 1;
    const ci = cur % W, cj = (cur / W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ci + di, nj = cj + dj;
      if (!isFreeCell(ni, nj)) continue;
      if (di && dj && (!isFreeCell(ci + di, cj) || !isFreeCell(ci, cj + dj))) continue; // keine Ecken schneiden
      const nk = nj * W + ni;
      if (closed[nk]) continue;
      const ng = gScore[cur] + (di && dj ? 1.414 : 1) + (Math.abs(nav.hgt[nk] - nav.hgt[cur]) > STEP ? 6 : 0); // Klettern kostet Zeit
      if (ng < gScore[nk]) { gScore[nk] = ng; fScore[nk] = ng + hyp(ni - gx, nj - gy); came[nk] = cur; push(nk); }
    }
  }
  if (!found) return [to.clone().setY(0)];
  const path = [];
  for (let k = goal; k !== -1 && k !== start; k = came[k]) path.push(new THREE.Vector3(nav.minX + ((k % W) + 0.5) * nav.cell, 0, nav.minZ + (((k / W) | 0) + 0.5) * nav.cell));
  path.reverse();
  path.push(to.clone().setY(0));
  // glätten: nur Punkte behalten, die wirklich nötig sind
  const out = [];
  let anchor = from, i = 0;
  while (i < path.length) {
    let j = path.length - 1;
    while (j > i && !lineFree(anchor, path[j])) j--;
    out.push(path[j]);
    anchor = path[j];
    i = j + 1;
  }
  return out;
}
export const hasRoom = () => room.surfaces.length > 0;
