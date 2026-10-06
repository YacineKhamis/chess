// Parcours « Motifs tactiques » (spec §3.5) : pièce en prise, fourchette royale, enfilade, clouage.
// Chaque générateur pose le motif (gabarit), puis du lest et du bruit inertes (§3.0.3), et donne
// le coup clé, les cases utiles aux indices (roles) et l'empreinte que le bruit ne doit pas toucher.
import { Chess } from '../../vendor/chess.js';
import { V } from '../drill/verify.js';
import { int, pick, shift, sqAt, fileOf, rankOf, dist, between, fenFrom, knightTargets, kingTargets, ALL_SQUARES } from '../drill/geom.js';
import { addNoise, attacksFrom, isAttacked, unitsFor } from '../drill/noise.js';
import { VALUE } from '../analysis.js';

// ---------- Outils communs ----------
const box = sq => [sq, ...kingTargets(sq)];
const free = (m, pred = () => true) => ALL_SQUARES.filter(s => !m[s] && pred(s));
const whiteAttackers = (m, sq) => Object.keys(m).filter(s => m[s] === m[s].toUpperCase() && attacksFrom(m, s).includes(sq));
// Essaie `fn` jusqu'à `n` fois : les rejets statiques ne coûtent rien, seul le candidat retenu passe au moteur.
const retry = (n, fn) => { for (let i = 0; i < n; i++) { const c = fn(); if (c) return c; } return null; };
const legal = fen => { try { return new Chess(fen); } catch { return null; } };

// Lest (béliers de pions) puis bruit du niveau, autour de l'empreinte du motif.
// Le lest donne du sens à l'évaluation : sans pions, « une pièce de plus » vaut souvent nulle (R+C contre R).
export function dress(rng, m, foot, L) {
  let out = m;
  const want = unitsFor(rng, L.ballast);
  if (want) {
    const r = addNoise(rng, out, foot, want, { kinds: ['ram'] });
    if (r.units < want) return null;
    out = r.placement;
  }
  const n = unitsFor(rng, L.noise);
  if (n) {
    const r = addNoise(rng, out, foot, n);
    if (r.units < n) return null;
    out = r.placement;
  }
  return out;
}

// Contrôles communs : position légale, Blancs au trait sans échec, roi noir pas en échec, au moins 2 coups.
function finish(m) {
  const fen = fenFrom(m, 'w');
  const c = legal(fen);
  if (!c || c.isCheck() || c.moves().length < 2) return null;
  const bk = Object.keys(m).find(s => m[s] === 'k');
  if (c.isAttacked(bk, 'w')) return null;
  return { fen, chess: c };
}

const LEVELS = [
  { label: 'Le motif seul', ballast: 2, noise: 0, tries: 60 },
  { label: 'Avec quelques pièces autour', ballast: 1, noise: [3, 5], tries: 60 },
  { label: 'Caché parmi d’autres pièces', ballast: 1, noise: [5, 8], tries: 60 },
];
const SHARED = {
  track: 'tactique', phase: 'A', oracle: 'engine', userSide: 'w', flip: true, need: 5,
  s0: { allowCaptures: true }, yardstick: 'gain',
};

// ---------- T1 · Pièce en prise ----------
// Une pièce noire X (la strate) non défendue, attaquée par une seule pièce blanche Y.
// Leurres (L2–L3) : une pièce mineure noire défendue par un pion, attaquée par une dame ou une tour blanche.
function genHanging(rng, L, sub) {
  const m = {};
  const K = sqAt(int(rng, 0, 7), int(rng, 0, 1)), k = sqAt(int(rng, 0, 7), int(rng, 6, 7));
  m[K] = 'K'; m[k] = 'k';
  const X = sub || pick(rng, ['n', 'b', 'r', 'q']);
  const xs = sqAt(int(rng, 0, 7), int(rng, 2, 5));
  if (m[xs]) return null;
  m[xs] = X;
  const Y = pick(rng, ['N', 'B', 'R', 'Q']);
  const ys = pick(rng, attacksFrom(m, xs, Y).filter(s => !m[s] && rankOf(s) < 7));
  if (!ys) return null;
  m[ys] = Y;
  const foot = new Set([...box(k), ...box(K), xs, ys, ...(between(ys, xs) || [])]);
  const decoys = [];
  for (let i = 0, nd = unitsFor(rng, L.decoys); i < nd; i++) {
    const ds = sqAt(int(rng, 1, 6), int(rng, 2, 5));
    const ps = shift(ds, pick(rng, [-1, 1]), 1);
    if (m[ds] || !ps || m[ps]) return null;
    m[ds] = pick(rng, ['n', 'b']); m[ps] = 'p';
    const A = pick(rng, ['Q', 'R']);
    const as = pick(rng, attacksFrom(m, ds, A).filter(s => !m[s] && rankOf(s) < 7 && rankOf(s) > 0));
    if (!as) return null;
    m[as] = A;
    decoys.push(ds);
    [ds, ps, as, ...(between(as, ds) || [])].forEach(s => foot.add(s));
  }
  const d = dress(rng, m, foot, L);
  if (!d) return null;
  // X : aucun défenseur, un seul attaquant ; aucune pièce blanche attaquée ; leurres bien défendus.
  if (isAttacked(d, xs, 'b') || whiteAttackers(d, xs).length !== 1) return null;
  if (Object.keys(d).some(s => d[s] !== 'K' && d[s] === d[s].toUpperCase() && isAttacked(d, s, 'b'))) return null;
  if (decoys.some(s => !isAttacked(d, s, 'b'))) return null;
  const f = finish(d);
  if (!f) return null;
  return { fen: f.fen, key: ys + xs, roles: { piece: ys, to: xs, targets: [xs], decoys, gain: VALUE[X] } };
}

// ---------- T2 · Fourchette royale du cavalier ----------
// Roi noir, case de fourchette f à un saut de cavalier, cible T (dame ou tour) à un autre saut de f,
// cavalier blanc à un troisième saut de f. La case f n'est pas attaquée par les Noirs.
const CENTRE = s => fileOf(s) >= 2 && fileOf(s) <= 5 && rankOf(s) >= 2 && rankOf(s) <= 5;
function genFork(rng, L, sub) {
  const [T, zone] = (sub || pick(rng, FORK_STRATA)).split('-');
  const k = pick(rng, ALL_SQUARES.filter(s => fileOf(s) >= 1 && fileOf(s) <= 6 && rankOf(s) >= 1 && rankOf(s) <= 6
    && (zone === 'centre') === CENTRE(s)));
  const f = pick(rng, knightTargets(k));
  const t = pick(rng, knightTargets(f).filter(s => s !== k));
  const n = pick(rng, knightTargets(f).filter(s => s !== k && s !== t));
  if (!t || !n || knightTargets(n).includes(t) || knightTargets(n).includes(k)) return null;
  const m = { [k]: 'k', [t]: T, [n]: 'N' };
  const K = pick(rng, free(m, s => dist(s, k) >= 2 && dist(s, t) >= 2));
  if (!K) return null;
  m[K] = 'K';
  const foot = new Set([...box(k), f, t, n, K]);
  const d = dress(rng, m, foot, L);
  if (!d || isAttacked(d, f, 'b')) return null;
  const fin = finish(d);
  if (!fin) return null;
  return { fen: fin.fen, key: n + f, roles: { piece: n, to: f, targets: [k, t], gain: VALUE[T] - 3 } };
}
const FORK_STRATA = ['q-centre', 'q-bord', 'r-centre', 'r-bord'];

// ---------- T3 · Enfilade ----------
// Roi et dame noirs sur une rangée ou une colonne ; la tour blanche fait échec sur cette ligne
// depuis une case cs de l'autre côté du roi ; le roi s'écarte, la dame tombe.
function genSkewer(rng, L, sub) {
  const [kind, g] = (sub || pick(rng, SKEWER_STRATA)).split('-');
  const horiz = kind === 'rangee';
  const at = (a, line) => (horiz ? sqAt(a, line) : sqAt(line, a));
  const line = int(rng, 1, 6), gap = g === '1' ? 1 : int(rng, 2, 3), dir = pick(rng, [-1, 1]), dcs = int(rng, 2, 4);
  const a = int(rng, 0, 7);
  const k = at(a, line), q = at(a + dir * gap, line), cs = at(a - dir * dcs, line);
  if (!k || !q || !cs) return null;
  // Tour sur la perpendiculaire passant par cs, à 2 cases au moins de cs.
  const ra = pick(rng, [0, 1, 2, 3, 4, 5, 6, 7].filter(x => Math.abs(x - line) >= 2));
  const R = horiz ? sqAt(fileOf(cs), ra) : sqAt(ra, rankOf(cs));
  const m = { [k]: 'k', [q]: 'q', [R]: 'R' };
  const K = pick(rng, free(m, s => dist(s, k) >= 2 && !between(R, cs).includes(s) && !between(cs, k).includes(s) && s !== cs));
  if (!K) return null;
  m[K] = 'K';
  const lineSq = [cs, ...between(cs, k), k, ...between(k, q), q];
  const foot = new Set([...box(k), ...lineSq, R, ...between(R, cs), K]);
  const d = dress(rng, m, foot, L);
  if (!d) return null;
  if (isAttacked(d, cs, 'b') || isAttacked(d, R, 'b')) return null;
  const fin = finish(d);
  if (!fin) return null;
  return { fen: fin.fen, key: R + cs, roles: { piece: R, to: cs, targets: [k, q], line: lineSq, gain: 4 } };
}
const SKEWER_STRATA = ['rangee-1', 'rangee-2', 'colonne-1', 'colonne-2'];

// ---------- T4 · Exploiter le clouage ----------
// Une pièce noire P (cavalier ou tour) clouée en diagonale sur son roi par un fou blanc ;
// un pion blanc avance d'une case pour l'attaquer. P ne peut ni fuir ni prendre le pion.
function genPin(rng, L, sub) {
  const P = sub || pick(rng, ['n', 'r']);
  const k = sqAt(int(rng, 2, 5), int(rng, 5, 7));
  const dx = pick(rng, [-1, 1]), d1 = int(rng, 1, 2), d2 = d1 + int(rng, 1, 3);
  const p = shift(k, dx * d1, -d1), B = shift(k, dx * d2, -d2);
  if (!p || !B) return null;
  // Le pion vient du côté opposé à la ligne de clouage, pour ne pas la couper.
  const po = shift(p, -dx, -2), push = shift(p, -dx, -1);
  if (!po || rankOf(po) < 1) return null;
  const m = { [k]: 'k', [p]: P, [B]: 'B', [po]: 'P' };
  if (Object.keys(m).length !== 4 || m[push]) return null;
  let guard = null;
  if (d1 === 2) { // à deux cases du roi, la pièce clouée doit être défendue, sinon le fou la prend tout de suite
    guard = shift(p, dx, 1);
    if (!guard || m[guard] || rankOf(guard) > 6) return null;
    m[guard] = 'p';
  }
  const K = pick(rng, free(m, s => dist(s, k) >= 2 && s !== push && !(between(k, B) || []).includes(s)));
  if (!K) return null;
  m[K] = 'K';
  const pin = between(k, B);
  const foot = new Set([...box(k), p, B, po, push, ...pin, K, ...(guard ? [guard] : [])]);
  const d = dress(rng, m, foot, L);
  if (!d) return null;
  if (isAttacked(d, push, 'b') && !isAttacked(d, push, 'w')) return null;
  if (isAttacked(d, B, 'b')) return null;
  const fin = finish(d);
  if (!fin) return null;
  return { fen: fin.fen, key: po + push, roles: { piece: po, to: push, pinned: p, pinner: B, targets: [p], line: [B, ...pin, k], gain: 2 } };
}

export default [
  {
    ...SHARED, id: 'piece-en-prise', title: 'Pièce en prise', short: 'En prise', family: 'tactic:hanging',
    goal: { kind: 'material', gain: st => st.start.roles?.gain ?? 3, within: 2 }, prereq: [],
    levels: [
      { ...LEVELS[0], decoys: 0 },
      { ...LEVELS[1], decoys: 1 },
      { ...LEVELS[2], decoys: [1, 2] },
    ],
    strata: () => ['n', 'b', 'r', 'q'],
    tip: 'Avant tout, regarde ce que l’adversaire laisse sans défense. Mais une pièce protégée par un pion n’est pas un cadeau.',
    ideas: ['hanging-take'],
    generate(rng, level, sub) { return retry(300, () => genHanging(rng, this.levels[level], sub)); },
    verify: (ctx, c, level) => V.mat({ gap: 200 })(ctx, c, level),
  },
  {
    ...SHARED, id: 'fourchette-cavalier', title: 'Fourchette royale du cavalier', short: 'Fourchette', family: 'tactic:fork',
    goal: { kind: 'material', gain: st => st.start.roles?.gain ?? 2, within: 3 }, prereq: ['piece-en-prise'],
    levels: LEVELS,
    strata: () => FORK_STRATA,
    tip: 'Cherche une case d’où ton cavalier attaquerait le roi et une grosse pièce à la fois : avec échec, c’est imparable.',
    ideas: ['fork'],
    generate(rng, level, sub) { return retry(300, () => genFork(rng, this.levels[level], sub)); },
    verify: (ctx, c, level) => V.mat()(ctx, c, level),
  },
  {
    ...SHARED, id: 'enfilade', title: 'Enfilade', short: 'Enfilade', family: 'tactic:skewer',
    goal: { kind: 'material', gain: 4, within: 3 }, prereq: ['piece-en-prise'],
    levels: LEVELS,
    strata: () => SKEWER_STRATA,
    tip: 'Roi et pièce alignés : fais échec sur la ligne, le roi s’écarte et la pièce derrière lui tombe.',
    ideas: ['skewer'],
    generate(rng, level, sub) { return retry(300, () => genSkewer(rng, this.levels[level], sub)); },
    verify: (ctx, c, level) => V.mat()(ctx, c, level),
  },
  {
    ...SHARED, id: 'clouage', title: 'Exploiter le clouage', short: 'Clouage', family: 'tactic:pin',
    goal: { kind: 'material', gain: 2, within: 3 }, prereq: ['piece-en-prise'],
    levels: LEVELS,
    strata: () => ['n', 'r'],
    tip: 'Une pièce clouée devant son roi ne peut pas fuir : attaque-la avec moins cher qu’elle, un pion par exemple.',
    ideas: ['pin'],
    generate(rng, level, sub) { return retry(300, () => genPin(rng, this.levels[level], sub)); },
    verify: (ctx, c, level) => V.mat()(ctx, c, level),
  },
];
