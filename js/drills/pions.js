// Parcours « Finales de pions » (spec §3.2) : tables exactes, aucun appel au moteur.
import { V } from '../drill/verify.js';
import { int, pick, sqAt, fileOf, rankOf, dist, fenFrom, ALL_SQUARES } from '../drill/geom.js';
import { opposition } from '../analysis.js';

// Roi blanc, roi noir et un pion blanc, placés selon des contraintes ; `turn` = camp au trait.
function kpk(rng, { files = [1, 2, 3, 4, 5, 6], ranks = [1, 2, 3, 4, 5], wk = () => true, bk = () => true, turn = 'w' }) {
  const p = sqAt(pick(rng, files), pick(rng, ranks));
  const wks = ALL_SQUARES.filter(s => s !== p && wk(s, p));
  if (!wks.length) return null;
  const w = pick(rng, wks);
  const bks = ALL_SQUARES.filter(s => s !== p && s !== w && dist(s, w) > 1 && bk(s, w, p));
  if (!bks.length) return null;
  const b = pick(rng, bks);
  return { fen: fenFrom({ [w]: 'K', [b]: 'k', [p]: 'P' }, turn), roles: { pawn: p } };
}

const promoSq = p => p[0] + '8';
const winning = rank => rank.filter(m => m.win);
const drawing = rank => rank.filter(m => !m.win);
// Cases clés d'un pion blanc sur la 2e, 3e ou 4e rangée : les trois cases deux rangées devant lui.
export const keySquares = p => [-1, 0, 1].map(df => sqAt(fileOf(p) + df, rankOf(p) + 2)).filter(Boolean);

export default [
  {
    id: 'pion-carre', track: 'pions', title: 'La règle du carré', short: 'Le carré', phase: 'A',
    oracle: 'tb', family: 'kpk-def', userSide: 'b', goal: { kind: 'hold', n: 8, band: 'draw' }, flip: true, need: 3, prereq: [],
    levels: [
      { label: 'Pion déjà lancé', ranks: [2, 3, 4, 5] },
      { label: 'Un ou deux bons coups', ranks: [1, 2, 3, 4, 5], maxDraw: 2 },
    ],
    tip: 'Trace le carré du pion jusqu’à la promotion : si ton roi peut y entrer, il le rattrape (pion sur sa case de départ : compte depuis la 3e rangée).',
    ideas: ['enter-square', 'diagonal-walk'], yardstick: 'hold-n',
    generate(rng, level) {
      return kpk(rng, {
        ranks: this.levels[level].ranks, files: [0, 1, 2, 3, 4, 5, 6, 7], turn: 'b',
        wk: (s, p) => dist(s, p) >= 4 && dist(s, promoSq(p)) >= 3,
        bk: (s, w, p) => dist(s, p) >= 3,
      });
    },
    verify(ctx, c, level) {
      const max = this.levels[level].maxDraw;
      return V.tb(({ probe, rank }) => !probe.win && winning(rank).length > 0 && (!max || drawing(rank).length <= max))(ctx, c, level);
    },
  },
  {
    id: 'pion-roi-devant', track: 'pions', title: 'Le roi devant le pion', short: 'Roi devant', phase: 'A',
    oracle: 'tb', family: 'kpk', userSide: 'w', goal: { kind: 'promote' }, flip: true, need: 3, prereq: [],
    levels: [{ label: 'Plusieurs chemins', min: 2 }, { label: 'Un seul bon coup', exact: 1 }],
    tip: 'Le roi devant, le pion derrière : ton roi ouvre la route, le pion ne monte que lorsque la case devant lui est à toi.',
    ideas: ['king-in-front', 'opposition', 'stalemate-danger'], yardstick: 'tb-dtp',
    generate: rng => kpk(rng, {
      wk: (s, p) => rankOf(s) > rankOf(p) && Math.abs(fileOf(s) - fileOf(p)) <= 1,
      bk: (s, w, p) => dist(s, promoSq(p)) <= 3,
    }),
    verify(ctx, c, level) {
      const L = this.levels[level];
      return V.tb(({ probe, rank }) => {
        if (!probe.win || probe.strong !== 'w' || probe.dist < 4 || probe.dist > 9) return false;
        const n = winning(rank).length;
        return L.exact ? n === L.exact : n >= L.min;
      })(ctx, c, level);
    },
  },
  {
    id: 'pion-opposition', track: 'pions', title: 'Prendre l’opposition', short: 'Opposition', phase: 'A',
    oracle: 'tb', family: 'kpk', userSide: 'w', goal: { kind: 'promote' }, flip: true, need: 3, prereq: ['pion-roi-devant'],
    levels: [{ label: 'Face à face', direct: true }, { label: 'Déborder', direct: false }],
    tip: 'Rois face à face, une case entre eux : celui qui n’a PAS le trait a l’opposition ; prends-la, puis déborde.',
    ideas: ['opposition', 'outflank', 'waiting'], yardstick: 'tb-dtp',
    generate: rng => kpk(rng, {
      ranks: [1, 2, 3, 4],
      wk: (s, p) => dist(s, p) <= 2,
      bk: (s, w) => dist(s, w) <= 3,
    }),
    verify(ctx, c, level) {
      const L = this.levels[level];
      return V.tb(({ probe, rank, fen }) => {
        if (!probe.win || probe.strong !== 'w') return false;
        const good = winning(rank);
        if (good.length !== 1) return false;
        const wk = kingOf(fen, 'K'), bk = kingOf(fen, 'k');
        if (good[0].uci.slice(0, 2) !== wk) return false;            // le seul coup gagnant est un coup de roi
        return !L.direct || opposition(good[0].uci.slice(2, 4), bk) === 'direct';
      })(ctx, c, level);
    },
  },
  {
    id: 'pion-cases-cles', track: 'pions', title: 'Les cases clés', short: 'Cases clés', phase: 'A',
    oracle: 'tb', family: 'kpk', userSide: 'w', goal: { kind: 'promote' }, flip: true, need: 3, prereq: ['pion-opposition'],
    levels: [{ label: 'Plusieurs chemins', min: 2 }, { label: 'Un seul bon coup', exact: 1 }],
    tip: 'Pion sur la 2e, 3e ou 4e rangée : vise les trois cases deux rangées devant lui ; ton roi dessus = gagné.',
    ideas: ['key-square', 'king-first', 'opposition'], yardstick: 'tb-dtp',
    generate: rng => {
      const c = kpk(rng, {
        ranks: [1, 2, 3],
        // le roi blanc part d'en dessous des cases clés : il doit aller les chercher
        wk: (s, p) => { const ks = keySquares(p); return rankOf(s) <= rankOf(p) + 1 && Math.min(...ks.map(k => dist(s, k))) >= 2; },
      });
      if (c) c.roles.keys = keySquares(c.roles.pawn);
      return c;
    },
    verify(ctx, c, level) {
      const L = this.levels[level];
      return V.tb(({ probe, rank }) => {
        if (!probe.win || probe.strong !== 'w' || probe.dist < 6) return false;
        const n = winning(rank).length;
        return L.exact ? n === L.exact : n >= L.min;
      })(ctx, c, level);
    },
  },
  {
    id: 'pion-defense', track: 'pions', title: 'Tenir la nulle', short: 'Défense', phase: 'A',
    oracle: 'tb', family: 'kpk-def', userSide: 'b', goal: { kind: 'hold', n: 10, band: 'draw' }, flip: true, need: 3,
    prereq: ['pion-opposition'], contrast: ['pion-roi-devant'],
    levels: [{ label: 'Plusieurs défenses', min: 2 }, { label: 'Une seule défense', exact: 1 }],
    tip: 'Reste devant le pion ; repoussé, recule tout droit sur sa colonne pour reprendre l’opposition.',
    ideas: ['def-front', 'def-straight', 'opposition'], yardstick: 'hold-n',
    generate: rng => kpk(rng, {
      turn: 'b',
      wk: (s, p) => dist(s, p) <= 2,
      bk: (s, w, p) => dist(s, p) <= 3,
    }),
    verify(ctx, c, level) {
      const L = this.levels[level];
      return V.tb(({ probe, rank }) => {
        if (probe.win) return false;
        const n = drawing(rank).length;
        return winning(rank).length > 0 && (L.exact ? n === L.exact : n >= L.min);
      })(ctx, c, level);
    },
  },
  {
    id: 'pion-tour', track: 'pions', title: 'Le pion de la tour', short: 'Pion de tour', phase: 'A',
    oracle: 'tb', family: 'kpk-def', userSide: 'b', goal: { kind: 'hold', n: 8, band: 'draw' }, flip: true, need: 3,
    prereq: ['pion-defense'],
    levels: [{ label: 'Rejoindre le coin', max: 3 }, { label: 'Une seule route', exact: 1 }],
    tip: 'Pion de la tour : si le roi adverse atteint le coin, c’est nulle ; pour gagner, ton roi doit l’enfermer hors du coin.',
    ideas: ['rook-pawn-corner'], yardstick: 'hold-n',
    generate: rng => {
      const f = pick(rng, [0, 7]);
      const corner = sqAt(f, 7), zone = [corner, sqAt(f === 0 ? 1 : 6, 7), sqAt(f, 6), sqAt(f === 0 ? 1 : 6, 6)];
      const c = kpk(rng, {
        files: [f], ranks: [1, 2, 3, 4, 5], turn: 'b',
        wk: (s, p) => dist(s, p) <= 3,
        bk: s => dist(s, corner) <= 3 && !zone.includes(s),
      });
      if (c) c.roles.corner = zone;
      return c;
    },
    verify(ctx, c, level) {
      const L = this.levels[level];
      return V.tb(({ probe, rank }) => {
        if (probe.win) return false;
        const n = drawing(rank).length;
        return winning(rank).length > 0 && (L.exact ? n === L.exact : n <= L.max);
      })(ctx, c, level);
    },
    // Le roi est arrivé dans le coin du pion : c'est nulle.
    afterUser(st) {
      const zone = st.start.roles?.corner;
      const me = st.userColor === 'w' ? 'K' : 'k';
      const king = kingOf(st.chess.fen(), me);
      if (zone && zone.includes(king)) {
        const p = st.ctx.tb.probe(st.chess.fen());
        if (p && !p.win) return { status: 'success', reason: 'Ton roi est dans le coin : c’est nulle.' };
      }
      return null;
    },
  },
];

function kingOf(fen, k) {
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      if (ch === k) return 'abcdefgh'[f] + (8 - r);
      f++;
    }
  }
  return null;
}
