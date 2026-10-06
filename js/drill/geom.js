// Géométrie et hasard pour les générateurs d'exercices. Fonctions pures (utilisables dans Node).
import { FILES, fileOf, rankOf, sqAt, dist, ALL_SQUARES, fenFrom } from '../analysis.js';
export { FILES, fileOf, rankOf, sqAt, dist, ALL_SQUARES, fenFrom };

// Générateur pseudo-aléatoire reproductible (mulberry32).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const int = (rng, a, b) => a + Math.floor(rng() * (b - a + 1)); // a..b inclus
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
export const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
export const shift = (sq, df, dr) => sqAt(fileOf(sq) + df, rankOf(sq) + dr);
export const knightTargets = sq => KNIGHT.map(([f, r]) => shift(sq, f, r)).filter(Boolean);
export const kingTargets = sq => KING.map(([f, r]) => shift(sq, f, r)).filter(Boolean);
export const adjacent = (a, b) => a !== b && dist(a, b) === 1;
export const onEdge = sq => fileOf(sq) === 0 || fileOf(sq) === 7 || rankOf(sq) === 0 || rankOf(sq) === 7;
export const squaresWhere = pred => ALL_SQUARES.filter(pred);

// Cases strictement entre a et b sur une ligne (rangée, colonne ou diagonale) ; null si pas alignées.
export function between(a, b) {
  const df = fileOf(b) - fileOf(a), dr = rankOf(b) - rankOf(a);
  if (!(df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr)) || a === b) return null;
  const sf = Math.sign(df), sr = Math.sign(dr), out = [];
  for (let s = shift(a, sf, sr); s && s !== b; s = shift(s, sf, sr)) out.push(s);
  return out;
}
// Ligne libre entre a et b dans un placement { sq: piece }.
export const clearLine = (placement, a, b) => { const l = between(a, b); return !!l && l.every(s => !placement[s]); };

// ---------- Symétries (miroir gauche-droite, échange des couleurs) appliquées aux cases et coups ----------
export const mirrorSq = sq => FILES[7 - fileOf(sq)] + sq[1];
export const flipSq = sq => sq[0] + (9 - +sq[1]);
const SQ = /^[a-h][1-8]$/, UCI = /^([a-h][1-8])([a-h][1-8])([qrbn]?)$/;
// Transforme une valeur quelconque (case, coup UCI, tableau, objet) avec la fonction de case f.
export function mapSquares(v, f) {
  if (typeof v === 'string') {
    if (SQ.test(v)) return f(v);
    const m = v.match(UCI);
    return m ? f(m[1]) + f(m[2]) + m[3] : v;
  }
  if (Array.isArray(v)) return v.map(x => mapSquares(x, f));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [SQ.test(k) ? f(k) : k, mapSquares(x, f)]));
  return v;
}
