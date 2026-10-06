// Famille « krrk » : mat avec deux tours (spec §5.2 F15) : l'escalier, la tour qui part loin du roi.
import { family, rule, X, boxViz, marks, lineKind, lineOfSq } from '../rules.js';
import { F, R, name, typeOf, cheb, units, threatsNext } from '../features.js';
import { cap, mine, du, line, lineNoun } from '../fr.js';

// Escalier : une tour donne échec sur la ligne du roi pendant que l'autre garde la ligne voisine ; il doit reculer.
rule({ id: 'ladder', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate || ch.kind !== 'direct' || X.t(c) !== 'r' || !X.mating(c) || !X.safe(c)) return null;
  const Kd = X.Kd(c), m = c.m;
  const kind = R(m.to) === R(Kd) ? 'rank' : F(m.to) === F(Kd) ? 'file' : null;
  if (!kind) return null;
  const co = kind === 'rank' ? R : F, L = co(m.to);
  for (const o of units(c.an.g, c.us).filter(u => u.t === 'r' && u.i !== m.to && Math.abs(co(u.i) - L) === 1)) {
    const s = co(o.i) - L;
    if (!ch.replies.length || !ch.replies.every(r => typeOf(r.p) === 'k' && !r.cap && co(r.to) === L - s)) continue;
    return { tags: ['ladder'], idea: 'Escalier : une tour coupe, l’autre donne échec.',
      say: [`Escalier : ta tour en ${name(o.i)} garde ${line(kind, co(o.i))} pendant que l’autre donne échec sur ${line(kind, L)}.`,
        `${cap(X.K(c))} doit reculer d’une ${lineNoun(kind)}.`],
      viz: { marks: marks(ch.replies.map(r => r.to), 'mark-escape') }, viz1: boxViz(c, false) };
  }
  return null;
} });

// Une tour trop près du roi adverse part le long de sa ligne, hors de sa portée (vérifié : aucune de ses réponses
// ne lui permet ensuite de la prendre).
rule({ id: 'rook-far', run(c) {
  if (X.t(c) !== 'r' || !X.mating(c) || c.an.check || c.an.status || !X.safe(c)) return null;
  const Kd = X.Kd(c), m = c.m, kind = lineKind(m.from, m.to);
  if (!kind || cheb(m.from, Kd) > 2 || cheb(m.to, Kd) < 3) return null;
  const al = kind === 'file' ? R : F;
  const dTo = Math.abs(al(m.to) - al(Kd)), dFrom = Math.abs(al(m.from) - al(Kd));
  if (dTo <= dFrom || dTo < 3) return null;
  if (threatsNext(c.an).some(x => x.caps.some(k => k.to === m.to))) return null;
  const end = al(m.to) === 0 || al(m.to) === 7;
  const L = line(kind, lineOfSq(kind, m.to));
  const cut = X.realCutsA(c).find(x => x.sq === m.to && x.kind === kind);
  return { tags: ['rook-far'], idea: `${cap(mine('r'))} est trop près ${du(c.def)}.`,
    say: [`${cap(mine('r'))} s’éloigne ${end ? 'au bout' : 'le long'} de ${L}, hors de portée ${du(c.def)}${cut ? ', et la coupure reste en place' : ''}.`],
    viz: boxViz(c), viz1: { marks: { [name(m.from)]: 'mark-ko' } } };
} });

export default family({
  id: 'krrk',
  rules: ['mate', 'rescue', 'mate-every-reply', 'promote', 'ladder', 'rook-far', 'box-shrink', 'driving-check', 'approach', 'hanging-take', 'passed-push', 'lookahead', 'capture'],
  warnings: ['stalemate-danger', 'underpromo'],
  mistakes: ['stalemate', 'piece-lost', 'missed-mate', 'useless-check', 'box-grow', 'cut-lost', 'stalemate-risk'],
  fallback: {
    idea: 'Fais avancer tes tours en escalier, loin du roi adverse.',
    say: 'L’essentiel : les tours avancent en escalier, l’une coupe, l’autre donne échec, toujours loin du roi adverse.',
  },
});
