// Famille « krk » : mat avec la tour (roi seul, ou pions bloqués — exercice mat-tour-pions).
// Faits propres : échec en opposition, coup d'attente, roi face au roi (spec §5.2 F9, F13, §5.3).
import { family, rule, X, boxViz, marks } from '../rules.js';
import { F, R, typeOf, units, legalMoves, play, inCheck, opposition, goodReplies } from '../features.js';
import { cap, mine, au, lineNoun } from '../fr.js';

// Les rois se font face ; l'échec de la tour (ou de la dame) sur la ligne du roi adverse le fait reculer d'un cran.
rule({ id: 'opposition-check', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate || ch.kind !== 'direct' || !X.mating(c)) return null;
  const t = X.t(c);
  if (t !== 'r' && t !== 'q') return null;
  const Ku = X.Ku(c), Kd = X.Kd(c);
  if (opposition(Ku, Kd) !== 'direct') return null;
  const vertical = F(Ku) === F(Kd);
  if (vertical ? R(c.m.to) !== R(Kd) : F(c.m.to) !== F(Kd)) return null;
  const co = vertical ? R : F, d0 = Math.abs(co(Kd) - co(Ku));
  if (!ch.replies.length || !ch.replies.every(r => typeOf(r.p) === 'k' && !r.cap && Math.abs(co(r.to) - co(Ku)) === d0 + 1)) return null;
  return { tags: ['opposition-check'], idea: 'Les rois se font face : profites-en.',
    say: [`Les rois se font face : l’échec de ${mine(t)} oblige ${X.K(c)} à reculer d’une ${lineNoun(vertical ? 'rank' : 'file')}.`],
    viz: { ...boxViz(c), marks: marks([Ku, Kd], 'mark-ok') }, viz1: { marks: marks([Ku, Kd], 'mark-ok') } };
} });

// Coup d'attente (F13) : rien ne change (boîte, coupures), mais l'adversaire, au trait, n'a plus de bon coup.
rule({ id: 'waiting', run(c) {
  if (!X.mating(c) || c.an.check || c.an.status || c.m.cap || c.bn.check || !X.safe(c)) return null;
  if (X.approach(c) || X.boxA(c).size !== X.boxB(c).size) return null;
  const key = cs => cs.map(x => x.kind + x.idx).sort().join();
  if (key(X.cutsB(c)) !== key(X.cutsA(c))) return null;
  const nl = c.bn.nul;
  if (!nl || !nl.kingOnly || !c.an.kingOnly) return null;
  if (!goodReplies(nl, c.def).length) return null;
  if (goodReplies(c.an, c.def).length) return null;
  const cut = X.realCutsA(c)[0];
  return { tags: ['waiting'], idea: 'Ne change rien à la boîte : cherche un coup d’attente.',
    say: [`Coup d’attente : ${cut ? `${mine(cut.t)} garde la même coupure et ` : ''}c’est ${au(c.def)} de jouer.`,
      'Chacun de ses coups te permettra de resserrer la boîte ou de mater.'],
    viz: boxViz(c), viz1: boxViz(c, false) };
} });

// Le roi vient en opposition directe ; si c'était encore à nous, un échec sur la ligne le ferait reculer.
rule({ id: 'approach-opp', run(c) {
  if (X.t(c) !== 'k' || !X.mating(c) || c.an.status || !X.safe(c) || !X.approach(c)) return null;
  const Kd = X.Kd(c);
  if (opposition(c.m.to, Kd) !== 'direct') return null;
  const nl = c.an.nul;
  if (!nl) return null;
  const vertical = F(c.m.to) === F(Kd), co = vertical ? R : F, d0 = Math.abs(co(Kd) - co(c.m.to));
  const ok = nl.legal.some(m2 => {
    if (!'rq'.includes(typeOf(m2.p)) || (vertical ? R(m2.to) !== R(Kd) : F(m2.to) !== F(Kd))) return false;
    const p2 = play(nl.pos, m2);
    if (!inCheck(p2)) return false;
    const rs = legalMoves(p2);
    return rs.length > 0 && rs.every(r => typeOf(r.p) === 'k' && !r.cap && Math.abs(co(r.to) - co(c.m.to)) === d0 + 1);
  });
  if (!ok) return null;
  const piece = units(c.an.g, c.us).find(u => u.t === 'r' || u.t === 'q');
  return { tags: ['approach-opp', 'approach'], idea: 'Ton roi doit participer : pense à l’opposition.',
    say: [`Ton roi se place face ${au(c.def)} : quand les rois se font face, l’échec de ${mine(piece.t)} le fait reculer.`],
    viz: { ...boxViz(c), marks: marks([c.m.to, Kd], 'mark-ok') }, viz1: boxViz(c, false) };
} });

export default family({
  id: 'krk',
  rules: ['mate', 'rescue', 'preemptive-flee', 'mate-every-reply', 'promote', 'opposition-check', 'box-shrink', 'waiting',
    'approach-opp', 'approach', 'driving-check', 'hanging-take', 'passed-push', 'lookahead', 'capture'],
  warnings: ['stalemate-danger', 'underpromo'],
  mistakes: ['stalemate', 'piece-lost', 'missed-mate', 'useless-check', 'box-grow', 'cut-lost', 'stalemate-risk', 'king-away'],
  fallback: {
    idea: 'Garde la coupure et rapproche ton roi.',
    say: 'L’essentiel : garder la coupure et rapprocher ton roi.',
  },
});
