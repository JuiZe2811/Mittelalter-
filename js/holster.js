import * as THREE from 'three';

// =============================================================================
// Holster am eigenen Körper: linke/rechte Hüfte, Rücken über beiden Schultern, Köcher.
// Ohne Ganzkörper-Tracking wird der Körper aus Kopf und Controllern geschätzt:
//  · Höhe: Hüfte und Schultern relativ zur Augenhöhe (Körpergröße kalibrierbar)
//  · Richtung: Blickrichtung, aber träge – der Körper dreht nur mit, wenn der Kopf deutlich und
//    eine Weile zur Seite schaut, oder wenn beide Hände vor dem Körper die Richtung bestätigen.
// Die Holster liegen so, dass man sie ohne Verrenkung erreicht (Rücken: knapp hinter der Schulter).
// =============================================================================
export const SLOTS = {
  hipL: { name: 'linke Hüfte', size: 'hip', side: -1, kind: 'hip' },
  hipR: { name: 'rechte Hüfte', size: 'hip', side: 1, kind: 'hip' },
  backL: { name: 'Rücken links', size: 'back', side: -1, kind: 'back' },
  backR: { name: 'Rücken rechts', size: 'back', side: 1, kind: 'back' },
  quiver: { name: 'Köcher', size: 'quiver', side: 0, kind: 'quiver' }
};
const ringGeo = new THREE.TorusGeometry(0.075, 0.006, 6, 24);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.0, depthTest: false, toneMapped: false });
const quiverMat = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9 });

export function createHolsters(scene) {
  const H = { slots: {}, yaw: 0, eye: 1.6, hipY: 0.95, ready: false, quiverGroup: null };
  for (const [id, def] of Object.entries(SLOTS)) {
    const anchor = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, ringMat.clone());
    ring.renderOrder = 25;
    anchor.add(ring);
    scene.add(anchor);
    H.slots[id] = { id, def, anchor, ring, weapon: null, hot: 0 };
  }
  // Köcher: Lederrohr mit sichtbaren Pfeilenden – sitzt über der rechten Schulter
  const q = new THREE.Group();
  q.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.42, 10, 1, true), quiverMat));
  for (let i = 0; i < 6; i++) { const a = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 4), new THREE.MeshLambertMaterial({ color: i % 2 ? 0xb02a20 : 0xe8e0d0, side: THREE.DoubleSide })); a.position.set(Math.cos(i) * 0.02, 0.24, Math.sin(i) * 0.02); q.add(a); }
  H.slots.quiver.anchor.add(q);
  H.quiverGroup = q;
  return H;
}

// Körper schätzen und Holster platzieren. head = Kopfposition, look = Blickrichtung, hands = Handpositionen
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
export function updateHolsters(H, dt, head, look, handPts, o) {
  // Augenhöhe: sanft der aktuellen Kopfhöhe folgen (Ducken verschiebt die Hüfte mit)
  const headYaw = Math.atan2(-look.x, -look.z);
  if (!H.ready) { H.yaw = headYaw; H.ready = true; }
  let d = Math.atan2(Math.sin(headYaw - H.yaw), Math.cos(headYaw - H.yaw));
  // Hände vor dem Körper geben die Brustrichtung vor (Mittel beider Hände)
  if (handPts.length === 2) {
    const mx = (handPts[0].x + handPts[1].x) / 2 - head.x, mz = (handPts[0].z + handPts[1].z) / 2 - head.z;
    if (Math.hypot(mx, mz) > 0.2) { const hy = Math.atan2(-mx, -mz), dh = Math.atan2(Math.sin(hy - H.yaw), Math.cos(hy - H.yaw)); if (Math.abs(dh) < 1.2) d = d * 0.6 + dh * 0.4; }
  }
  // Totbereich: kleine Kopfdrehungen bewegen den Körper nicht; große ziehen ihn mit
  const dead = 0.45;
  if (Math.abs(d) > dead) H.yaw += (d - Math.sign(d) * dead) * Math.min(1, dt * 4);
  else H.yaw += d * Math.min(1, dt * 0.6);
  const scale = (o.height || 1.75) / 1.75;
  const sh = head.y - 0.24 * scale, hip = head.y - 0.68 * scale;
  _f.set(-Math.sin(H.yaw), 0, -Math.cos(H.yaw)); _r.set(Math.cos(H.yaw), 0, -Math.sin(H.yaw));
  const hipOff = o.hipOffset || 0; // Hüft-Holster weiter vorne (+) oder hinten (−)
  const neck = new THREE.Vector3(head.x, 0, head.z).addScaledVector(_f, -0.08);
  for (const S of Object.values(H.slots)) {
    const k = S.def.kind, A = S.anchor;
    if (k === 'hip') A.position.copy(neck).addScaledVector(_r, S.def.side * 0.2 * scale).addScaledVector(_f, 0.08 + hipOff).setY(hip);
    else if (k === 'back') A.position.copy(neck).addScaledVector(_r, S.def.side * 0.17 * scale).addScaledVector(_f, -0.12).setY(sh + 0.02);
    else A.position.copy(neck).addScaledVector(_r, (o.quiverSide || 1) * 0.12 * scale).addScaledVector(_f, -0.14).setY(sh - 0.05);
    A.quaternion.setFromAxisAngle(UP, H.yaw);
    if (k === 'quiver') { H.quiverGroup.rotation.set(0.25, 0, -0.35 * (o.quiverSide || 1)); H.quiverGroup.visible = !!o.quiver; }
    // Ring zeigt freie/belegte Plätze, wenn eine Hand in der Nähe ist
    S.ring.lookAt(head);
    const target = o.show ? S.hot : 0;
    S.ring.material.opacity += (target - S.ring.material.opacity) * Math.min(1, dt * 12);
    S.ring.visible = S.ring.material.opacity > 0.02 && (k !== 'quiver' || o.quiver);
    S.ring.material.color.setHex(S.weapon ? 0x7dffa8 : 0xffd36a);
    A.updateMatrixWorld(true);
  }
}
// Passt die Waffe in diesen Platz?
export const fits = (S, w) => !!w && !S.weapon && S.def.kind !== 'quiver' && (S.def.size === 'back' || w.def.slot === 'hip');
// nächster Platz in Reichweite der Hand (Radius r)
export function slotNear(H, p, r, filter) {
  let best = null, bd = r;
  for (const S of Object.values(H.slots)) {
    if (filter && !filter(S)) continue;
    const d = S.anchor.position.distanceTo(p);
    if (d < bd) { bd = d; best = S; }
  }
  return best;
}
// Lage der Waffe im Holster (lokal zum Anker): Hüfte = Klinge schräg nach unten-hinten, Rücken = schräg über die Schulter
const _bd = new THREE.Vector3(), _want = new THREE.Vector3();
export function holsterPose(S, w, out) {
  const k = S.def.kind;
  out.position.set(0, 0, 0);
  if (w.def.shield) { out.position.set(0, k === 'hip' ? -0.05 : -0.15, 0.1); out.quaternion.setFromEuler(new THREE.Euler(0, k === 'hip' ? -S.def.side * Math.PI / 2 : 0, 0)); return out; } // flach an Hüfte/Rücken, Vorderseite nach außen
  if (w.def.bow) { out.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 2, S.def.side * 0.5)); out.position.set(0, -0.12, 0.05); return out; }
  if (!w.tip) { out.quaternion.identity(); return out; }
  // Klinge/Schaft zeigt an der Hüfte nach unten-hinten, auf dem Rücken schräg nach unten (Griff über der Schulter)
  _bd.subVectors(w.tip, w.base || new THREE.Vector3()).normalize();
  if (k === 'hip') _want.set(S.def.side * 0.12, -0.93, 0.35).normalize();
  else _want.set(-S.def.side * 0.35, -0.88, 0.3).normalize();
  out.quaternion.setFromUnitVectors(_bd, _want);
  // Griff etwas nach oben aus dem Anker heraus, damit man ihn gut greift
  out.position.copy(_want).multiplyScalar(k === 'hip' ? 0.04 : 0.02);
  return out;
}
