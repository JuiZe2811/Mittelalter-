import * as THREE from 'three';

// =============================================================================
// Geometrie für den Kampf: Klingen, Schäfte und Pfeile sind Strecken, Körperteile sind Kapseln
// (Strecke + Radius), Schilde sind Scheiben. Alle Treffer, Blocks und Paraden werden damit berechnet.
// =============================================================================
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();

// Kürzester Abstand zweier Strecken p1→q1 und p2→q2. out1/out2 (optional) = nächste Punkte.
export function segSeg(p1, q1, p2, q2, out1 = null, out2 = null) {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { s = t = 0; }
  else if (a <= 1e-9) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-9) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = _d1.dot(_d2), den = a * e - b * b;
      s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  if (out1) out1.copy(_c1);
  if (out2) out2.copy(_c2);
  return _c1.distanceTo(_c2);
}

// Abstand Strecke a→b zu Punkt p. out (optional) = nächster Punkt auf der Strecke.
export function segPoint(a, b, p, out = null) {
  _d1.subVectors(b, a);
  const l = _d1.lengthSq();
  const t = l > 1e-9 ? THREE.MathUtils.clamp(_r.subVectors(p, a).dot(_d1) / l, 0, 1) : 0;
  _c1.copy(a).addScaledVector(_d1, t);
  if (out) out.copy(_c1);
  return _c1.distanceTo(p);
}

// Trifft die Strecke a→b eine Scheibe (Schild)? c = Mitte, n = Normale, r = Radius, half = halbe Dicke.
// Liefert den Berührpunkt (in out) oder null.
const _p = new THREE.Vector3();
export function segDisc(a, b, c, n, r, half, out = new THREE.Vector3()) {
  const da = _r.subVectors(a, c).dot(n), db = _d1.subVectors(b, c).dot(n);
  if ((da > half && db > half) || (da < -half && db < -half)) return null;
  const test = (s) => {
    _p.lerpVectors(a, b, s);
    const d = _d2.subVectors(_p, c).dot(n);
    if (Math.abs(d) > half) return false;
    _d2.addScaledVector(n, -d); // radialer Anteil
    return _d2.lengthSq() <= r * r;
  };
  // Durchstoßpunkt durch die Scheiben-Ebene zuerst, dann Stützstellen (für flach aufliegende Klingen)
  if (da !== db) { const s = da / (da - db); if (s >= 0 && s <= 1 && test(s)) return out.copy(_p); }
  for (let i = 0; i <= 6; i++) if (test(i / 6)) return out.copy(_p);
  return null;
}

// Richtungen kugelförmig überblenden (für Klingenbögen): a, b = Einheitsvektoren
export function slerpDir(a, b, k, out) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1), th = Math.acos(dot);
  if (th < 1e-3) return out.copy(b);
  const s = Math.sin(th);
  if (s < 1e-3) return out.copy(k < 0.5 ? a : b);
  const wa = Math.sin((1 - k) * th) / s, wb = Math.sin(k * th) / s;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize();
}
