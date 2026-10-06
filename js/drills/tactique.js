// Parcours « Motifs tactiques » (spec §3.5) : pièce en prise, fourchette royale, enfilade, clouage.
// Chaque générateur pose le motif (gabarit), puis du lest et du bruit inertes (§3.0.3), et donne
// le coup clé, les cases utiles aux indices (roles) et l'empreinte que le bruit ne doit pas toucher.
// Les cases sont choisies parmi celles qui conviennent (pose constructive) : les rejets restent rares
// et le générateur reste rapide même aux paliers chargés.
import { Chess } from '../../vendor/chess.js';
import { V } from '../drill/verify.js';
import { int, pick, shuffle, shift, sqAt, fileOf, rankOf, dist, between, fenFrom, knightTargets, kingTargets, ALL_SQUARES } from '../drill/geom.js';
import { addNoise, addBlackPawn, attacksFrom, isAttacked, isWhite, unitsFor } from '../drill/noise.js';
import { VALUE } from '../analysis.js';

// ---------- Outils communs ----------
const box = sq => [sq, ...kingTargets(sq)];
const free = (m, pred = () => true) => ALL_SQUARES.filter(s => !m[s] && pred(s));
const line = (a, b) => between(a, b) || [];
// Essaie `fn` jusqu'à `n` fois : les rejets statiques ne coûtent rien, seul le candidat retenu passe au moteur.
const retry = (n, fn) => { for (let i = 0; i < n; i++) { const c = fn(); if (c) return c; } return null; };
const legal = fen => { try { return new Chess(fen); } catch { return null; } };
// La pièce blanche P posée en s : pas attaquée par les Noirs et pas d'échec au roi noir k.
const safeWhite = (m, s, P, k) => {
  const t = { ...m, [s]: P };
  return !isAttacked(t, s, 'b') && !attacksFrom(t, s, P).includes(k);
};
// Pièces noires attaquées par la pièce posée en s.
const blackTargets = (m, s) => attacksFrom(m, s).filter(t => m[t] && !isWhite(m[t]));

// Lest puis bruit du niveau, autour de l'empreinte du motif. Le lest (béliers de pions, parfois une paire
// de pièces mineures) donne du sens à l'évaluation : sans lui, « une pièce de plus » vaut souvent nulle
// (roi et cavalier contre roi) et toute finale de pions gagnée écrase l'écart entre les coups.
// L.noise = [min, max] : on vise un nombre au hasard dans l'intervalle et on accepte dès min unités posées.
export function dress(rng, m, foot, L, { ballast = L.ballast, pairs = L.pairs } = {}) {
  let out = m;
  for (const [want, opts] of [[ballast, { kinds: ['ram'] }], [pairs, { kinds: ['pair'], types: ['N', 'B'] }]]) {
    if (!want) continue;
    const r = addNoise(rng, out, foot, want, opts);
    if (r.units < want) return null;
    out = r.placement;
  }
  if (L.noise) {
    const min = Array.isArray(L.noise) ? L.noise[0] : L.noise;
    const r = addNoise(rng, out, foot, unitsFor(rng, L.noise));
    if (r.units < min) return null;
    out = r.placement;
  }
  return out;
}

// Contrôles communs : position légale, Blancs au trait sans échec, roi noir pas en échec, au moins 2 coups,
// et coup clé légal (une pièce du motif peut être clouée sur son propre roi : le cavalier par la dame visée).
function finish(m, key) {
  const fen = fenFrom(m, 'w');
  const c = legal(fen);
  if (!c || c.isCheck() || c.moves().length < 2) return null;
  const bk = Object.keys(m).find(s => m[s] === 'k');
  if (c.isAttacked(bk, 'w')) return null;
  if (!c.moves({ square: key.slice(0, 2), verbose: true }).some(mv => mv.to === key.slice(2, 4))) return null;
  return { fen, chess: c };
}

// Tri rapide avant V.mat : une recherche à profondeur 6 écarte les candidats où le coup clé n'est ni
// premier avec un peu d'avance, ni deuxième tout près du premier. Elle ne remplace pas V.mat, qui reste
// seul juge ; elle évite seulement de payer une recherche complète pour un candidat sans espoir
// (mesuré au palier 3 du clouage : temps par position acceptée divisé par 4, 1 position bonne sur 13 perdue).
async function quick(ctx, c) {
  const [b, s] = await ctx.engine.analyse(c.fen, { depth: 6, multipv: 2 });
  if (!b) return false;
  const key = c.key.slice(0, 4), gap = s ? b.cp - s.cp : Infinity;
  if (b.move.slice(0, 4) === key) return b.mate == null && gap >= 50;
  return !!s && s.move.slice(0, 4) === key && gap <= 60;
}
const checked = (opts = {}) => async (ctx, c, level) => ((await quick(ctx, c)) ? V.mat(opts)(ctx, c, level) : null);

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
// Leurres (L2–L3) : une pièce mineure noire défendue par un pion, attaquée par une tour blanche
// (ou une dame quand X est une tour ou une dame) : la prendre perd du matériel.
// Un échec « gratuit » (la pièce qui donne échec n'est pas prise) rapporterait autant que la clé, puisque X
// reste en prise : on écarte ces positions.
const freeChecks = (chess, key) => chess.moves({ verbose: true })
  .some(mv => mv.san.includes('+') && mv.from + mv.to !== key && !chess.isAttacked(mv.to, 'b'));

// Leurre : pièce D en ds défendue par un pion en ps, attaquée par A (tour ou dame) en as.
// Ni D ni son pion n'attaquent de pièce blanche ni ne défendent X ; A n'attaque que le leurre.
function placeDecoy(rng, m, foot, xs, k, A) {
  for (let t = 0; t < 20; t++) {
    const D = pick(rng, ['n', 'b']);
    const ds = sqAt(int(rng, 1, 6), int(rng, 2, 5)), ps = shift(ds, pick(rng, [-1, 1]), 1);
    if (m[ds] || foot.has(ds) || !ps || m[ps] || foot.has(ps)) continue;
    const m2 = { ...m, [ds]: D, [ps]: 'p' };
    // Le leurre et son pion : n'attaquent aucune pièce blanche, ne défendent pas X, et ne sont pas déjà attaqués.
    const hits = [...attacksFrom(m2, ds), ...attacksFrom(m2, ps)];
    if (hits.some(s => s === xs || (m2[s] && isWhite(m2[s])))) continue;
    if (isAttacked(m2, ds, 'w') || isAttacked(m2, ps, 'w')) continue;
    const spots = attacksFrom(m2, ds, A).filter(s => !m2[s] && !foot.has(s) && rankOf(s) > 0 && rankOf(s) < 7 && safeWhite(m2, s, A, k));
    const as = pick(rng, spots.filter(s => { const t3 = { ...m2, [s]: A }; return blackTargets(t3, s).join() === ds; }));
    if (!as) continue;
    return { m: { ...m2, [as]: A }, ds, ps, as };
  }
  return null;
}

function genHanging(rng, L, sub) {
  const K = sqAt(int(rng, 0, 7), int(rng, 0, 1)), k = sqAt(int(rng, 0, 7), int(rng, 6, 7));
  let m = { [K]: 'K', [k]: 'k' };
  const X = sub || pick(rng, ['n', 'b', 'r', 'q']);
  // X loin des deux rois (ni défendue par le sien, ni prenable par le roi blanc), sans attaquer le roi blanc.
  const xs = pick(rng, free(m, s => rankOf(s) >= 2 && rankOf(s) <= 5 && dist(s, k) >= 2 && dist(s, K) >= 2
    && !attacksFrom(m, s, X).includes(K)));
  if (!xs) return null;
  m[xs] = X;
  // L'attaquant : une case d'où il attaque X, sans être attaqué lui-même et sans faire échec.
  let Y = null, ys = null;
  for (const T of shuffle(rng, ['N', 'B', 'R', 'Q'])) {
    const spots = attacksFrom(m, xs, T).filter(s => !m[s] && rankOf(s) < 7 && safeWhite(m, s, T, k));
    if (spots.length) { Y = T; ys = pick(rng, spots); break; }
  }
  if (!ys) return null;
  m[ys] = Y;
  const foot = new Set([...box(k), ...box(K), xs, ys, ...line(ys, xs)]);
  const decoys = [], allowed = new Set([ys + xs]);
  let extra = 0;                                   // matériel offert aux Blancs par les leurres
  for (let i = 0, nd = unitsFor(rng, L.decoys); i < nd; i++) {
    const A = VALUE[X] >= 5 && !Object.values(m).includes('Q') && rng() < 0.5 ? 'Q' : 'R';
    const d = placeDecoy(rng, m, foot, xs, k, A);
    if (!d) return null;
    m = d.m;
    extra += VALUE[A.toLowerCase()] - 4;
    decoys.push(d.ds);
    allowed.add(d.as + d.ds);
    [d.ds, d.ps, d.as, ...line(d.as, d.ds)].forEach(s => foot.add(s));
  }
  // Filet de sécurité avant le bruit : X sans défenseur ; les seules prises blanches sont Y×X et les
  // tours (dames) sur leurs leurres ; aucune pièce blanche attaquée ; leurres défendus. Une pièce inerte ne crée
  // aucune attaque, elle peut seulement couper une ligne (et l'empreinte protège les lignes utiles).
  if (isAttacked(m, xs, 'b')) return null;
  for (const s of Object.keys(m)) {
    if (!isWhite(m[s])) continue;
    if (isAttacked(m, s, 'b')) return null;
    if (blackTargets(m, s).some(t => !allowed.has(s + t))) return null;
  }
  if (decoys.some(s => !isAttacked(m, s, 'b'))) return null;
  let d = dress(rng, m, foot, L);
  // Leurre attaqué par une tour : tour (5) contre pièce et pion (4), on rend un pion aux Noirs.
  for (let i = 0; d && i < extra && extra <= 2; i++) d = addBlackPawn(rng, d, foot);
  if (!d) return null;
  const f = finish(d, ys + xs);
  if (!f || freeChecks(f.chess, ys + xs)) return null;
  return { fen: f.fen, key: ys + xs, roles: { piece: ys, to: xs, targets: [xs], line: line(ys, xs), decoys, gain: VALUE[X] } };
}

// ---------- T2 · Fourchette royale du cavalier ----------
// Roi noir, case de fourchette f à un saut de cavalier, cible T (dame ou tour) à un autre saut de f,
// cavalier blanc à un troisième saut de f. La case f n'est pas attaquée par les Noirs.
const CENTRE = s => fileOf(s) >= 2 && fileOf(s) <= 5 && rankOf(s) >= 2 && rankOf(s) <= 5;
const FORK_STRATA = ['q-centre', 'q-bord', 'r-centre', 'r-bord'];
function genFork(rng, L, sub) {
  const [T, zone] = (sub || pick(rng, FORK_STRATA)).split('-');
  const k = pick(rng, ALL_SQUARES.filter(s => fileOf(s) >= 1 && fileOf(s) <= 6 && rankOf(s) >= 1 && rankOf(s) <= 6
    && (zone === 'centre') === CENTRE(s)));
  const f = pick(rng, knightTargets(k));
  const t = pick(rng, knightTargets(f).filter(s => s !== k));
  const n = pick(rng, knightTargets(f).filter(s => s !== k && s !== t));
  if (!t || !n || knightTargets(n).includes(t) || knightTargets(n).includes(k)) return null;
  const m = { [k]: 'k', [t]: T, [n]: 'N' };
  if (isAttacked(m, f, 'b')) return null;
  // Roi blanc loin des deux cibles, hors de la case de fourchette, pas en échec.
  const K = pick(rng, free(m, s => s !== f && dist(s, k) >= 2 && dist(s, t) >= 2 && !isAttacked({ ...m, [s]: 'K' }, s, 'b')));
  if (!K) return null;
  m[K] = 'K';
  const foot = new Set([...box(k), f, t, n, K]);
  const d = dress(rng, m, foot, L);
  if (!d) return null;
  const fin = finish(d, n + f);
  if (!fin) return null;
  return { fen: fin.fen, key: n + f, roles: { piece: n, to: f, targets: [k, t], gain: VALUE[T] - 3 } };
}

// ---------- T3 · Enfilade ----------
// Roi et dame noirs sur une rangée ou une colonne ; la tour blanche fait échec sur cette ligne
// depuis une case cs de l'autre côté du roi ; le roi s'écarte, la dame tombe.
const SKEWER_STRATA = ['rangee-1', 'rangee-2', 'colonne-1', 'colonne-2'];
function genSkewer(rng, L, sub) {
  const [kind, g] = (sub || pick(rng, SKEWER_STRATA)).split('-');
  const horiz = kind === 'rangee';
  const at = (a, ln) => (horiz ? sqAt(a, ln) : sqAt(ln, a));
  const ln = int(rng, 1, 6), gap = g === '1' ? 1 : int(rng, 2, 3), dir = pick(rng, [-1, 1]), dcs = int(rng, 2, 4);
  const a = int(rng, 0, 7);
  const k = at(a, ln), q = at(a + dir * gap, ln), cs = at(a - dir * dcs, ln);
  if (!k || !q || !cs) return null;
  // Tour sur la perpendiculaire passant par cs, à 2 cases au moins de cs.
  const ra = pick(rng, [0, 1, 2, 3, 4, 5, 6, 7].filter(x => Math.abs(x - ln) >= 2));
  const R = horiz ? sqAt(fileOf(cs), ra) : sqAt(ra, rankOf(cs));
  const m = { [k]: 'k', [q]: 'q', [R]: 'R' };
  if (isAttacked(m, cs, 'b') || isAttacked(m, R, 'b')) return null;
  const lineSq = [cs, ...line(cs, k), k, ...line(k, q), q];
  const K = pick(rng, free(m, s => dist(s, k) >= 2 && !lineSq.includes(s) && !line(R, cs).includes(s)
    && !isAttacked({ ...m, [s]: 'K' }, s, 'b')));
  if (!K) return null;
  m[K] = 'K';
  const foot = new Set([...box(k), ...lineSq, R, ...line(R, cs), K]);
  const d = dress(rng, m, foot, L);
  if (!d) return null;
  const fin = finish(d, R + cs);
  if (!fin) return null;
  return { fen: fin.fen, key: R + cs, roles: { piece: R, to: cs, targets: [k, q], line: lineSq, gain: 4 } };
}

// ---------- T4 · Exploiter le clouage ----------
// Une pièce blanche (hors `except`) peut-elle, en un coup, venir attaquer la case `target` ?
function otherAttacker(m, target, except) {
  for (const s of Object.keys(m)) {
    const P = m[s];
    if (!isWhite(P) || P === 'K' || except.includes(s)) continue;
    const dests = P === 'P' ? [shift(s, 0, 1)].filter(t => t && !m[t]) : attacksFrom(m, s).filter(t => !m[t]);
    for (const t of dests) {
      const after = { ...m, [t]: P };
      delete after[s];
      if (attacksFrom(after, t).includes(target)) return true;
    }
  }
  return false;
}
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
  const pin = line(B, k);
  const K = pick(rng, free(m, s => dist(s, k) >= 2 && s !== push && !pin.includes(s) && !isAttacked({ ...m, [s]: 'K' }, s, 'b')));
  if (!K) return null;
  m[K] = 'K';
  const foot = new Set([...box(k), p, B, po, push, ...pin, K, ...(guard ? [guard] : [])]);
  if (isAttacked(m, push, 'b') && !isAttacked(m, push, 'w')) return null;
  if (isAttacked(m, B, 'b')) return null;
  let d = dress(rng, m, foot, L);
  // Sans pion de garde, le pion du motif donne un pion de plus aux Blancs : on rend ce pion aux Noirs.
  if (d && !guard) d = addBlackPawn(rng, d, foot);
  // Le pion est le seul à pouvoir attaquer la pièce clouée en un coup : sinon une autre pièce
  // ferait aussi bien (deux solutions), et l'exercice ne montrerait plus « attaque avec moins cher ».
  if (!d || otherAttacker(d, p, [B, po])) return null;
  const fin = finish(d, po + push);
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
    verify: checked({ gap: 200 }),
  },
  {
    ...SHARED, id: 'fourchette-cavalier', title: 'Fourchette royale du cavalier', short: 'Fourchette', family: 'tactic:fork',
    goal: { kind: 'material', gain: st => st.start.roles?.gain ?? 2, within: 3 }, prereq: ['piece-en-prise'],
    levels: LEVELS,
    strata: () => FORK_STRATA,
    tip: 'Cherche une case d’où ton cavalier attaquerait le roi et une grosse pièce à la fois : avec échec, c’est imparable.',
    ideas: ['fork'],
    generate(rng, level, sub) { return retry(300, () => genFork(rng, this.levels[level], sub)); },
    verify: checked(),
  },
  {
    ...SHARED, id: 'enfilade', title: 'Enfilade', short: 'Enfilade', family: 'tactic:skewer',
    goal: { kind: 'material', gain: 4, within: 3 }, prereq: ['piece-en-prise'],
    levels: LEVELS,
    strata: () => SKEWER_STRATA,
    tip: 'Roi et dame alignés : fais échec sur la ligne, le roi s’écarte et la dame derrière lui tombe.',
    ideas: ['skewer'],
    generate(rng, level, sub) { return retry(300, () => genSkewer(rng, this.levels[level], sub)); },
    verify: checked(),
  },
  {
    ...SHARED, id: 'clouage', title: 'Exploiter le clouage', short: 'Clouage', family: 'tactic:pin',
    goal: { kind: 'material', gain: 2, within: 3 }, prereq: ['piece-en-prise'],
    levels: [{ ...LEVELS[0], pairs: 1 }, LEVELS[1], LEVELS[2]],
    strata: () => ['n', 'r'],
    tip: 'Une pièce clouée devant son roi ne peut pas fuir : attaque-la avec moins cher qu’elle, un pion par exemple.',
    ideas: ['pin'],
    generate(rng, level, sub) { return retry(300, () => genPin(rng, this.levels[level], sub)); },
    verify: checked(),
  },
];
