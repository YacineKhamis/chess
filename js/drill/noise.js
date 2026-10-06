// Bruit inerte (spec §3.0.3) : des pièces qui habillent la position sans toucher au motif.
// Une unité est soit un « bélier » (pion blanc en (c, r), pion noir juste devant, r = 2…6),
// soit une « paire » (un cavalier, un fou ou une tour de chaque camp, de même type).
// Une unité n'est gardée que si chaque nouvelle pièce : n'est pas attaquée par l'autre camp,
// n'attaque aucune pièce adverse et n'attaque aucune case de l'empreinte du motif.
// Fonctions pures sur des placements { case: pièce } (majuscule = blanc), utilisables dans Node.
//
// La pose est constructive : on énumère les emplacements qui respectent la règle, puis on tire au hasard
// parmi eux. Ajouter des pièces ne fait que couper des lignes : les attaques calculées avant la pose
// contiennent donc celles d'après (hors attaques des nouvelles pièces, vérifiées une à une).
import { pick, shuffle, shift, sqAt, fileOf, KNIGHT, KING, ROOK_DIRS, BISHOP_DIRS, ALL_SQUARES, int } from './geom.js';

export const isWhite = p => p === p.toUpperCase();
const QUEEN_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];

// Tables précalculées : sauts (cavalier, roi) et rayons (une liste de cases par direction) depuis chaque case.
// Les listes de sauts sont partagées (gelées) : attacksFrom les renvoie telles quelles, sans copie.
const jumps = vecs => Object.fromEntries(ALL_SQUARES.map(sq => [sq, Object.freeze(vecs.map(([f, r]) => shift(sq, f, r)).filter(Boolean))]));
const rays = dirs => Object.fromEntries(ALL_SQUARES.map(sq => [sq, dirs.map(([df, dr]) => {
  const out = [];
  for (let s = shift(sq, df, dr); s; s = shift(s, df, dr)) out.push(s);
  return out;
}).filter(r => r.length)]));
const JUMPS = { n: jumps(KNIGHT), k: jumps(KING) };
const RAYS = { r: rays(ROOK_DIRS), b: rays(BISHOP_DIRS), q: rays(QUEEN_DIRS) };

// Cases attaquées par la pièce posée en `sq` (les lignes s'arrêtent à la première pièce, incluse).
export function attacksFrom(placement, sq, piece = placement[sq]) {
  const t = piece.toLowerCase();
  if (t === 'p') return [-1, 1].map(df => shift(sq, df, isWhite(piece) ? 1 : -1)).filter(Boolean);
  if (t === 'n' || t === 'k') return JUMPS[t][sq];
  const out = [];
  for (const ray of RAYS[t][sq]) for (const s of ray) { out.push(s); if (placement[s]) break; }
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
export function notInert(m, placed, foot) {
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

// La pièce `piece` posée en `sq` serait-elle inerte ? att = attaques actuelles de chaque camp.
function inertAt(m, foot, att, sq, piece) {
  if (m[sq] || foot.has(sq)) return false;
  const white = isWhite(piece);
  if (att[white ? 'b' : 'w'].has(sq)) return false;
  for (const t of attacksFrom(m, sq, piece)) {
    if (foot.has(t)) return false;
    const q = m[t];
    if (q && isWhite(q) !== white) return false;
  }
  return true;
}

const attacks = m => ({ w: attackedBy(m, 'w'), b: attackedBy(m, 'b') });

// Béliers possibles, sur une colonne sans aucun pion (pas de pions empilés : la position reste naturelle).
// Les pions restent au centre de l'échiquier : un pion noir en 3e rangée fausserait l'évaluation.
function ramSpots(m, foot, att) {
  const pawnFiles = new Set(Object.keys(m).filter(s => m[s].toLowerCase() === 'p').map(fileOf));
  const spots = [];
  for (let f = 0; f < 8; f++) {
    if (pawnFiles.has(f)) continue;
    for (let r = 2; r <= 4; r++) {                 // pion blanc en 3e–5e rangée : des pions de milieu de partie
      const a = sqAt(f, r), b = sqAt(f, r + 1);
      if (inertAt(m, foot, att, a, 'P') && inertAt(m, foot, att, b, 'p')) spots.push([a, b]);
    }
  }
  return spots;
}
// Cases possibles pour chaque pièce d'une paire de type `type`. Pour garder une allure de partie,
// chaque pièce reste dans sa moitié de l'échiquier, à une rangée près (pas de cavalier noir en a1).
const pairSpots = (m, foot, att, type) => ({
  W: ALL_SQUARES.filter(s => +s[1] <= 5 && inertAt(m, foot, att, s, type)),
  B: ALL_SQUARES.filter(s => +s[1] >= 4 && inertAt(m, foot, att, s, type.toLowerCase())),
});
// Une paire tirée parmi ces cases, dont les deux pièces ne s'attaquent pas l'une l'autre.
function tryPair(rng, m, { W, B }, type) {
  for (let i = 0; i < 12; i++) {
    const w = pick(rng, W), b = pick(rng, B);
    if (w === b) continue;
    const trial = { ...m, [w]: type, [b]: type.toLowerCase() };
    if (attacksFrom(trial, w).includes(b) || attacksFrom(trial, b).includes(w)) continue;
    return trial;
  }
  return null;
}

/**
 * Ajoute jusqu'à `n` unités inertes au placement.
 * opts.kinds : ['ram', 'pair'] par défaut ; opts.types : types des paires (['N', 'B', 'R']).
 * Renvoie { placement, units } : le nouveau placement (copie) et le nombre d'unités posées.
 * La position reste légale : aucune nouvelle pièce n'attaque le roi adverse, les pions restent
 * sur les rangées 2 à 7 et sont bloqués l'un par l'autre (pas de prise en passant, pas de prise).
 */
export function addNoise(rng, placement, footprint, n, { kinds = ['ram', 'pair'], types = ['N', 'B', 'R'] } = {}) {
  const foot = asSet(footprint);
  let m = { ...placement }, units = 0, cache = null;
  const misses = {};                               // échecs par sorte d'unité : au bout de 3, on n'insiste plus
  const alive = x => (misses[x] || 0) < 3;
  for (let t = 0; t < 4 * n && units < n; t++) {
    const ks = kinds.filter(k => (k === 'ram' ? alive('ram') : types.some(alive)));
    if (!ks.length) break;
    cache ||= { att: attacks(m) };                 // recalculé seulement après une pose réussie
    let next = null, what;
    if (pick(rng, ks) === 'ram') {
      what = 'ram';
      cache.ram ||= ramSpots(m, foot, cache.att);
      if (cache.ram.length) { const [a, b] = pick(rng, cache.ram); next = { ...m, [a]: 'P', [b]: 'p' }; }
    } else {
      what = pick(rng, types.filter(alive));
      const spots = cache[what] ||= pairSpots(m, foot, cache.att, what);
      if (spots.W.length && spots.B.length) next = tryPair(rng, m, spots, what);
    }
    if (next) { m = next; units++; cache = null; } else misses[what] = (misses[what] || 0) + 1;
  }
  return { placement: m, units };
}

const asSet = f => (f instanceof Set ? f : new Set(f || []));

// Pion noir de plus, inerte, doublé derrière le pion noir d'un bélier : rééquilibre le matériel
// quand le motif donne un pion aux Blancs (le pion qui attaque la pièce clouée, par exemple).
export function addBlackPawn(rng, placement, footprint) {
  const foot = asSet(footprint);
  const spots = ALL_SQUARES.filter(s => {
    const below = shift(s, 0, -1), below2 = shift(s, 0, -2);
    return !placement[s] && !foot.has(s) && +s[1] <= 7 && below && placement[below] === 'p' && below2 && placement[below2] === 'P';
  });
  for (const s of shuffle(rng, spots)) {
    const m = { ...placement, [s]: 'p' };
    if (!notInert(m, [s], foot)) return m;
  }
  return null;
}

// Nombre d'unités demandé : un entier ou un intervalle [min, max] tiré au hasard.
export const unitsFor = (rng, spec) => (Array.isArray(spec) ? int(rng, spec[0], spec[1]) : spec || 0);
