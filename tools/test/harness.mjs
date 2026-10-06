// Outils communs aux tests des exercices : contexte (moteur, tables, hasard), partie simulée.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { nodeEngine } from './node-engine.mjs';
import { mulberry32 } from '../../js/drill/geom.js';
import { Attempt } from '../../js/drill/attempt.js';

export const QUICK = !!process.env.QUICK, FULL = !!process.env.FULL;
export const N = (quick, normal, full = normal) => (FULL ? full : QUICK ? quick : normal);

const TB_DIR = fileURLToPath(new URL('../../data/tb/', import.meta.url));
export async function loadTables() {
  if (!existsSync(TB_DIR + 'kpk.bin')) return null;
  const { loadTBFromFs } = await import('./tb-fs.mjs');
  return loadTBFromFs();
}

export async function makeCtx({ seed = 1, engine = true, tb = true } = {}) {
  return {
    engine: engine ? nodeEngine() : null,
    tb: tb ? await loadTables() : null,
    rng: mulberry32(seed),
  };
}
export const closeCtx = ctx => ctx.engine && ctx.engine.close();

// Joue une tentative jusqu'au bout. player(attempt) → coup UCI de l'utilisateur (ou null pour abandonner).
export async function simulate(spec, start, ctx, player, { maxMoves = 80 } = {}) {
  const a = new Attempt(spec, start, ctx);
  for (let i = 0; i < maxMoves && !a.over; i++) {
    const mv = await player(a);
    if (!mv) break;
    const r = await a.userMove(mv);
    if (r.status === 'illegal') throw new Error(`coup illégal ${mv} dans ${a.fen}`);
  }
  return a;
}

// Joueurs simulés : l'oracle (meilleur coup des tables ou du moteur) et un joueur qui se trompe parfois.
export const oracle = (ms = 1000) => async a => {
  if (a.spec.oracle === 'tb') {
    const { moves } = await a.candidates();
    return moves[0];
  }
  const [l] = await a.ctx.engine.analyse(a.fen, { movetime: ms });
  return l && l.move;
};
