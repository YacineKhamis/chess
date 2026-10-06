// Famille « kqk » : mat avec la dame (roi seul, ou pions bloqués — exercice mat-dame-pions).
// Faits propres : saut de cavalier, ombre de la dame, roi au bord (spec §5.2 F10, §5.3).
import { family, rule, X, boxViz } from '../rules.js';
import { F, R, cheb, edge, knightJump, units } from '../features.js';
import { idx } from '../board64.js';
import { cap, du, cases } from '../fr.js';

// Dame à un saut de cavalier du roi adverse, boîte plus petite ; jamais quand le roi est au bord (cases de pat).
rule({ id: 'knight-jump', run(c) {
  if (X.t(c) !== 'q' || !X.mating(c) || c.an.check || c.an.status || !X.safe(c)) return null;
  const Kd = c.an.king(c.def);
  if (!knightJump(c.m.to, Kd) || edge(Kd) === 0) return null;
  const a = X.boxB(c).size, b = X.boxA(c).size;
  if (!(b < a)) return null;
  return { tags: ['knight-jump', 'box-shrink'], data: { a, b }, idea: `Place ta dame à un saut de cavalier ${du(c.def)}.`,
    say: [`Ta dame se place à un saut de cavalier ${du(c.def)} : sa boîte passe de ${a} à ${cases(b)}.`], viz: boxViz(c), viz1: boxViz(c, false) };
} });

// L'ombre : la dame reproduit le déplacement que le roi adverse vient de faire (elle reste donc à un saut de cavalier).
rule({ id: 'shadow', run(c) {
  if (!c.lastMove || X.t(c) !== 'q' || !X.mating(c) || c.an.check || c.an.status || !X.safe(c)) return null;
  const lf = idx(c.lastMove.slice(0, 2)), lt = idx(c.lastMove.slice(2, 4)), m = c.m;
  if (lt !== X.Kd(c) || cheb(lf, lt) !== 1) return null;
  if (F(lt) - F(lf) !== F(m.to) - F(m.from) || R(lt) - R(lf) !== R(m.to) - R(m.from)) return null;
  if (!knightJump(m.to, lt) || edge(lt) === 0 || X.boxA(c).size > X.boxB(c).size) return null;
  return { tags: ['shadow'], idea: 'La dame suit le roi.',
    say: [`Ta dame suit ${X.K(c)} comme une ombre : même déplacement, toujours à un saut de cavalier.`], viz: boxViz(c), viz1: boxViz(c, false) };
} });

// Le roi adverse est enfermé sur une bande du bord : la dame a fini, le roi approche.
rule({ id: 'kqk-edge', run(c) {
  if (X.t(c) !== 'k' || !X.mating(c) || c.an.status || !X.safe(c) || !X.approach(c)) return null;
  const Kd = X.Kd(c);
  if (edge(Kd) !== 0) return null;
  const Z = [...X.boxB(c).zone];
  const onEdge = [s => F(s) === 0, s => F(s) === 7, s => R(s) === 0, s => R(s) === 7].filter(f => f(Kd));
  if (!onEdge.some(f => Z.every(f))) return null;
  if (!units(c.bn.g, c.us).some(u => u.t === 'q')) return null;
  return { tags: ['kqk-edge'], idea: `${cap(X.K(c))} est au bord : à ton roi de jouer.`,
    say: [`${cap(X.K(c))} est collé au bord : la dame a fini de le pousser.`, 'Amène maintenant ton roi.'], viz: boxViz(c), viz1: boxViz(c, false) };
} });

export default family({
  id: 'kqk',
  rules: ['mate', 'rescue', 'mate-every-reply', 'promote', 'knight-jump', 'shadow', 'box-shrink', 'kqk-edge', 'driving-check', 'approach', 'hanging-take', 'passed-push', 'lookahead', 'capture'],
  warnings: ['stalemate-danger', 'underpromo'],
  mistakes: ['stalemate', 'piece-lost', 'missed-mate', 'useless-check', 'box-grow', 'stalemate-risk', 'king-away'],
  fallback: {
    idea: 'Resserre la boîte avec ta dame, ou amène ton roi.',
    say: 'L’essentiel : ta dame resserre la boîte sans jamais pater, puis ton roi vient aider.',
  },
});
