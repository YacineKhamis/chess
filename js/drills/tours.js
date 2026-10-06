// Parcours « Finales de tours » (spec §3.4) : Lucena pour gagner, Philidor pour tenir.
import { Chess } from '../../vendor/chess.js';
import { V } from '../drill/verify.js';
import { int, pick, sqAt, fileOf, rankOf, dist, fenFrom } from '../drill/geom.js';
import { nullMoveFen } from '../util.js';

const legal = fen => { try { return new Chess(fen); } catch { return null; } };
const anyCapture = c => c.moves({ verbose: true }).some(m => m.captured);

export default [
  {
    id: 'lucena', track: 'tours', title: 'La position de Lucena', short: 'Lucena', phase: 'A',
    oracle: 'engine', family: 'lucena', userSide: 'w', goal: { kind: 'promote' }, moveCap: 30, flip: true, need: 3,
    prereq: ['tour-contre-pion'], contrast: ['philidor'],
    levels: [{ label: 'Roi noir coupé de deux colonnes', cut: 3 }, { label: 'Roi noir coupé d’une colonne', cut: 2 }],
    strata: () => [1, -1],
    tip: 'Construis le pont : tour sur la 4e rangée, le roi sort, la tour s’interpose contre les échecs.',
    ideas: ['lucena-cut', 'lucena-bridge', 'lucena-out', 'lucena-block'], yardstick: null,
    generate(rng, level, sub) {
      const s = sub || pick(rng, [1, -1]), cut = this.levels[level].cut;
      const p = int(rng, 1, 6), k = int(rng, 1, 3);
      const bkFile = p + cut * s, wrFile = p + s, brFile = p - k * s;
      if ([wrFile, brFile].some(f => f < 0 || f > 7) || bkFile < 1 || bkFile > 6) return null; // roi noir pas collé au bord
      const pawn = sqAt(p, 6), wk = sqAt(p, 7);
      const wr = sqAt(wrFile, int(rng, 0, 4)), br = sqAt(brFile, int(rng, 0, 5)), bk = sqAt(bkFile, int(rng, 5, 7));
      const used = { [pawn]: 'P', [wk]: 'K', [wr]: 'R', [br]: 'r', [bk]: 'k' };
      if (Object.keys(used).length !== 5 || dist(bk, wr) <= 1 || dist(bk, wk) <= 1) return null;
      const fen = fenFrom(used, 'w');
      const c = legal(fen);
      if (!c || c.isCheck() || c.isAttacked(bk, 'w')) return null;
      return { fen, roles: { pawn, side: s } };
    },
    verify: V.attackWin({ minMate: 4 }),
  },
  {
    id: 'philidor', track: 'tours', title: 'La défense Philidor', short: 'Philidor', phase: 'A',
    oracle: 'engine', family: 'philidor', userSide: 'b', goal: { kind: 'hold', n: 15, band: 'draw' }, flip: true, need: 3,
    prereq: ['lucena'], contrast: ['lucena'],
    levels: [{ label: 'Tour déjà sur la 6e', ranks: [5] }, { label: 'Mettre la tour en place', ranks: [6, 7, 0, 1] }],
    tip: 'Tour sur ta 3e rangée tant que le pion n’y est pas ; s’il y avance, tour au fond et échecs par derrière.',
    ideas: ['philidor-third', 'philidor-behind', 'def-front'], yardstick: 'hold-n',
    generate(rng, level) {
      const p = int(rng, 1, 6);
      const pawn = sqAt(p, 4);
      const wk = sqAt(p + int(rng, -1, 1), int(rng, 3, 4));
      const bk = sqAt(p + int(rng, -1, 1), int(rng, 6, 7));
      const br = sqAt(int(rng, 0, 7), pick(rng, this.levels[level].ranks));
      const wr = sqAt(int(rng, 0, 7), int(rng, 0, 7));
      const used = { [pawn]: 'P', [wk]: 'K', [bk]: 'k', [br]: 'r', [wr]: 'R' };
      if (Object.keys(used).length !== 5 || dist(wk, bk) <= 1) return null;
      const fen = fenFrom(used, 'b');
      const c = legal(fen);
      if (!c || c.isCheck() || anyCapture(c)) return null;
      const n = legal(nullMoveFen(fen));
      if (!n || n.isCheck() || anyCapture(n)) return null;
      return { fen, roles: { pawn } };
    },
    verify: V.holdDraw(),
  },
];
