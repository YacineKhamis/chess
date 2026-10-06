// Famille « krkp » (tour-contre-pion) : la tour et le roi contre roi et pion.
// Faits (spec §5.3) : prise du pion (table KRK) › coupure › roi devant le pion › tour derrière le pion › rapprochement.
// Pas de table à 4 pièces : chaque phrase est géométrique et vérifiée sur l'échiquier.
import { family, rule, X, marks } from '../rules.js';
import { F, R, name, cheb, between, realCut, cage } from '../features.js';
import { king, line } from '../fr.js';
import { relR, pawnB, onPath } from './eg.js';

const theirPawn = c => { const P = pawnB(c); return P && P.color === c.def ? P : null; };
const lineOf = (kind, s) => (kind === 'file' ? F(s) : R(s));

// Coupure : la tour, sur une ligne libre, sépare le roi adverse de son pion (ou l'enferme d'un côté).
rule({ id: 'pawn-cut', aliases: ['cut'], run(c) {
  if (X.t(c) !== 'r' || c.an.status || c.an.check || !X.safe(c)) return null;
  const P = theirPawn(c);
  if (!P) return null;
  const cuts = X.cutsA(c).filter(x => x.sq === c.m.to && realCut(c.an.g, c.def, x));
  if (!cuts.length) return null;
  const before = X.cutsB(c);
  const cut = cuts.find(x => !before.some(y => y.kind === x.kind && y.idx === x.idx));
  if (!cut) return null;
  const L = line(cut.kind, cut.idx), K = king(c.def);
  const pawnOther = Math.sign(lineOf(cut.kind, P.sq) - cut.idx) !== cut.side && lineOf(cut.kind, P.sq) !== cut.idx;
  // Le roi peut-il aller attaquer la tour (case atteignable à côté d'elle) ? Alors on ne promet pas « il ne peut pas franchir ».
  const leak = cage(c.an.g, c.def).leaks.includes(c.m.to);
  const say = pawnOther ? (leak ? `Ta tour coupe ${K} de son pion : tant qu’elle tient ${L}, il ne peut pas la franchir.` : `Ta tour coupe ${K} de son pion : il ne peut pas franchir ${L}.`)
    : (leak ? `Ta tour coupe ${K} sur ${L} : tant qu’elle la tient, il ne peut pas la franchir.` : `Ta tour coupe ${K} sur ${L} : il ne peut pas la franchir.`);
  return { tags: ['pawn-cut', 'cut'], idea: 'Coupe le roi adverse avec ta tour.', say: [say],
    viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Le roi se place devant le pion adverse, sur sa route vers la promotion.
rule({ id: 'king-blocks', aliases: ['king-in-front'], run(c) {
  if (X.t(c) !== 'k' || c.an.status || !X.safe(c)) return null;
  const P = theirPawn(c);
  if (!P || !onPath(c.m.to, P) || onPath(c.m.from, P)) return null;
  return { tags: ['king-blocks'], idea: 'Ton roi doit barrer la route au pion.',
    say: [`Ton roi se place devant le pion : il lui barre la route vers la promotion.`],
    viz: { marks: marks([c.m.to, P.promo], 'mark-ok') }, viz1: { marks: marks([P.promo], 'mark-key') } };
} });

// La tour derrière le pion (sur sa colonne, du côté d'où il vient), ligne libre jusqu'à lui.
rule({ id: 'rook-behind', run(c) {
  if (X.t(c) !== 'r' || c.an.status || !X.safe(c)) return null;
  const P = theirPawn(c);
  if (!P || F(c.m.to) !== P.f || relR(c.m.to, P.color) >= P.rel) return null;
  if (between(c.m.to, P.sq).some(s => c.an.g[s])) return null;
  if (F(c.m.from) === P.f && relR(c.m.from, P.color) < P.rel) return null;
  return { tags: ['rook-behind'], idea: 'Place ta tour derrière le pion.',
    say: ['Ta tour se place derrière le pion et l’attaque : elle pourra le suivre jusqu’au bout.'],
    viz: { marks: marks([P.sq], 'mark-ko') }, viz1: {} };
} });

// La tour devant le pion : elle garde sa case de promotion.
rule({ id: 'rook-front', run(c) {
  if (X.t(c) !== 'r' || c.an.status || !X.safe(c)) return null;
  const P = theirPawn(c);
  if (!P || !onPath(c.m.to, P) || F(c.m.from) === P.f) return null;
  if (c.m.to !== P.promo && between(c.m.to, P.promo).some(s => c.an.g[s])) return null;
  return { tags: ['rook-front'], idea: 'Contrôle la case de promotion.',
    say: [`Ta tour se place devant le pion, sur sa colonne : elle garde la case de promotion ${name(P.promo)}.`],
    viz: { marks: marks([P.promo], 'mark-key') }, viz1: {} };
} });

// Le roi se rapproche du pion (distance de Chebyshev).
rule({ id: 'pawn-approach-r', aliases: ['approach'], run(c) {
  if (X.t(c) !== 'k' || c.an.status || c.m.cap || !X.safe(c)) return null;
  const P = theirPawn(c);
  if (!P) return null;
  const d0 = cheb(c.m.from, P.sq), d1 = cheb(c.m.to, P.sq);
  if (!(d1 < d0)) return null;
  return { tags: ['pawn-approach', 'approach'], data: { d0, d1 }, idea: 'Ton roi doit venir chercher le pion.',
    say: [`Ton roi se rapproche du pion (distance ${d0} → ${d1}).`], viz: { marks: marks([c.m.to, P.sq], 'mark-ok') }, viz1: {} };
} });

export default family({
  id: 'krkp',
  rules: ['mate', 'rescue', 'preemptive-flee', 'mate-every-reply', 'win-pawn', 'pawn-cut', 'king-blocks', 'rook-behind', 'rook-front',
    'pawn-approach-r', 'driving-check', 'box-shrink', 'approach', 'hanging-take', 'lookahead', 'check', 'capture'],
  warnings: ['stalemate-danger', 'underpromo'],
  mistakes: ['stalemate', 'piece-lost', 'missed-mate', 'allows-mate', 'allows-promotion', 'cut-lost'],
  fallback: {
    idea: 'Coupe le roi adverse, puis ramène ton roi devant le pion.',
    say: 'L’essentiel : la tour coupe le roi adverse, ton roi vient se placer devant le pion.',
  },
});

