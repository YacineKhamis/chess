// Parcours « Vigilance » (spec §3.7) : question 1 de la check-list (« Que menace son dernier coup ? »)
// jouée jusqu'au bout. Les Noirs menacent un mat du couloir ; l'utilisateur doit le voir et le parer.
import { Chess } from '../../vendor/chess.js';
import { V } from '../drill/verify.js';
import { int, pick, sqAt, between, fenFrom, kingTargets } from '../drill/geom.js';
import { addNoise, isAttacked, unitsFor } from '../drill/noise.js';
import { nullMoveFen } from '../util.js';

const box = sq => [sq, ...kingTargets(sq)];
const retry = (n, fn) => { for (let i = 0; i < n; i++) { const c = fn(); if (c) return c; } return null; };
const legal = fen => { try { return new Chess(fen); } catch { return null; } };
const files = pred => [0, 1, 2, 3, 4, 5, 6, 7].filter(pred);
const mates = moves => moves.filter(mv => mv.san.endsWith('#'));   // chess.js marque le mat dans le SAN

// Roi blanc sur la 1re rangée (colonnes b–g) derrière ses trois pions intacts ; roi noir sur la 8e rangée
// avec 0 à 3 pions devant lui ; une pièce lourde noire (tour, ou dame) sur une colonne libre jusqu'à la
// 1re rangée, à deux colonnes au moins du roi blanc ; une tour blanche (une dame contre une dame) entre la
// 3e et la 7e rangée.
function genParer(rng, L, sub) {
  const kf = int(rng, 1, 6), K = sqAt(kf, 0), m = { [K]: 'K' };
  const shell = [-1, 0, 1].map(df => sqAt(kf + df, 1));
  shell.forEach(s => { m[s] = 'P'; });
  const bf = int(rng, 0, 7), k = sqAt(bf, 7);
  m[k] = 'k';
  for (const df of [-1, 0, 1]) { const s = sqAt(bf + df, 6); if (s && rng() < 0.6) m[s] = 'p'; }
  const af = pick(rng, files(f => Math.abs(f - kf) >= 2));
  const H = sqAt(af, int(rng, 2, 6)), to = sqAt(af, 0);
  if (m[H] || between(H, to).some(s => m[s])) return null;
  m[H] = sub === 'dame' ? 'q' : 'r';
  // Pièce blanche de même valeur que l'attaquant noir : sinon les Blancs sont perdus d'avance (dame contre tour).
  const R = sqAt(int(rng, 0, 7), int(rng, 2, 6));
  if (m[R]) return null;
  m[R] = sub === 'dame' ? 'Q' : 'R';
  if (isAttacked(m, R, 'b') || isAttacked(m, H, 'w')) return null;
  const foot = new Set([...files(() => true).map(f => sqAt(f, 0)), ...between(H, to), H, R, ...box(K), ...box(k), ...shell]);
  let d = m;
  if (L.noise) {
    const r = addNoise(rng, m, foot, unitsFor(rng, L.noise));
    if (r.units < L.noise[0]) return null;
    d = r.placement;
  }
  const fen = fenFrom(d, 'w');
  const c = legal(fen);
  if (!c || c.isCheck() || c.isGameOver()) return null;
  const mv = c.moves({ verbose: true });
  if (mv.some(x => x.captured) || mates(mv).length) return null;   // S0 sans prise ; pas de mat en 1 pour les Blancs
  // Tri sans moteur : la menace est un vrai mat en 1 (coup nul des Blancs).
  const n = legal(nullMoveFen(fen));
  if (!n || n.isCheck() || !mates(n.moves({ verbose: true })).some(x => x.from === H && x.to === to)) return null;
  return { fen, roles: { threat: H + to, attacker: H, king: K, file: [H, ...between(H, to), to], shell, defender: R } };
}

export default [
  {
    id: 'parer-couloir', track: 'vigilance', title: 'Pare le mat du couloir', short: 'Parer', phase: 'A',
    oracle: 'engine', family: 'parry', userSide: 'w', goal: { kind: 'hold', n: 3, band: 'keep' }, flip: true, need: 3,
    prereq: ['mat-couloir'], contrast: ['mat-couloir'],
    intro: 'Que menace son dernier coup ?',
    levels: [
      { label: 'La menace seule', noise: 0, tries: 60 },
      { label: 'Avec quelques pièces autour', noise: [2, 4], tries: 60 },
      { label: 'Cachée parmi d’autres pièces', noise: [4, 6], tries: 60 },
    ],
    strata: () => ['tour', 'tour', 'dame'],
    tip: 'Avant de jouer ton plan, regarde si sa tour ou sa dame peut arriver sur ta première rangée.',
    ideas: ['parry-threat', 'luft'], yardstick: 'hold-n',
    generate(rng, level, sub) { return retry(300, () => genParer(rng, this.levels[level], sub)); },
    verify: (ctx, c) => V.def()(ctx, c),
  },
];
