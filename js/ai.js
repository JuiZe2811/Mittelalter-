// =============================================================================
// KI 3.0: Persönlichkeiten, Wahrnehmung des Spielstils, Moral.
// Gegner nutzen nur, was sie sehen können: Richtung und Art der Hiebe, die auf sie zukommen,
// womit ihre eigenen Angriffe abgewehrt wurden, ob der Spieler zurückweicht oder daneben schlägt.
// Wissen verblasst (Beobachtungsfenster ~20 s), kommt mit Verzögerung an und ist manchmal falsch.
// =============================================================================
const rnd = (a, b) => a + Math.random() * (b - a);

// Globale Regler (Test-Menü): alle 1 = normal
export const aiOpts = { diff: 1, aggro: 1, react: 1, adapt: 1, morale: 1, defense: 1 };

// Persönlichkeiten: Multiplikatoren auf die Werte des Gegner-Typs + eigene Eigenschaften
//  aggro/parry/guard/dodge/feint/smart/flee: Faktoren · react: Faktor auf die Reaktionszeit (kleiner = schneller)
//  morale: Grundmoral · adapt: wie stark er aus Beobachtungen lernt · counter: Konter nach Fehlschlag des Spielers
//  dist: bevorzugter Zusatzabstand (m) · heavy: Vorliebe für schwere Hiebe · ignore: so viel Schaden steckt er ohne Zucken weg
//  overext: Taumeln nach verfehltem schwerem Hieb · surrender: Neigung, sich zu ergeben · panicDrop: Waffe fällt vor Angst
//  hesitate: zögert vor dem Angriff · grip: Griffkraft (Waffenkontrolle, Entwaffnen)
export const PERSONAS = {
  berserker: { name: 'Berserker', color: '#ff7a5a', mul: { aggro: 1.65, parry: 0.3, guard: 0.6, dodge: 0.3, feint: 0.2, smart: 0.6, react: 1.15, flee: 0 },
    morale: 95, adapt: 0.3, counter: 0.25, dist: -0.15, heavy: 0.8, ignore: 12, overext: 1, surrender: 0, panicDrop: 0, hesitate: 0, grip: 1.25, bal: 1.2, speed: 1.08 },
  elite: { name: 'Elite-Ritter', color: '#ffd36a', mul: { aggro: 1, parry: 1.8, guard: 1.15, dodge: 1.3, feint: 2.2, smart: 1.4, react: 0.75, flee: 0.3 },
    morale: 85, adapt: 1, counter: 0.85, dist: 0.05, heavy: 0.3, ignore: 5, overext: 0.2, surrender: 0.12, panicDrop: 0, hesitate: 0, grip: 1.2, bal: 1.1, speed: 1 },
  cautious: { name: 'Vorsichtig', color: '#7dc8ff', mul: { aggro: 0.62, parry: 1.35, guard: 1.25, dodge: 1.4, feint: 0.8, smart: 1.1, react: 0.9, flee: 1 },
    morale: 62, adapt: 0.65, counter: 0.9, dist: 0.35, heavy: 0.2, ignore: 4, overext: 0.3, surrender: 0.45, panicDrop: 0.05, hesitate: 0.1, grip: 1, bal: 1, speed: 1 },
  fearful: { name: 'Ängstlich', color: '#c9a0ff', mul: { aggro: 0.5, parry: 0.7, guard: 0.8, dodge: 1.5, feint: 0.3, smart: 0.7, react: 1.35, flee: 2 },
    morale: 42, adapt: 0.3, counter: 0.2, dist: 0.5, heavy: 0.15, ignore: 2, overext: 0.5, surrender: 0.85, panicDrop: 0.5, hesitate: 0.6, grip: 0.75, bal: 0.85, speed: 1.05 }
};
export const PERSONA_ORDER = ['berserker', 'elite', 'cautious', 'fearful'];
// Wer welche Persönlichkeit hat (Gewichte je Gegner-Typ)
const BY_TYPE = {
  bandit: { berserker: 2, fearful: 4, cautious: 2, elite: 0.2 },
  soldier: { berserker: 1, elite: 1.5, cautious: 3, fearful: 1.5 },
  shield: { cautious: 4, elite: 1.5, fearful: 1, berserker: 0.5 },
  spear: { cautious: 3, elite: 1, fearful: 1.5, berserker: 0.6 },
  halberd: { cautious: 2, elite: 1.5, berserker: 1.5, fearful: 1 },
  axe: { berserker: 5, cautious: 1, fearful: 0.5, elite: 0.3 },
  archer: { cautious: 3, fearful: 3, elite: 0.5, berserker: 0.3 },
  knight: { elite: 5, cautious: 1.5, berserker: 0.8, fearful: 0.1 }
};
export function pickPersona(type) {
  const w = BY_TYPE[type] || BY_TYPE.soldier;
  let sum = 0; for (const k in w) sum += w[k];
  let r = Math.random() * sum;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return 'cautious';
}
// Eigenschaften eines einzelnen Gegners: Typ × Persönlichkeit × individuelle Abweichung (±15 %)
export function makeAttrs(T, pid) {
  const P = PERSONAS[pid] || PERSONAS.cautious, M = P.mul;
  const j = () => rnd(0.85, 1.15), p = (v) => Math.min(0.95, Math.max(0, v));
  return {
    persona: pid,
    aggro: T.aggro * M.aggro * j(), parry: p(T.parry * M.parry * j() + (pid === 'elite' ? 0.15 : 0)), guard: p(T.guard * M.guard * j()),
    dodge: p(T.dodge * M.dodge * j()), feint: p(T.feint * M.feint * j() + (pid === 'elite' ? 0.08 : 0)), smart: Math.min(1, T.smart * M.smart * j()),
    react: T.react * M.react * j(), flee: p(T.flee * M.flee * j()), arrowDodge: T.arrowDodge,
    balance: T.balance * P.bal * j(), morale0: Math.min(100, P.morale * j()), adapt: P.adapt * j(), counter: p(P.counter * j()),
    dist: P.dist, heavy: P.heavy, ignore: P.ignore, overext: P.overext, surrender: P.surrender, panicDrop: P.panicDrop,
    hesitate: P.hesitate, grip: P.grip * (T.balance / 60) * j(), speed: P.speed
  };
}

// ---- Wissen über den Spieler (je Gegner) ----------------------------------------------------------
// sw: woher kommen seine Hiebe · def: womit wehrt er ab · at: welche eigenen Angriffsziele wurden abgewehrt
export function newKnow() {
  return { sw: { high: 0, low: 0, left: 0, right: 0, thrust: 0 }, def: { shield: 0, parry: 0, dodge: 0 }, at: { head: 0, body: 0, legs: 0 },
    miss: 0, swings: 0, retreat: 0, pend: [], tick: rnd(0, 0.5) };
}
const GROUPS = { sw: ['high', 'low', 'left', 'right', 'thrust'], def: ['shield', 'parry', 'dodge'], at: ['head', 'body', 'legs'] };
// Beobachtung: kommt nach der Reaktionszeit an; mit Wahrscheinlichkeit (1 − smart)·0,35 falsch eingeordnet
export function observe(K, A, now, group, key, w = 1) {
  if (K.pend.length > 24) return;
  if (GROUPS[group] && Math.random() < (1 - A.smart) * 0.35) { const g = GROUPS[group]; key = g[(Math.random() * g.length) | 0]; }
  K.pend.push({ at: now + A.react * rnd(1.5, 3), group, key, w });
}
const HALF = 20; // Beobachtungsfenster: nach ~20 s zählt eine Beobachtung nur noch halb
export function tickKnow(K, dt, now) {
  const f = Math.exp(-dt * Math.LN2 / HALF);
  for (const g of ['sw', 'def', 'at']) { const o = K[g]; for (const k in o) o[k] *= f; }
  K.miss *= f; K.swings *= f; K.retreat *= f;
  for (let i = K.pend.length - 1; i >= 0; i--) {
    const p = K.pend[i];
    if (p.at > now) continue;
    if (p.group === 'miss') K.miss += p.w; else if (p.group === 'retreat') K.retreat += p.w;
    else { K[p.group][p.key] += p.w; if (p.group === 'sw') K.swings += p.w; }
    K.pend.splice(i, 1);
  }
}
// Anteil einer Beobachtung in ihrer Gruppe (0..1), mit Glättung – wenige Beobachtungen zählen wenig
export function share(K, group, key) {
  const o = K[group]; let s = 0; for (const k in o) s += o[k];
  return o[key] / (s + 2);
}
// erkannte Muster als kurze Texte (für die Test-Anzeige)
export function patterns(K) {
  const out = [];
  const top = (g) => { let bk = null, bv = 0; for (const k in K[g]) if (K[g][k] > bv) { bv = K[g][k]; bk = k; } return bk && share(K, g, bk) > 0.35 ? bk : null; };
  const SW = { high: 'Hiebe von oben', low: 'tiefe Hiebe', left: 'Hiebe von links', right: 'Hiebe von rechts', thrust: 'sticht oft' };
  const DF = { shield: 'blockt mit Schild', parry: 'pariert', dodge: 'weicht zurück' };
  const s = top('sw'); if (s) out.push(SW[s]);
  const d = top('def'); if (d) out.push(DF[d]);
  if (K.miss > 2.5) out.push('verfehlt oft');
  if (K.swings > 8) out.push('sehr aggressiv');
  return out;
}

// ---- Moral --------------------------------------------------------------------------------------
// Ereignisse, die die Moral verändern (Grundwerte; Persönlichkeit verstärkt Angst bzw. Wut)
export const MORALE = { hurt: -0.45, allyDead: -14, allyYield: -8, disarmed: -18, crippled: -14, hitPlayer: 4, playerHurt: 2, mercyKill: -12, down: -8 };
