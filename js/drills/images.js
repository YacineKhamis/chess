// Parcours « Images de mat » (spec §3.6) : mat du couloir, mat à l'étouffée, batterie dame-fou sur h7.
// Recette : poser l'image finale, retirer la pièce qui mate et la replacer sur une case d'origine
// d'où elle atteint la case de mat par une ligne libre, sans donner échec. Vérification : V.mate({ n }).
import { Chess } from '../../vendor/chess.js';
import { V } from '../drill/verify.js';
import { int, pick, shift, sqAt, fileOf, rankOf, between, fenFrom, knightTargets, kingTargets, FILES } from '../drill/geom.js';
import { addNoise, attacksFrom, isAttacked, unitsFor } from '../drill/noise.js';

const box = sq => [sq, ...kingTargets(sq)];
const retry = (n, fn) => { for (let i = 0; i < n; i++) { const c = fn(); if (c) return c; } return null; };
const legal = fen => { try { return new Chess(fen); } catch { return null; } };
const files = pred => [0, 1, 2, 3, 4, 5, 6, 7].filter(pred);

// Bruit du niveau (L.noise = [min, max]) : accepté dès min unités posées.
function dress(rng, m, foot, L) {
  if (!L.noise) return m;
  const min = Array.isArray(L.noise) ? L.noise[0] : L.noise;
  const r = addNoise(rng, m, foot, unitsFor(rng, L.noise));
  return r.units >= min ? r.placement : null;
}
// Position légale, Blancs au trait, aucun roi en échec.
function finish(m) {
  const fen = fenFrom(m, 'w');
  const c = legal(fen);
  if (!c || c.isCheck() || c.isGameOver()) return null;
  const bk = Object.keys(m).find(s => m[s] === 'k');
  return c.isAttacked(bk, 'w') ? null : fen;
}
// Roi blanc sur la 1re rangée et pions devant lui (chacun présent avec la probabilité p).
function whiteCastle(rng, m, { file = int(rng, 0, 7), p = 0.7 } = {}) {
  const K = sqAt(file, 0);
  if (m[K]) return null;
  m[K] = 'K';
  for (const df of [-1, 0, 1]) { const s = sqAt(file + df, 1); if (s && !m[s] && rng() < p) m[s] = 'P'; }
  return K;
}
// n du mat selon le niveau (but « mat en n » qui change d'un niveau à l'autre).
const mateN = levels => st => levels[st.level]?.n ?? st.ref ?? 1;

const SHARED = { track: 'images', phase: 'A', oracle: 'engine', family: 'mate-pic', userSide: 'w', flip: true,
  s0: { allowCaptures: true }, yardstick: 'mate-n' };

// ---------- I1 · Mat du couloir ----------
// L1–L2, mat en 1 : roi noir sur la 8e rangée derrière ses pions, tour (ou dame) blanche sur une colonne
// à deux colonnes au moins du roi, chemin libre jusqu'à la 8e rangée.
function couloir1(rng, L, sub) {
  const kf = int(rng, 0, 7), k = sqAt(kf, 7), m = { [k]: 'k' };
  const shell = files(f => Math.abs(f - kf) <= 1).map(f => sqAt(f, 6));
  shell.forEach(s => { m[s] = 'p'; });
  const af = pick(rng, files(f => Math.abs(f - kf) >= 2));
  const H = sqAt(af, int(rng, 1, 4)), to = sqAt(af, 7);
  m[H] = sub === 'dame' ? 'Q' : 'R';
  const K = whiteCastle(rng, m);
  if (!K || between(H, to).some(s => m[s])) return null;
  const foot = new Set([...box(k), ...files(() => true).map(f => sqAt(f, 7)), H, ...between(H, to), ...shell, ...box(K)]);
  const d = dress(rng, m, foot, L);
  const fen = d && finish(d);
  if (!fen) return null;
  return { fen, key: H + to, roles: { piece: H, to, king: k, shell, line: between(to, k) } };
}
// L3, mat en 2 : un défenseur noir (tour, parfois dame) garde la 8e rangée ; deux pièces lourdes blanches
// doublées sur une colonne. La première attaque la case de mat, le défenseur doit prendre, la seconde reprend
// et mate. Le défenseur est au-delà de la colonne d'attaque : il ne peut que prendre (pas s'interposer).
function couloir2(rng, L, sub) {
  const kf = int(rng, 0, 7), k = sqAt(kf, 7), m = { [k]: 'k' };
  const shell = files(f => Math.abs(f - kf) <= 1).map(f => sqAt(f, 6));
  shell.forEach(s => { m[s] = 'p'; });
  const af = pick(rng, files(f => Math.abs(f - kf) >= 2));
  const side = Math.sign(af - kf);
  const df = pick(rng, files(f => Math.sign(f - af) === side));   // au-delà de la colonne d'attaque
  if (df === undefined) return null;
  const D = sqAt(df, 7), to = sqAt(af, 7);
  m[D] = rng() < 2 / 3 ? 'r' : 'q';
  const r1 = int(rng, 2, 4), r2 = int(rng, 1, r1 - 1);
  const front = sqAt(af, r1), back = sqAt(af, r2);
  m[front] = sub === 'dame-tour' ? 'Q' : 'R';
  m[back] = 'R';
  const K = whiteCastle(rng, m, { p: 1, file: pick(rng, files(f => f !== af)) });
  if (!K || between(front, to).some(s => m[s])) return null;
  if (isAttacked(m, D, 'w') || isAttacked(m, front, 'b')) return null;
  const foot = new Set([...box(k), ...files(() => true).map(f => sqAt(f, 7)), front, back, ...between(back, to), ...shell, ...box(K)]);
  const d = dress(rng, m, foot, L);
  const fen = d && finish(d);
  if (!fen) return null;
  return { fen, key: front + to, roles: { piece: front, to, king: k, defender: D, second: back, shell, line: between(to, k) } };
}
const COULOIR = [
  { label: 'Mat en 1', n: 1, gen: couloir1, noise: 0, tries: 60 },
  { label: 'Mat en 1, avec d’autres pièces', n: 1, gen: couloir1, noise: [3, 5], tries: 60 },
  { label: 'Mat en 2 : le défenseur de la rangée', n: 2, gen: couloir2, noise: 0, tries: 60 },
];

// ---------- I2 · Mat à l'étouffée ----------
// L1–L2, mat en 1 : roi noir h8 bloqué par une pièce en g8 et ses pions g7 h7 ; le cavalier blanc vient en f7.
// (Un fou en g8 défendrait f7 : la pièce de g8 est une tour ou un cavalier.)
function etouffe1(rng, L, sub) {
  const m = { h8: 'k', g8: sub === 'cavalier' ? 'n' : 'r', g7: 'p', h7: 'p' };
  const n = pick(rng, knightTargets('f7').filter(s => !m[s]));
  m[n] = 'N';
  const K = pick(rng, files(() => true).flatMap(f => [0, 1, 2].map(r => sqAt(f, r))).filter(s => !m[s]));
  m[K] = 'K';
  const foot = new Set([...box('h8'), 'f7', 'f8', 'f6', 'g6', n, ...knightTargets('f7'), ...box(K)]);
  const d = dress(rng, m, foot, L);
  if (!d || isAttacked(d, 'f7', 'b')) return null;
  const fen = finish(d);
  if (!fen) return null;
  return { fen, key: n + 'f7', roles: { piece: n, to: 'f7', king: 'h8', blockers: ['g8', 'g7', 'h7'] } };
}
// L3, « le legs de Philidor », mat en 2 : cavalier h6, dame sur la diagonale a2–g8, tour noire sur la 8e rangée.
// Dg8+ ! Txg8 (le roi ne peut pas prendre : le cavalier garde g8), Cf7 mat.
function etouffe2(rng, L) {
  const m = { h8: 'k', g7: 'p', h7: 'p', h6: 'N' };
  const R = sqAt(int(rng, 0, 5), 7);
  m[R] = 'r';
  const Q = pick(rng, ['a2', 'b3', 'c4', 'd5', 'e6']);
  m[Q] = 'Q';
  const K = whiteCastle(rng, m, { file: pick(rng, [1, 2, 4, 5, 6, 7]) });
  if (!K) return null;
  for (let i = int(rng, 0, 2); i > 0; i--) { const s = sqAt(int(rng, 0, 5), int(rng, 4, 5)); if (!m[s]) m[s] = 'p'; }
  if (between(Q, 'g8').some(s => m[s]) || between(R, 'g8').some(s => m[s]) || isAttacked(m, Q, 'b')) return null;
  const foot = new Set([...box('h8'), 'f7', 'h6', Q, R, ...between(Q, 'g8'), ...between(R, 'g8'), ...box(K)]);
  const d = dress(rng, m, foot, L);
  const fen = d && finish(d);
  if (!fen) return null;
  return { fen, key: Q + 'g8', roles: { piece: Q, to: 'g8', king: 'h8', knight: 'h6', mate: 'f7', defender: R, blockers: ['g7', 'h7'] } };
}
const ETOUFFE = [
  { label: 'Mat en 1', n: 1, gen: etouffe1, noise: 0, tries: 60 },
  { label: 'Mat en 1, avec d’autres pièces', n: 1, gen: etouffe1, noise: [3, 5], tries: 60 },
  { label: 'Le legs de Philidor : mat en 2', n: 2, gen: etouffe2, noise: 0, tries: 60 },
];

// ---------- I3 · Batterie dame-fou sur h7 ----------
// Roi noir g8, tour f8, pions f7 g7 (et h7 une fois sur deux : la clé est alors Dxh7). Fou blanc sur la
// diagonale b1–h7, chemin libre ; la dame blanche rejoint h7 par une autre ligne libre.
function dameFou(rng, L, sub) {
  const m = { g8: 'k', f8: 'r', f7: 'p', g7: 'p' };
  if (sub === 'pion-h7') m.h7 = 'p';
  const B = pick(rng, ['b1', 'c2', 'd3', 'e4', 'f5']);
  m[B] = 'B';
  const K = whiteCastle(rng, m, { file: 6 });
  if (!K || between(B, 'h7').some(s => m[s])) return null;
  const Q = pick(rng, attacksFrom(m, 'h7', 'Q').filter(s => !m[s] && s !== 'h8' && !between(B, 'h7').includes(s)));
  if (!Q) return null;
  m[Q] = 'Q';
  const foot = new Set([...box('g8'), 'h7', B, Q, ...between(B, 'h7'), ...between(Q, 'h7'), ...box(K)]);
  const d = dress(rng, m, foot, L);
  const fen = d && finish(d);
  if (!fen) return null;
  return { fen, key: Q + 'h7', roles: { piece: Q, to: 'h7', king: 'g8', support: B, line: between(B, 'h7') } };
}

export default [
  {
    ...SHARED, id: 'mat-couloir', title: 'Mat du couloir', short: 'Couloir', need: 3,
    goal: { kind: 'mate', n: mateN(COULOIR) }, prereq: [], contrast: ['parer-couloir'],
    levels: COULOIR,
    strata: level => (level < 2 ? ['tour', 'tour', 'dame'] : ['tours', 'dame-tour']),
    tip: 'Roi enfermé derrière ses pions sur la dernière rangée : une tour ou une dame qui y arrive mate.',
    ideas: ['mate', 'deflection'],
    generate(rng, level, sub) { const L = this.levels[level]; return retry(300, () => L.gen(rng, L, sub)); },
    verify(ctx, c, level) { return V.mate({ n: this.levels[level].n })(ctx, c, level); },
  },
  {
    ...SHARED, id: 'mat-etouffe', title: 'Mat à l’étouffée', short: 'Étouffé', need: 3,
    goal: { kind: 'mate', n: mateN(ETOUFFE) }, prereq: ['mat-couloir'],
    levels: ETOUFFE,
    strata: level => (level < 2 ? ['tour', 'cavalier'] : null),
    tip: 'Un roi bloqué par ses propres pièces : un échec de cavalier suffit.',
    ideas: ['mate', 'attraction'],
    generate(rng, level, sub) { const L = this.levels[level]; return retry(300, () => L.gen(rng, L, sub)); },
    verify(ctx, c, level) { return V.mate({ n: this.levels[level].n })(ctx, c, level); },
  },
  {
    ...SHARED, id: 'mat-dame-fou', title: 'Batterie dame-fou sur h7', short: 'Dame-fou', need: 5,
    goal: { kind: 'mate', n: 1 }, prereq: ['mat-couloir'],
    levels: [
      { label: 'L’image seule', noise: 0, tries: 60 },
      { label: 'Avec quelques pièces autour', noise: [3, 5], tries: 60 },
      { label: 'Cachée parmi d’autres pièces', noise: [5, 8], tries: 60 },
    ],
    strata: () => ['pion-h7', 'h7-vide'],
    tip: 'Dame et fou sur la même diagonale visent h7 : la dame mate, protégée par le fou.',
    ideas: ['mate', 'battery'],
    generate(rng, level, sub) { return retry(300, () => dameFou(rng, this.levels[level], sub)); },
    verify: (ctx, c) => V.mate({ n: 1 })(ctx, c),
  },
];
