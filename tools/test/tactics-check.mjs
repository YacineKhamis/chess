// Outils des tests « motifs tactiques, images de mat, vigilance » : contre-vérification longue et indépendante
// d'une position produite (spec §6.2-3 b), recherche d'une gaffe nette (§6.2-4) et statistiques.
import { Chess } from '../../vendor/chess.js';
import { nullMoveFen } from '../../js/util.js';

const same = (a, b) => !!a && !!b && a.slice(0, 4) === b.slice(0, 4);
const keysOf = s => (s.keySet || (s.key ? [s.key] : []));
export const verifyKind = spec => (spec.goal.kind === 'mate' ? 'mate' : spec.goal.kind === 'hold' ? 'def' : 'mat');
export const levelN = (spec, level) => spec.levels[level]?.n ?? (typeof spec.goal.n === 'number' ? spec.goal.n : 1);

/**
 * Contre-vérification longue sur la position telle qu'elle sera jouée (miroir et couleurs compris) :
 * V-MAT : le coup clé reste le meilleur à la profondeur de vérification + 4, avec au moins 150 cp d'avance ;
 * V-MATE : mat en n à la profondeur 16, premier coup unique ;
 * V-DEF : la menace (coup nul) est un mat en 1 et la part des coups qui la parent est ≤ 50 % à la profondeur 14.
 * Renvoie { ok, why } (why décrit le désaccord).
 */
export async function recheck(engine, spec, s) {
  await engine.newGame();
  const kind = verifyKind(spec);
  if (kind === 'mat') {
    const depth = (s.level < 1 ? 10 : 12) + 4;
    const [b, c] = await engine.analyse(s.fen, { depth, movetime: 8000, multipv: 2 });
    const gap = b && c ? b.cp - c.cp : Infinity;
    const ok = !!b && keysOf(s).some(k => same(k, b.move)) && b.mate == null && gap >= 150;
    return { ok, why: `d${depth} ${b?.move} ${b?.cp} / ${c?.move} ${c?.cp} (clé ${s.key})` };
  }
  if (kind === 'mate') {
    const n = levelN(spec, s.level);
    const [b, c] = await engine.analyse(s.fen, { depth: 16, movetime: 8000, multipv: 2 });
    const ok = !!b && b.mate === n && keysOf(s).some(k => same(k, b.move)) && !(c && c.mate != null && c.mate > 0 && c.mate <= n);
    return { ok, why: `d16 ${b?.move} #${b?.mate} / ${c?.move} #${c?.mate} (clé ${s.key}, n ${n})` };
  }
  const [t] = await engine.analyse(nullMoveFen(s.fen), { depth: 14, movetime: 8000 });
  if (!t || t.mate !== 1) return { ok: false, why: `menace ${t?.move} mate ${t?.mate}` };
  const legal = new Chess(s.fen).moves().length;
  const lines = await engine.analyse(s.fen, { depth: 14, movetime: 15000, multipv: Math.min(legal, 30) });
  const best = lines[0];
  const good = lines.filter(l => l.mate == null && l.cp >= best.cp - 80).length;
  const ok = !!best && best.cp >= -100 && !(best.mate != null && best.mate > 0) && good <= 0.5 * legal;
  return { ok, why: `d14 ${best?.move} ${best?.cp} ; ${good}/${legal} coups parent` };
}

/**
 * Une gaffe nette pour l'utilisateur au trait : un coup dont l'évaluation longue (profondeur 16, au plus 3 s)
 * est au moins 200 cp sous le seuil d'échec `lost` (point de vue de l'utilisateur). null si aucune n'est trouvée.
 */
export async function findBlunder(engine, fen, lost, rng) {
  const c = new Chess(fen);
  const legal = c.moves({ verbose: true });
  const lines = await engine.analyse(fen, { depth: 8, multipv: Math.min(legal.length, 40) });
  const cands = lines.filter(l => l.cp <= lost - 300);
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  for (const l of cands.slice(0, 4)) {
    const after = new Chess(fen);
    after.move({ from: l.move.slice(0, 2), to: l.move.slice(2, 4), promotion: l.move[4] || 'q' });
    if (after.isGameOver()) continue;
    const [r] = await engine.analyse(after.fen(), { depth: 16, movetime: 3000 });
    if (r && -r.cp <= lost - 200) return { move: l.move, long: -r.cp };
  }
  return null;
}

export const median = xs => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };
export const p90 = xs => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * 0.9))] : NaN; };
