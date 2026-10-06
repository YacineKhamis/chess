// Famille « kpk-def » : roi seul contre roi et pion (pion-carre, pion-defense, pion-tour), côté défenseur.
// Faits (spec §5.3) : prise du pion › opposition › devant le pion › recul tout droit › coin du pion de la tour ›
// carré du pion › marche en diagonale › attaque du pion › rapprochement. « Nulle » est lu dans les tables exactes.
import { family, rule, X, marks } from '../rules.js';
import { F, name, typeOf, cheb } from '../features.js';
import { king } from '../fr.js';
import {
  relR, only, pawnB, onPath, inSquare, squareZone, tbOk, cornerZone, kingMoves,
} from './eg.js';

// Défense : pion adverse, finale de pions pure, nulle confirmée par les tables après le coup.
function defence(c) {
  if (c.an.status || X.t(c) !== 'k' || !only(c.bn.g, 'kp')) return null;
  const P = pawnB(c);
  if (!P || P.color === c.us || !tbOk(c, false)) return null;
  return P;
}

rule({ id: 'take-pawn', run(c) {
  if (X.t(c) !== 'k' || typeOf(c.m.cap) !== 'p' || !only(c.an.g, 'k')) return null;
  return { tags: ['take-pawn'], idea: 'Le pion n’est pas protégé.', say: ['Tu prends le pion : il ne reste que les deux rois, c’est nulle.'],
    viz: { marks: marks([c.m.to], 'mark-ok') } };
} });

// Pion de la tour : le roi adverse, devant son pion, ne peut plus quitter la colonne (il est enfermé).
rule({ id: 'lock-in', aliases: ['rook-pawn-corner'], run(c) {
  const P = defence(c);
  if (!P || !P.rook) return null;
  const Ka = c.an.king(c.def);
  if (!onPath(Ka, P)) return null;
  const ks = kingMoves(c.an);
  if (!ks.every(r => F(r.to) === P.f)) return null;
  return { tags: ['lock-in'], idea: 'Enferme le roi adverse devant son pion.',
    say: [`Ton roi enferme ${king(c.def)} devant son pion : il ne peut pas quitter la colonne ${'abcdefgh'[P.f]}.`],
    viz: { marks: marks([Ka], 'mark-ko') }, viz1: { marks: marks([Ka], 'mark-ko') } };
} });

// Pion de la tour : le coin (nulle vérifiée sur toute la table pour les quatre cases du coin).
rule({ id: 'rook-pawn-corner', run(c) {
  const P = defence(c);
  if (!P || !P.rook) return null;
  const Z = cornerZone(P), inA = Z.includes(c.m.to), inB = Z.includes(c.m.from);
  const zone = Z.map(name);
  if (inA) return { tags: ['rook-pawn-corner'], idea: 'Pion de la tour : va vers le coin.',
    say: [inB ? 'Pion de la tour : ton roi reste dans le coin, c’est nulle.' : 'Pion de la tour : ton roi atteint le coin, c’est nulle.'],
    viz: { zone, zoneCls: 'zone-ok', marks: marks([c.m.to], 'mark-ok') }, viz1: { zone, zoneCls: 'zone-ok' } };
  if (cheb(c.m.to, P.promo) >= cheb(c.m.from, P.promo)) return null;
  return { tags: ['rook-pawn-corner'], idea: 'Pion de la tour : va vers le coin.',
    say: ['Pion de la tour : ton roi file vers le coin ; une fois dedans, c’est nulle.'],
    viz: { zone, zoneCls: 'zone-ok' }, viz1: { zone, zoneCls: 'zone-ok' } };
} });

// F18 carré du pion : le roi y entre (ou y reste) ; les tables confirment qu'il arrive à temps.
rule({ id: 'enter-square', run(c) {
  const P = defence(c);
  if (!P || !inSquare(c.m.to, P) || cheb(c.an.king(c.def), P.sq) <= 2) return null;
  const zone = squareZone(P), was = inSquare(c.m.from, P);
  if (was && cheb(c.m.to, P.promo) >= cheb(c.m.from, P.promo) && cheb(c.m.to, P.sq) >= cheb(c.m.from, P.sq)) return null;
  return { tags: ['enter-square'], idea: 'Ton roi peut-il entrer dans le carré du pion ?',
    say: [was ? 'Ton roi reste dans le carré du pion : il arrivera à temps pour l’arrêter.'
      : 'Ton roi entre dans le carré du pion : il arrivera à temps pour l’arrêter.'],
    viz: { zone, zoneCls: 'zone-ok', marks: marks([c.m.to], 'mark-ok') }, viz1: { zone, zoneCls: 'zone-ok' } };
} });

// En diagonale, le roi se rapproche à la fois de la colonne du pion et de sa case de promotion.
rule({ id: 'diagonal-walk', run(c) {
  const P = defence(c);
  if (!P || F(c.m.to) === F(c.m.from) || relR(c.m.to, P.color) === relR(c.m.from, P.color)) return null;
  if (!(Math.abs(F(c.m.to) - P.f) < Math.abs(F(c.m.from) - P.f)) || !(cheb(c.m.to, P.promo) < cheb(c.m.from, P.promo))) return null;
  return { tags: ['diagonal-walk'], idea: 'Un pas en diagonale vaut un pas droit.',
    say: ['En diagonale, ton roi se rapproche à la fois de la colonne du pion et de sa case de promotion.'],
    viz: { zone: squareZone(P), zoneCls: 'zone-ok' }, viz1: {} };
} });

// Le roi attaque le pion, que l'autre roi ne protège pas.
rule({ id: 'attack-pawn', run(c) {
  const P = defence(c);
  if (!P || cheb(c.m.to, P.sq) !== 1 || cheb(c.m.from, P.sq) === 1) return null;
  if (cheb(c.an.king(c.def), P.sq) === 1) return null;
  return { tags: ['attack-pawn'], idea: 'Le pion est-il protégé ?', say: [`Ton roi attaque le pion : ${king(c.def)} ne le protège pas.`],
    viz: { marks: marks([P.sq], 'mark-ko') }, viz1: {} };
} });

// Rapprochement vérifié par les tables (nulle tenue).
rule({ id: 'chase', run(c) {
  const P = defence(c);
  if (!P) return null;
  const d0 = cheb(c.m.from, P.sq), d1 = cheb(c.m.to, P.sq);
  if (!(d1 < d0)) return null;
  return { tags: ['chase'], data: { d0, d1 }, idea: 'Rapproche ton roi du pion.',
    say: [`Ton roi se rapproche du pion (distance ${d0} → ${d1}) et tient la nulle.`], viz: { marks: marks([P.sq], 'mark-key') }, viz1: {} };
} });

export default family({
  id: 'kpk-def',
  rules: ['stalemate-save', 'take-pawn', 'hanging-take', 'opposition', 'def-front', 'def-straight', 'rook-pawn-corner', 'lock-in', 'enter-square', 'diagonal-walk', 'attack-pawn', 'chase'],
  warnings: [],
  mistakes: ['stalemate', 'entered-square', 'opposition-given'],
  fallback: {
    idea: 'Reste devant le pion, ou rattrape-le.',
    say: 'L’essentiel : ton roi doit rester devant le pion, ou le rattraper.',
  },
});

