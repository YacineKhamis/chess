// Famille « kpk » : roi et pion contre roi, côté attaquant (pion-roi-devant, pion-opposition, pion-cases-cles).
// Faits (spec §5.3) : promotion › case clé › opposition › coup d'attente du pion › débordement › coup d'épaule ›
// roi devant le pion › poussée sûre › compte exact des tables. Chaque « gagné » est lu dans les tables exactes.
import { family, rule, X, marks } from '../rules.js';
import { F, name, cheb } from '../features.js';
import { idx } from '../board64.js';
import { cap, king, au, coups } from '../fr.js';
import {
  relR, absSq, only, pawnB, pawnA, aheadNear, keySquares, inSquare, squareZone, tbA, tbOk, wonFor, kingSteps, blockSquares, oppKind,
} from './eg.js';

// Attaque : pion à nous, finale de pions pure, gain confirmé par les tables après le coup.
function attack(c) {
  if (c.an.status || !only(c.bn.g, 'kp')) return null;
  const P = pawnB(c);
  if (!P || P.color !== c.us || !tbOk(c, true)) return null;
  return P;
}
const keyViz = (P, extra = {}) => ({ zone: keySquares(P).map(name), zoneCls: 'zone-key', ...extra });

// F17 : le roi atteint une case clé ; les tables confirment le gain quel que soit le coup adverse.
rule({ id: 'key-square', run(c) {
  if (X.t(c) !== 'k') return null;
  const P = attack(c);
  if (!P) return null;
  const keys = keySquares(P);
  if (!keys.includes(c.m.to) || keys.includes(c.m.from)) return null;
  return { tags: ['key-square'], idea: 'Vise les cases clés du pion (en couleur).',
    say: [`Ton roi atteint la case clé ${name(c.m.to)} : la promotion est assurée, quoi que joue ${king(c.def)}.`],
    viz: keyViz(P, { marks: marks([c.m.to], 'mark-ok') }), viz1: keyViz(P) };
} });

// Coup d'attente du pion : les rois restent en opposition, mais c'est maintenant à l'adversaire de jouer.
rule({ id: 'pawn-tempo', aliases: ['waiting'], run(c) {
  if (X.t(c) !== 'p' || c.m.promo || c.m.cap || c.an.check) return null;
  const P = attack(c);
  if (!P) return null;
  const Ku = c.an.king(c.us), Kd = c.an.king(c.def), kind = oppKind(Ku, Kd);
  if (!kind) return null;
  return { tags: ['pawn-tempo', 'opposition-' + kind], idea: 'Un coup d’attente peut te donner l’opposition.',
    say: [`Coup d’attente du pion : les rois restent ${kind === 'direct' ? 'face à face' : 'en opposition'}, et c’est maintenant ${au(c.def)} de jouer.`],
    viz: { marks: marks([Ku, Kd], 'mark-ok') }, viz1: { marks: marks([Ku, Kd], 'mark-ok') } };
} });

// Débordement : le roi adverse vient de quitter l'opposition (il avait le trait) ; ton roi avance.
rule({ id: 'outflank', run(c) {
  if (X.t(c) !== 'k' || !c.lastMove) return null;
  const P = attack(c);
  if (!P) return null;
  const lf = idx(c.lastMove.slice(0, 2)), lt = idx(c.lastMove.slice(2, 4));
  if (lt !== c.bn.king(c.def) || cheb(lf, lt) !== 1 || !oppKind(c.m.from, lf) || oppKind(c.m.from, lt)) return null;
  if (relR(c.m.to, P.color) <= relR(c.m.from, P.color)) return null;
  const dxThem = F(lt) - F(lf), dxUs = F(c.m.to) - F(c.m.from);
  const other = dxThem !== 0 && Math.sign(dxUs) === -Math.sign(dxThem);
  return { tags: ['outflank'], idea: 'Le roi adverse a cédé le passage : déborde-le.',
    say: [other ? `Débordement : ${king(c.def)} a cédé le passage, ton roi avance de l’autre côté.`
      : `${cap(king(c.def))} a cédé le passage : ton roi en profite pour avancer.`],
    viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// F20 coup d'épaule : le roi adverse doit faire un détour pour se placer devant le pion.
rule({ id: 'shoulder', run(c) {
  if (X.t(c) !== 'k') return null;
  const P = attack(c);
  if (!P) return null;
  const Kd = c.an.king(c.def);
  const b = kingSteps(c.bn.g, Kd, c.def, blockSquares(c.bn.g, P));
  const a = kingSteps(c.an.g, Kd, c.def, blockSquares(c.an.g, P));
  if (!(a > b) || b === Infinity) return null;
  const path = [...Array(7 - P.rel)].map((_, k) => absSq(P.f, P.rel + 1 + k, P.color));
  if (a !== Infinity && a <= Math.min(...path.map(s => cheb(Kd, s)))) return null;
  const say = a === Infinity ? `Coup d’épaule : ton roi barre la route ${au(c.def)}, qui ne peut plus se placer devant ton pion.`
    : `Coup d’épaule : ton roi barre la route ${au(c.def)}, qui doit faire un détour pour se placer devant ton pion (${coups(a)} au lieu de ${b}).`;
  return { tags: ['shoulder'], data: { a, b }, idea: `Barre la route ${au(c.def)}.`, say: [say],
    viz: { marks: marks([c.m.to, Kd], 'mark-ok') }, viz1: {} };
} });

// F21 roi devant son pion : il passe devant, ou avance encore devant lui.
rule({ id: 'king-in-front', run(c) {
  if (X.t(c) !== 'k') return null;
  const P = attack(c);
  if (!P || !aheadNear(c.m.to, P)) return null;
  const before = aheadNear(c.m.from, P);
  if (before && relR(c.m.to, P.color) <= relR(c.m.from, P.color)) return null;
  return { tags: ['king-in-front'], idea: 'Ton roi doit ouvrir la route au pion.',
    say: [before ? 'Ton roi avance devant son pion : il lui ouvre la route vers la promotion.'
      : 'Ton roi passe devant son pion : il lui ouvre la route vers la promotion.'],
    viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Le roi d'abord : il se rapproche des cases clés (le pion attend).
rule({ id: 'king-first', run(c) {
  if (X.t(c) !== 'k') return null;
  const P = attack(c);
  if (!P) return null;
  const keys = keySquares(P);
  if (!keys.length || keys.includes(c.m.from) || keys.includes(c.m.to)) return null;
  const d = s => Math.min(...keys.map(k => cheb(s, k))), d0 = d(c.m.from), d1 = d(c.m.to);
  if (!(d1 < d0)) return null;
  return { tags: ['king-first'], data: { d0, d1 }, idea: 'Vise les cases clés du pion (en couleur).',
    say: [`Le roi d’abord : ton roi se rapproche des cases clés du pion (distance ${d0} → ${d1}).`],
    viz: keyViz(P), viz1: keyViz(P) };
} });

// Poussée sûre (tables : gain après la poussée), avec la meilleure raison géométrique disponible.
rule({ id: 'safe-push', run(c) {
  if (X.t(c) !== 'p' || c.m.promo || c.m.cap) return null;
  const P = attack(c);
  if (!P) return null;
  const P1 = pawnA(c), Kd = c.an.king(c.def), Ku = c.an.king(c.us);
  if (!P1) return null;
  const K = king(c.def);
  let say, tags = ['safe-push'], viz = { marks: marks([c.m.to], 'mark-ok') };
  if (!inSquare(Kd, P1, true)) {
    say = `Ton pion avance : ${K} est hors du carré, il ne peut plus le rattraper.`; tags.push('out-of-square');
    viz = { zone: squareZone(P1), zoneCls: 'zone-key' };
  } else if (keySquares(P).includes(Ku)) {
    say = 'Ton roi tient déjà une case clé : le pion peut avancer, la promotion est assurée.'; tags.push('key-held');
    viz = keyViz(P, { marks: marks([Ku], 'mark-ok') });
  } else if (cheb(Ku, c.m.to) === 1) {
    say = `Ton pion avance sous la protection de ton roi : ${K} ne peut pas l’arrêter.`; tags.push('protected');
  } else say = `Ton pion avance : ${K} ne peut pas l’arrêter.`;
  return { tags, idea: 'Le pion peut-il avancer sans risque ?', say: [say], viz, viz1: {} };
} });

// Compte exact des tables (dernier recours avant le repli) : « promu en N coups au plus ».
rule({ id: 'tb-count', run(c) {
  const P = attack(c);
  if (!P) return null;
  const p = tbA(c);
  if (!wonFor(p, c.us) || !(p.dist > 0)) return null;
  return { tags: ['tb-count'], data: { dist: p.dist }, idea: 'Le roi d’abord, le pion ensuite.',
    say: [`Après ce coup, ton pion sera promu en ${coups(p.dist)} au plus, quoi que joue ${king(c.def)}.`] };
} });

export default family({
  id: 'kpk',
  rules: ['mate', 'rescue', 'promote', 'key-square', 'opposition', 'pawn-tempo', 'outflank', 'shoulder', 'king-in-front', 'king-first',
    'safe-push', 'tb-count'],
  warnings: ['underpromo', 'stalemate-danger'],
  mistakes: ['stalemate', 'push-too-early', 'opposition-given', 'entered-square', 'piece-lost'],
  fallback: {
    idea: 'Le roi d’abord : vise les cases devant le pion.',
    say: 'L’essentiel : ton roi ouvre la route, le pion ne monte que lorsque la case devant lui est à toi.',
  },
});
