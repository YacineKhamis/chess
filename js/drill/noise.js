// Bruit inerte (spec §3.0.3) : des pièces qui habillent la position sans toucher au motif.
// Une unité est soit un « bélier » (pion blanc en (c, r), pion noir juste devant, r = 2…6),
// soit une « paire » (un cavalier, un fou ou une tour de chaque camp, de même type).
// Une unité n'est gardée que si chaque nouvelle pièce : n'est pas attaquée par l'autre camp,
// n'attaque aucune pièce adverse et n'attaque aucune case de l'empreinte du motif.
// Fonctions pures sur des placements { case: pièce } (majuscule = blanc), utilisables dans Node.
import { int, pick, shift, sqAt, KNIGHT, KING, ROOK_DIRS, BISHOP_DIRS, ALL_SQUARES } from './geom.js';

export const isWhite = p => p === p.toUpperCase();
const QUEEN_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];

// Cases attaquées par la pièce posée en `sq` (les lignes s'arrêtent à la première pièce, incluse).
export function attacksFrom(placement, sq, piece = placement[sq]) {
  const t = piece.toLowerCase();
  if (t === 'p') return [-1, 1].map(df => shift(sq, df, isWhite(piece) ? 1 : -1)).filter(Boolean);
  if (t === 'n') return KNIGHT.map(([f, r]) => shift(sq, f, r)).filter(Boolean);
  if (t === 'k') return KING.map(([f, r]) => shift(sq, f, r)).filter(Boolean);
  const out = [];
  for (const [df, dr] of t === 'r' ? ROOK_DIRS : t === 'b' ? BISHOP_DIRS : QUEEN_DIRS) {
    for (let s = shift(sq, df, dr); s; s = shift(s, df, dr)) { out.push(s); if (placement[s]) break; }
  }
  return out;
}

// Toutes les cases attaquées par `colour` ('w' ou 'b').
export function attackedBy(placement, colour) {
  const set = new Set();
  for (const [s, p] of Object.entries(placement)) {
    if (isWhite(p) === (colour === 'w')) for (const t of attacksFrom(placement, s, p)) set.add(t);
  }
  return set;
}
export const isAttacked = (placement, sq, colour) =>
  Object.entries(placement).some(([s, p]) => isWhite(p) === (colour === 'w') && attacksFrom(placement, s, p).includes(sq));

// Pièce de `placed` qui casse la règle d'inertie, ou null si toutes sont inertes.
function notInert(m, placed, foot) {
  for (const s of placed) {
    const p = m[s], white = isWhite(p);
    if (isAttacked(m, s, white ? 'b' : 'w')) return s;
    for (const t of attacksFrom(m, s, p)) {
      if (foot.has(t)) return s;
      const q = m[t];
      if (q && isWhite(q) !== white) return s;
    }
  }
  return null;
}

/**
 * Ajoute jusqu'à `n` unités inertes au placement (au plus 200 essais de pose).
 * opts.kinds : ['ram', 'pair'] par défaut ; opts.types : types des paires (['N', 'B', 'R']).
 * Renvoie { placement, units } : le nouveau placement (copie) et le nombre d'unités posées.
 * La position reste légale : aucune nouvelle pièce n'attaque le roi adverse, les pions restent
 * sur les rangées 2 à 7 et sont bloqués l'un par l'autre (pas de prise en passant, pas de prise).
 */
export function addNoise(rng, placement, footprint, n, { kinds = ['ram', 'pair'], types = ['N', 'B', 'R'] } = {}) {
  const foot = footprint instanceof Set ? footprint : new Set(footprint || []);
  let m = { ...placement }, units = 0;
  for (let t = 0; t < 200 && units < n; t++) {
    const trial = { ...m }, placed = [];
    if (pick(rng, kinds) === 'ram') {
      const f = int(rng, 0, 7), r = int(rng, 1, 5);
      const a = sqAt(f, r), b = sqAt(f, r + 1);
      if (trial[a] || trial[b] || foot.has(a) || foot.has(b)) continue;
      trial[a] = 'P'; trial[b] = 'p'; placed.push(a, b);
    } else {
      const free = ALL_SQUARES.filter(s => !trial[s] && !foot.has(s));
      if (free.length < 2) break;
      const type = pick(rng, types), a = pick(rng, free);
      const b = pick(rng, free.filter(s => s !== a));
      trial[a] = type; trial[b] = type.toLowerCase(); placed.push(a, b);
    }
    if (notInert(trial, placed, foot)) continue;
    m = trial; units++;
  }
  return { placement: m, units };
}

// Nombre d'unités demandé : un entier ou un intervalle [min, max] tiré au hasard.
export const unitsFor = (rng, spec) => (Array.isArray(spec) ? int(rng, spec[0], spec[1]) : spec || 0);
