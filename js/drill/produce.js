// Chaîne de production d'une position : tirage, filtre S0, anti-répétition, vérification, symétries (spec §1.5).
import { s0 } from './s0.js';
import { mirrorSq, flipSq, mapSquares, shuffle } from './geom.js';
import { mirrorFiles, swapColors } from '../analysis.js';

const recentByDrill = new Map();   // id → Set des placements récents (mémoire de la page)
const bags = new Map();            // id:niveau → sous-cas restants
const RECENT = 30;

function remember(id, key) {
  const set = recentByDrill.get(id) || new Set();
  set.add(key);
  if (set.size > RECENT) set.delete(set.values().next().value);
  recentByDrill.set(id, set);
}

// Tire le prochain sous-cas (« strate ») dans un sac mélangé, rempli à nouveau quand il est vide.
export function nextSub(spec, level, rng) {
  const all = spec.strata ? spec.strata(level) : null;
  if (!all || !all.length) return null;
  const k = `${spec.id}:${level}`;
  let bag = bags.get(k);
  if (!bag || !bag.length) bag = shuffle(rng, all);
  const sub = bag.pop();
  bags.set(k, bag);
  return sub;
}

export async function produce(spec, level, ctx, { sub = undefined, colour = spec.userSide, mirror, signal } = {}) {
  const L = spec.levels[level] || {};
  const tries = L.tries ?? (spec.oracle === 'tb' ? 3000 : 40);
  const recent = recentByDrill.get(spec.id) || new Set();
  const theSub = sub === undefined ? nextSub(spec, level, ctx.rng) : sub;
  for (let t = 0; t < tries; t++) {
    if (signal?.aborted) return null;
    const c = spec.generate(ctx.rng, level, theSub);
    if (!c || !s0(c.fen, spec.s0)) continue;
    const key = c.fen.split(' ')[0];
    if (recent.has(key)) continue;
    if (spec.oracle === 'engine') await ctx.engine.newGame();
    const v = await spec.verify(ctx, { ...c, sub: theSub }, level);
    if (signal?.aborted) return null;
    if (!v) continue;
    remember(spec.id, key);
    return finalize(spec, { ...c, sub: theSub, level }, v, { mirror: mirror ?? (spec.noMirror ? false : ctx.rng() < 0.5), flip: colour !== spec.userSide });
  }
  return null;
}

// Applique miroir et échange des couleurs à la position et à tout ce qui désigne des cases.
export function finalize(spec, c, v, { mirror = false, flip = false } = {}) {
  let fen = c.fen;
  const f = sq => { let s = sq; if (mirror) s = mirrorSq(s); if (flip) s = flipSq(s); return s; };
  if (mirror) fen = mirrorFiles(fen);
  if (flip) fen = swapColors(fen);
  const map = x => (x == null ? x : mapSquares(x, f));
  return {
    id: spec.id, level: c.level, sub: c.sub ?? null, fen,
    canonical: c.fen, mirror, flip,
    userColor: flip ? (spec.userSide === 'w' ? 'b' : 'w') : spec.userSide,
    key: map(v.key ?? c.key), keySet: map(v.keySet ?? c.keySet), roles: map({ ...(c.roles || {}), ...(v.roles || {}) }),
    pv: map(v.pv), ref: v.ref ?? null, E0: v.E0 ?? null, Ealt: v.Ealt ?? null, k: v.k ?? null,
  };
}

// Rejoue une position déjà vue (par exemple une erreur passée) avec une symétrie neuve.
export function replay(spec, item, rng, colour = spec.userSide) {
  return finalize(spec, { fen: item.fen, level: item.level, sub: item.sub, key: item.key, roles: item.roles },
    { ref: item.ref, E0: item.E0, Ealt: item.Ealt, k: item.k, pv: item.pv },
    { mirror: spec.noMirror ? false : rng() < 0.5, flip: colour !== spec.userSide });
}
