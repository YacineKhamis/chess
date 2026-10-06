// Parcours « Mats de base » (spec §3.1) : deux tours, dame, tour, puis les mêmes mats avec des pions bloqués.
import { Chess } from '../../vendor/chess.js';
import { V } from '../drill/verify.js';
import { int, pick, adjacent, onEdge, sqAt, fileOf, rankOf, dist, fenFrom, ALL_SQUARES } from '../drill/geom.js';

const freeSquare = (rng, used, pred = () => true) => {
  for (let i = 0; i < 200; i++) { const s = pick(rng, ALL_SQUARES); if (!used[s] && pred(s)) return s; }
  return null;
};

// Rois et pièces blanches au hasard : rois non adjacents, aucune pièce blanche offerte au roi noir, roi noir pas en échec.
export function randomMatePosition(rng, pieces, { bkPred = s => !onEdge(s), extra = {} } = {}) {
  const used = { ...extra };
  const bk = freeSquare(rng, used, bkPred); if (!bk) return null; used[bk] = 'k';
  const wk = freeSquare(rng, used, s => !adjacent(s, bk) && s !== bk); if (!wk) return null; used[wk] = 'K';
  for (const p of pieces) { const s = freeSquare(rng, used); if (!s) return null; used[s] = p; }
  const fen = fenFrom(used, 'w');
  let c;
  try { c = new Chess(fen); } catch { return null; }
  if (c.isAttacked(bk, 'w')) return null;
  for (const [s, p] of Object.entries(used)) {
    if (p === p.toUpperCase() && p !== 'K' && adjacent(s, bk) && !c.isAttacked(s, 'w')) return null;
  }
  return { fen };
}

// Compatibilité avec l'ancien module Finales.
export function randomPosition(pieces) {
  for (let t = 0; t < 2000; t++) { const c = randomMatePosition(Math.random, pieces); if (c) return c.fen; }
  return '8/8/8/3k4/8/8/8/R3K3 w - - 0 1';
}

const nearEdge = s => Math.min(fileOf(s), 7 - fileOf(s), rankOf(s), 7 - rankOf(s)) <= 1;
const band = (lo, hi) => ({ probe }) => probe.win && probe.strong === 'w' && probe.dist >= lo && probe.dist <= hi;
const anyWin = ({ probe }) => probe.win && probe.strong === 'w';

// Paires de pions bloqués : pion blanc en (f, r), pion noir en (f, r+1), sans prise possible entre eux.
function lockedPairs(rng, k, avoid) {
  const out = {};
  const files = [];
  for (let i = 0; i < 60 && files.length < k; i++) {
    const f = int(rng, 0, 7);
    if (files.includes(f)) continue;
    const r = int(rng, 1, 5); // rangée du pion blanc : 2e à 6e (index 1 à 5)
    const w = sqAt(f, r), b = sqAt(f, r + 1);
    if (avoid[w] || avoid[b] || out[w] || out[b]) continue;
    files.push(f); out[w] = 'P'; out[b] = 'p';
  }
  if (files.length < k) return null;
  // aucune prise pion contre pion
  for (const [s, p] of Object.entries(out)) {
    if (p !== 'P') continue;
    for (const df of [-1, 1]) { const t = sqAt(fileOf(s) + df, rankOf(s) + 1); if (t && out[t] === 'p') return null; }
  }
  return out;
}

function withPawns(piece) {
  return (rng, level) => {
    const k = level + 1;
    const pairs = lockedPairs(rng, k, {});
    if (!pairs) return null;
    const wPawns = Object.keys(pairs).filter(s => pairs[s] === 'P');
    const c = randomMatePosition(rng, [piece], {
      extra: pairs,
      bkPred: s => !onEdge(s) && wPawns.every(p => dist(s, p) >= 3),
    });
    if (!c) return null;
    // la pièce blanche ne doit pas être attaquée par un pion noir
    const ch = new Chess(c.fen);
    const bad = ch.board().flat().some(p => p && p.color === 'w' && (p.type === 'q' || p.type === 'r')
      && ch.attackers(p.square, 'b').some(sq => ch.get(sq).type === 'p'));
    return bad ? null : c;
  };
}

export default [
  {
    id: 'mat-deux-tours', track: 'mats', title: 'Mat avec deux tours', short: 'Deux tours', phase: 'A',
    oracle: 'engine', family: 'krrk', userSide: 'w', goal: { kind: 'mate', guard: 'pieces' }, flip: true, need: 3, prereq: [],
    levels: [{ label: 'Position au hasard' }],
    tip: 'Les tours avancent en escalier : l’une coupe une rangée, l’autre donne échec sur la suivante.',
    ideas: ['ladder', 'rook-far', 'box-shrink'], yardstick: 'engine-mate',
    generate: rng => randomMatePosition(rng, ['R', 'R']),
    verify: V.engineMate({ max: 12 }),
  },
  {
    id: 'mat-dame', track: 'mats', title: 'Mat avec la dame', short: 'Dame', phase: 'A',
    oracle: 'tb', family: 'kqk', userSide: 'w', goal: { kind: 'mate' }, flip: true, need: 3, prereq: [],
    levels: [
      { label: 'Le filet final', gen: { bkPred: nearEdge }, pred: band(1, 3) },
      { label: 'Le dernier carré', gen: { bkPred: nearEdge }, pred: band(4, 6) },
      { label: 'Partie complète', pred: anyWin },
    ],
    tip: 'Place ta dame à un saut de cavalier du roi adverse pour réduire sa cage, puis amène ton roi. Attention au pat.',
    ideas: ['knight-jump', 'box-shrink', 'kqk-edge', 'stalemate-danger', 'mate-every-reply'], yardstick: 'tb-dtm',
    generate(rng, level) { return randomMatePosition(rng, ['Q'], this.levels[level].gen); },
    verify(ctx, c, level) { return V.tb(this.levels[level].pred)(ctx, c, level); },
  },
  {
    id: 'mat-tour', track: 'mats', title: 'Mat avec la tour', short: 'Tour', phase: 'A',
    oracle: 'tb', family: 'krk', userSide: 'w', goal: { kind: 'mate' }, flip: true, need: 3, prereq: [],
    levels: [
      { label: 'Le filet final', gen: { bkPred: nearEdge }, pred: band(1, 3) },
      { label: 'Contre le bord', gen: { bkPred: nearEdge }, pred: band(4, 7) },
      { label: 'Repousser le roi', gen: { bkPred: s => !onEdge(s) }, pred: band(8, 11) },
      { label: 'Partie complète', pred: anyWin },
    ],
    tip: 'La tour coupe le roi adverse ; ton roi vient en opposition ; la tour donne échec quand les rois se font face.',
    ideas: ['cut', 'opposition-check', 'waiting', 'approach-opp', 'rescue', 'preemptive-flee', 'box-shrink'], yardstick: 'tb-dtm',
    generate(rng, level) { return randomMatePosition(rng, ['R'], this.levels[level].gen); },
    verify(ctx, c, level) { return V.tb(this.levels[level].pred)(ctx, c, level); },
  },
  {
    id: 'mat-dame-pions', track: 'mats', title: 'Mat à la dame, pions bloqués', short: 'Dame et pions', phase: 'A',
    oracle: 'engine', family: 'kqk', userSide: 'w', goal: { kind: 'mate', guard: 'pieces' }, flip: true, need: 3,
    prereq: ['mat-dame'], covers: ['mat-dame'],
    levels: [{ label: 'Une paire de pions' }, { label: 'Deux paires' }, { label: 'Trois paires' }],
    tip: 'Les pions bloqués volent des cases au roi… et des coups : le pat arrive plus vite, vérifie-le avant chaque coup calme.',
    ideas: ['stalemate-danger', 'box-shrink', 'knight-jump'], yardstick: 'engine-mate',
    generate: withPawns('Q'),
    verify: V.engineMate({ min: 3, max: 15 }),
  },
  {
    id: 'mat-tour-pions', track: 'mats', title: 'Mat à la tour, pions bloqués', short: 'Tour et pions', phase: 'A',
    oracle: 'engine', family: 'krk', userSide: 'w', goal: { kind: 'mate', guard: 'pieces' }, flip: true, need: 3,
    prereq: ['mat-tour', 'mat-dame-pions'], covers: ['mat-tour'],
    levels: [{ label: 'Une paire de pions' }, { label: 'Deux paires' }, { label: 'Trois paires' }],
    tip: 'Un pion peut couper ta tour : choisis des colonnes et rangées libres pour enfermer le roi.',
    ideas: ['cut', 'box-shrink', 'opposition-check'], yardstick: 'engine-mate',
    generate: withPawns('R'),
    verify: V.engineMate({ min: 3, max: 20 }),
  },
];
