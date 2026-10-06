// Bibliothèque de vérifications d'une position candidate (spec §3.0.5).
// Chaque vérification reçoit (ctx, candidat, niveau) et renvoie { E0, Ealt, ref, pv, k, roles } ou null.
import { Chess } from '../../vendor/chess.js';
import { nullMoveFen, uci } from '../util.js';
import { balance } from '../analysis.js';

const top = lines => lines && lines[0];

export const V = {
  // L'utilisateur (au trait) gagne : ≥ min à 300 ms puis à 1000 ms.
  // minMate : refuse les positions où un mat trop court règle tout (exercice sans intérêt).
  attackWin: ({ min = 300, minMate = 1 } = {}) => async (ctx, c) => {
    const a = top(await ctx.engine.analyse(c.fen, { movetime: 300 }));
    if (!a || a.cp < min || (a.mate != null && a.mate < minMate)) return null;
    const b = top(await ctx.engine.analyse(c.fen, { movetime: 1000 }));
    if (!b || b.cp < min) return null;
    return { E0: b.cp };
  },
  // L'utilisateur (au trait) défend une position nulle.
  holdDraw: ({ a = 50, b = 100 } = {}) => async (ctx, c) => {
    const x = top(await ctx.engine.analyse(c.fen, { movetime: 300 }));
    if (!x || x.mate != null || Math.abs(x.cp) > a) return null;
    const y = top(await ctx.engine.analyse(c.fen, { movetime: 1000 }));
    if (!y || y.mate != null || Math.abs(y.cp) > b) return null;
    return { E0: y.cp };
  },
  // Mat trouvé par le moteur, longueur dans [min, max] : sert de référence.
  engineMate: ({ min = 1, max = 99, movetime = 1500 } = {}) => async (ctx, c) => {
    const x = top(await ctx.engine.analyse(c.fen, { movetime }));
    if (!x || x.mate == null || x.mate < min || x.mate > max) return null;
    return { ref: x.mate, E0: x.cp, pv: x.pv };
  },
  // Tables exactes : pred({ probe, rank, fen, level, sub }) décide.
  tb: pred => async (ctx, c, level) => {
    const p = ctx.tb.probe(c.fen);
    if (!p) return null;
    let rank = null;
    const args = { probe: p, fen: c.fen, level, sub: c.sub, get rank() { return rank ||= ctx.tb.rankMoves(c.fen); } };
    if (!pred(args)) return null;
    return { ref: p.win ? p.dist : null };
  },
  // Tactique : le coup clé est le meilleur, nettement devant le deuxième, et ne mate pas.
  mat: ({ gap = 250, floor = -50, gain = null } = {}) => async (ctx, c, level) => {
    const depth = level < 1 ? 10 : 12;
    const lines = await ctx.engine.analyse(c.fen, { depth, movetime: 1500, multipv: 2 });
    const [best, second] = lines;
    if (!best || !keyOk(c, best.move)) return null;
    if (best.mate != null || best.cp < floor) return null;
    const alt = second ? second.cp : -10000;
    if (best.cp - alt < gap) return null;
    const stable = top(await ctx.engine.analyse(c.fen, { depth: depth - 2, movetime: 1500 }));
    if (!stable || !keyOk(c, stable.move)) return null;
    const g = gain ?? c.roles?.gain ?? 2;
    return { E0: best.cp, Ealt: alt, pv: best.pv, k: firstGain(c.fen, best.pv, g) };
  },
  // Mat en n, premier coup unique.
  mate: ({ n }) => async (ctx, c) => {
    const lines = await ctx.engine.analyse(c.fen, { depth: n === 1 ? 10 : 12, movetime: 1500, multipv: 2 });
    const [best, second] = lines;
    if (!best || best.mate !== n || !keyOk(c, best.move)) return null;
    if (second && second.mate != null && second.mate > 0 && second.mate <= n) return null;
    return { ref: n, E0: best.cp, pv: best.pv };
  },
  // Défense : la menace adverse est un mat en 1, et peu de coups la parent.
  def: ({ tol = 80, maxShare = 0.5 } = {}) => async (ctx, c) => {
    const threat = top(await ctx.engine.analyse(nullMoveFen(c.fen), { depth: 10, movetime: 1500 }));
    if (!threat || threat.mate !== 1) return null;
    const legal = new Chess(c.fen).moves().length;
    const lines = await ctx.engine.analyse(c.fen, { depth: 10, movetime: 3000, multipv: Math.min(legal, 30) });
    const best = lines[0];
    if (!best || best.cp < -100 || (best.mate != null && best.mate > 0)) return null;
    const okCount = lines.filter(l => l.mate == null && l.cp >= best.cp - tol).length;
    if (okCount > maxShare * legal) return null;
    return { E0: best.cp, pv: best.pv, roles: { ...(c.roles || {}), threat: threat.move } };
  },
};

function keyOk(c, move) {
  if (c.keySet) return c.keySet.some(k => k.slice(0, 4) === move.slice(0, 4));
  if (c.key) return c.key.slice(0, 4) === move.slice(0, 4);
  return true;
}

// Premier coup de l'utilisateur (1, 2, …) après lequel le gain de matériel atteint `gain` le long de la variante.
export function firstGain(fen, pv, gain) {
  if (!pv || !pv.length) return null;
  const c = new Chess(fen), me = c.turn(), m0 = balance(c, me);
  for (let i = 0; i < pv.length; i++) {
    try { c.move(uci(pv[i])); } catch { return null; }
    if (i % 2 === 1 && balance(c, me) - m0 >= gain) return (i + 1) / 2;
  }
  return null;
}
