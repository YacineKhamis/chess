// Parcours « Pièce contre pion » (spec §3.3) : dame contre pion en 7e, la défense par le pat, tour contre pion.
import { Chess } from '../../vendor/chess.js';
import { V } from '../drill/verify.js';
import { int, pick, sqAt, fileOf, rankOf, dist, adjacent, fenFrom, ALL_SQUARES } from '../drill/geom.js';

const free = (rng, used, pred) => {
  const c = ALL_SQUARES.filter(s => !used[s] && pred(s));
  return c.length ? pick(rng, c) : null;
};
const legal = fen => { try { return new Chess(fen); } catch { return null; } };

// Pion noir en 2e rangée, roi noir à côté, dame et roi blancs au loin.
function queenVsPawn(rng, file, { wkDist, turn }) {
  const p = file + '2';
  const used = { [p]: 'p' };
  const bk = free(rng, used, s => adjacent(s, p) && rankOf(s) <= 2); if (!bk) return null; used[bk] = 'k';
  const wk = free(rng, used, s => dist(s, p) >= wkDist[0] && dist(s, p) <= wkDist[1] && dist(s, bk) > 1); if (!wk) return null; used[wk] = 'K';
  const q = free(rng, used, s => dist(s, bk) > 1); if (!q) return null; used[q] = 'Q';
  const fen = fenFrom(used, turn);
  const c = legal(fen);
  if (!c) return null;
  if (turn === 'w' && c.isAttacked(bk, 'w')) return null;
  // Noirs au trait : la dame doit tenir la case de promotion (sinon le pion va à dame tout de suite).
  const promo = file + '1';
  if (turn === 'b' && used[promo] !== 'k' && !c.isAttacked(promo, 'w')) return null;
  return { fen, roles: { pawn: p } };
}

export default [
  {
    id: 'dame-contre-pion', track: 'pieces', title: 'Dame contre pion en 7e', short: 'Dame contre pion', phase: 'A',
    oracle: 'engine', family: 'kqkp', userSide: 'w', goal: { kind: 'capture' }, moveCap: 40, flip: true, need: 3,
    prereq: ['mat-dame', 'pion-roi-devant'], contrast: ['dame-contre-pion-nulle'],
    levels: [{ label: 'Roi blanc proche', wkDist: [4, 5] }, { label: 'Roi blanc loin', wkDist: [6, 7] }],
    strata: () => ['b', 'd', 'e', 'g'],
    tip: 'Échecs et clouages pour forcer le roi devant son pion ; chaque fois, ton roi gagne un pas.',
    ideas: ['in-front', 'approach'], yardstick: null,
    generate(rng, level, sub) { return queenVsPawn(rng, sub || pick(rng, ['b', 'd', 'e', 'g']), { wkDist: this.levels[level].wkDist, turn: 'w' }); },
    verify: V.attackWin(),
  },
  {
    id: 'dame-contre-pion-nulle', track: 'pieces', title: 'Dame contre pion fou ou tour : la défense par le pat', short: 'Défense par le pat', phase: 'A',
    oracle: 'engine', family: 'kqkp-def', userSide: 'b', goal: { kind: 'hold', n: 12, band: 'draw' }, s0: { allowCheck: true }, flip: true, need: 3,
    prereq: ['dame-contre-pion'], contrast: ['dame-contre-pion'],
    levels: [{ label: 'Pion de la tour', files: ['a', 'h'] }, { label: 'Pion du fou', files: ['c', 'f'] }],
    tip: 'Pion fou ou tour sur la 7e : file dans le coin, prendre ton pion serait pat.',
    ideas: ['stalemate-defence', 'rook-pawn-corner'], yardstick: 'hold-n',
    generate(rng, level) { return queenVsPawn(rng, pick(rng, this.levels[level].files), { wkDist: [5, 7], turn: 'b' }); },
    verify: V.holdDraw(),
  },
  {
    id: 'tour-contre-pion', track: 'pieces', title: 'Tour contre pion : gagner', short: 'Tour contre pion', phase: 'A',
    oracle: 'engine', family: 'krkp', userSide: 'w', goal: { kind: 'capture' }, moveCap: 40, flip: true, need: 3,
    prereq: ['mat-tour', 'pion-carre'],
    levels: [
      { label: 'Pion encore loin', ranks: [3, 4], wkDist: [3, 4] },
      { label: 'Pion avancé', ranks: [2, 3, 4], wkDist: [3, 6] },
    ],
    tip: 'Coupe le roi adverse avec ta tour, puis ramène ton roi devant le pion.',
    ideas: ['cut', 'king-in-front', 'rook-behind'], yardstick: null,
    generate(rng, level) {
      const L = this.levels[level];
      const p = sqAt(int(rng, 0, 7), pick(rng, L.ranks));
      const used = { [p]: 'p' };
      const bk = free(rng, used, s => dist(s, p) <= 2); if (!bk) return null; used[bk] = 'k';
      const wk = free(rng, used, s => dist(s, p) >= L.wkDist[0] && dist(s, p) <= L.wkDist[1] && dist(s, bk) > 1); if (!wk) return null; used[wk] = 'K';
      const r = free(rng, used, s => dist(s, bk) > 1); if (!r) return null; used[r] = 'R';
      const fen = fenFrom(used, 'w');
      const c = legal(fen);
      if (!c || c.isAttacked(bk, 'w') || c.isAttacked(r, 'b')) return null;
      return { fen, roles: { pawn: p } };
    },
    verify: V.attackWin(),
  },
];
