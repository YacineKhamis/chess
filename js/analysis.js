// Outils d'analyse sans moteur : géométrie de l'échiquier, cage du roi, opposition, carré du pion.
// Fonctions pures (aucun accès au DOM) pour pouvoir les tester dans Node.
import { Chess } from '../vendor/chess.js';

export const FILES = 'abcdefgh';
export const fileOf = sq => FILES.indexOf(sq[0]);
export const rankOf = sq => +sq[1] - 1;
export const sqAt = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? FILES[f] + (r + 1) : null);
export const ALL_SQUARES = [...Array(64)].map((_, i) => sqAt(i % 8, Math.floor(i / 8)));
export const dist = (a, b) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
export const neighbours = sq => {
  const out = [];
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    const n = (df || dr) && sqAt(fileOf(sq) + df, rankOf(sq) + dr);
    if (n) out.push(n);
  }
  return out;
};
export const other = c => (c === 'w' ? 'b' : 'w');
export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function pieces(chess, color = null) {
  return chess.board().flat().filter(p => p && (!color || p.color === color));
}
export function kingSquare(chess, color) {
  const k = pieces(chess, color).find(p => p.type === 'k');
  return k ? k.square : null;
}
export function material(chess, color) {
  return pieces(chess, color).reduce((s, p) => s + VALUE[p.type], 0);
}
// Matériel du point de vue de `color` (positif = avantage).
export const balance = (chess, color) => material(chess, color) - material(chess, other(color));

// Une copie de la position où l'on peut retirer des pièces (même un roi) sans validation.
function editable(chess) {
  return new Chess(chess.fen(), { skipValidation: true });
}

// Cases contrôlées par `color`. Le roi adverse est retiré avant le calcul, pour que les
// lignes de tour ou de dame « traversent » sa case : il ne peut pas reculer le long d'un échec.
export function controlled(chess, color) {
  const c = editable(chess);
  const k = kingSquare(c, other(color));
  if (k) c.remove(k);
  return new Set(ALL_SQUARES.filter(sq => c.isAttacked(sq, color)));
}

// Zone accessible au roi de `color` en marchant de proche en proche sur des cases non contrôlées.
// Une pièce adverse non défendue compte comme accessible (le roi peut la prendre).
// Le Set rendu porte aussi deux listes (spec §5.2) : `hanging`, les pièces adverses non défendues que le roi peut
// prendre tout de suite (adjacentes), et `leaks`, celles qu'il n'atteindrait qu'en plusieurs coups.
export function kingZone(chess, color) {
  const start = kingSquare(chess, color);
  const zone = new Set();
  zone.hanging = []; zone.leaks = [];
  if (!start) return zone;
  const ctrl = controlled(chess, other(color));
  zone.add(start);
  const todo = [start];
  while (todo.length) {
    const cur = todo.pop();
    for (const n of neighbours(cur)) {
      if (zone.has(n) || ctrl.has(n)) continue;
      const p = chess.get(n);
      if (p && p.color === color) continue;
      zone.add(n);
      if (!p) todo.push(n);
      else (cur === start ? zone.hanging : zone.leaks).push(n);
    }
  }
  return zone;
}
// Distance entre les deux rois (en coups de roi), ou null s'il en manque un.
export function kingDist(chess) {
  const a = kingSquare(chess, 'w'), b = kingSquare(chess, 'b');
  return a && b ? dist(a, b) : null;
}

// Pièces de `color` attaquées et non défendues.
export function hanging(chess, color) {
  return pieces(chess, color).filter(p => p.type !== 'k'
    && chess.isAttacked(p.square, other(color)) && !chess.isAttacked(p.square, color));
}

// Opposition entre deux rois : 'direct' (face à face, une case entre eux), 'distant' (même colonne
// ou rangée, nombre impair de cases entre eux), 'diagonal', ou null.
export function opposition(a, b) {
  const df = Math.abs(fileOf(a) - fileOf(b)), dr = Math.abs(rankOf(a) - rankOf(b));
  if ((df === 0 && dr === 2) || (dr === 0 && df === 2)) return 'direct';
  if ((df === 0 && dr % 2 === 0 && dr > 2) || (dr === 0 && df % 2 === 0 && df > 2)) return 'distant';
  if (df === dr && df % 2 === 0) return 'diagonal';
  return null;
}

// Règle du carré : le roi `kingSq` rattrape-t-il le pion `pawnSq` de couleur `pawnColor` ?
// `toMove` est le camp au trait. Ne tient pas compte des obstacles.
export function inSquare(pawnSq, pawnColor, kingSq, toMove) {
  const dir = pawnColor === 'w' ? 1 : -1;
  let r = rankOf(pawnSq);
  const start = pawnColor === 'w' ? 1 : 6;
  if (r === start) r += dir; // le premier pas double compte comme un seul coup
  const promo = pawnColor === 'w' ? 7 : 0;
  const steps = Math.abs(promo - r) - (toMove === pawnColor ? 1 : 0);
  return Math.max(Math.abs(fileOf(kingSq) - fileOf(pawnSq)), Math.abs(rankOf(kingSq) - promo)) <= steps;
}

// ---------- Transformations de FEN (positions « équivalentes ») ----------
function expand(placement) {
  return placement.split('/').map(row => row.replace(/\d/g, d => '.'.repeat(+d)).split(''));
}
function compress(rows) {
  return rows.map(r => r.join('').replace(/\.+/g, m => m.length)).join('/');
}
// Miroir gauche-droite (a ↔ h). Supprime roque et prise en passant.
export function mirrorFiles(fen) {
  const f = fen.split(' ');
  f[0] = compress(expand(f[0]).map(r => r.reverse()));
  f[2] = '-'; f[3] = '-';
  return f.join(' ');
}
// Échange des couleurs : on retourne l'échiquier haut-bas et on inverse blancs et noirs.
export function swapColors(fen) {
  const f = fen.split(' ');
  f[0] = compress(expand(f[0]).reverse().map(r => r.map(c => (c === '.' ? c : c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))));
  f[1] = f[1] === 'w' ? 'b' : 'w';
  f[2] = '-'; f[3] = '-';
  return f.join(' ');
}

// Construit une FEN à partir d'une liste { 'e4': 'K', 'e6': 'p', ... }.
export function fenFrom(placement, turn = 'w') {
  const rows = [...Array(8)].map(() => Array(8).fill('.'));
  for (const [sq, p] of Object.entries(placement)) rows[7 - rankOf(sq)][fileOf(sq)] = p;
  return `${compress(rows)} ${turn} - - 0 1`;
}
