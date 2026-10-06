// Familles « kqkp » (dame-contre-pion : gagner) et « kqkp-def » (dame-contre-pion-nulle : la défense par le pat).
// Pas de table à 4 pièces : chaque phrase est un fait vérifié sur l'échiquier (coups légaux à 1 ou 2 demi-coups) ;
// « gagné » n'est dit qu'après la prise du pion, quand la table KQK le confirme.
import { family, rule, reason, X, marks } from '../rules.js';
import { name, typeOf, cheb, units, captures, pins, pieceAttacks } from '../features.js';
import { cap, king, mv, mine } from '../fr.js';
import { pawnB, soloPawn, probe, wonFor } from './eg.js';

// Le pion adverse (celui du défenseur) : pion de c.def.
const theirPawn = c => { const P = pawnB(c); return P && P.color === c.def ? P : null; };
const ourPawn = c => { const P = pawnB(c); return P && P.color === c.us ? P : null; };
const pawnMoves = n => n.legal.filter(m => typeOf(m.p) === 'p');

// Prise du pion confirmée par la table (KQK / KRK) : le gain est exact.
rule({ id: 'win-pawn', run(c) {
  if (typeOf(c.m.cap) !== 'p' || c.an.status) return null;
  const p = probe(c, c.an.fen);
  if (!wonFor(p, c.us)) return null;
  const left = units(c.an.g, c.us).find(u => u.t === 'q' || u.t === 'r');
  if (!left) return null;
  return { tags: ['win-pawn'], idea: 'Le pion peut-il être pris ?',
    say: [`Tu prends le pion : ${mine(left.t)} contre le roi seul, c’est gagné.`], viz: { marks: marks([c.m.to], 'mark-ok') } };
} });

// Après la réponse r (nous au trait dans n2), pouvons-nous prendre le pion (ou la pièce promue) sans la perdre ?
function punishes(n2, us, target) {
  for (const x of n2.legal) {
    if (x.to !== target || !x.cap) continue;
    const n3 = n2.child(x);
    if (n3.status === 'stalemate') continue;
    if (captures(n3).some(y => y.to === x.to)) continue;
    return x;
  }
  return null;
}

// « in-front » : après l'échec ou le clouage de la dame, le roi adverse doit se placer devant son pion.
rule({ id: 'in-front', run(c) {
  if (X.t(c) !== 'q' || c.an.status || c.m.cap) return null;
  const P = theirPawn(c);
  if (!P || P.rel !== 6) return null;
  const Q = P.promo, replies = c.an.legal;
  const front = replies.filter(r => typeOf(r.p) === 'k' && r.to === Q);
  if (!front.length) return null;
  const others = replies.filter(r => !(typeOf(r.p) === 'k' && r.to === Q));
  for (const r of others) {
    const n2 = c.an.child(r), target = r.promo ? r.to : (typeOf(r.p) === 'p' ? r.to : P.sq);
    if (!punishes(n2, c.us, target)) return null;
  }
  const r0 = front[0], s = mv(c.san), K = king(c.def), sq = name(Q);
  const say = others.length
    ? `Après ${s}, ${K} doit se placer en ${sq}, devant son pion, sinon il le perd : ton roi gagne un temps.`
    : `Après ${s}, ${K} n’a qu’un coup, ${mv(c.an.san(r0))}, devant son pion : ton roi gagne un temps pour approcher.`;
  return { tags: ['in-front'], idea: `Force ${K} à se placer devant son pion.`, say: [say],
    viz: { marks: marks([Q], 'mark-key'), arrows: [{ from: name(r0.from), to: name(r0.to), cls: 'plan' }] }, viz1: { marks: marks([Q], 'mark-key') } };
} });

// La dame cloue le pion contre son roi : il ne peut pas avancer.
rule({ id: 'pawn-pin', aliases: ['in-front'], run(c) {
  if (X.t(c) !== 'q' || c.an.status) return null;
  const P = theirPawn(c);
  if (!P) return null;
  const pin = pins(c.an.g, c.us).find(p => p.abs && p.sq === P.sq && p.by === c.m.to);
  if (!pin || pawnMoves(c.an).length) return null;
  return { tags: ['pawn-pin'], idea: 'La dame peut immobiliser le pion.',
    say: [`Ta dame cloue le pion contre son roi : il ne peut pas avancer.`],
    viz: { marks: marks([P.sq], 'mark-ko'), arrows: [{ from: name(c.m.to), to: name(pin.behind), cls: 'good' }] }, viz1: { marks: marks([P.sq], 'mark-ko') } };
} });

// La dame attaque le pion, que son roi ne protège pas : chaque réponse doit le défendre, sinon il tombe.
rule({ id: 'queen-attacks-pawn', run(c) {
  if (X.t(c) !== 'q' || c.an.status || c.m.cap) return null;
  const P = theirPawn(c);
  if (!P) return null;
  const Kd = c.an.king(c.def);
  if (!pieceAttacks(c.an.g, c.m.to)[P.sq] || cheb(Kd, P.sq) <= 1 || pieceAttacks(c.bn.g, c.m.from)[P.sq]) return null;
  for (const r of c.an.legal) {
    const n2 = c.an.child(r), P2 = soloPawn(n2.g);
    if (P2 && P2.color === c.def && cheb(n2.king(c.def), P2.sq) <= 1) continue;
    const target = r.promo ? r.to : typeOf(r.p) === 'p' ? r.to : P.sq;
    if (!punishes(n2, c.us, target)) return null;
  }
  return { tags: ['queen-attacks-pawn'], idea: 'Le pion est-il protégé ?',
    say: [`Ta dame attaque le pion sans défense : ${king(c.def)} doit revenir le protéger, sinon tu le prends.`],
    viz: { marks: marks([P.sq], 'mark-ko') }, viz1: { marks: marks([P.sq], 'mark-ko') } };
} });

// La dame surveille la case de promotion : si le pion va à dame, elle prend la nouvelle pièce.
rule({ id: 'promo-watch', run(c) {
  if (X.t(c) !== 'q' || c.an.status || c.m.cap) return null;
  const P = theirPawn(c);
  if (!P || P.rel !== 6 || !pieceAttacks(c.an.g, c.m.to)[P.promo]) return null;
  const promos = c.an.legal.filter(r => r.promo);
  if (!promos.length || !promos.every(r => punishes(c.an.child(r), c.us, r.to))) return null;
  return { tags: ['promo-watch'], idea: 'Surveille la case de promotion.',
    say: [`Ta dame surveille la case de promotion ${name(P.promo)} : si le pion avance, elle prend la nouvelle dame.`],
    viz: { marks: marks([P.promo], 'mark-key') }, viz1: { marks: marks([P.promo], 'mark-key') } };
} });

// Échec avec gain de temps : l'adversaire doit répondre à l'échec, le pion n'a pas le temps d'avancer.
rule({ id: 'tempo-check', run(c) {
  if (X.t(c) !== 'q' || !c.an.check || c.an.status) return null;
  const P = theirPawn(c);
  if (!P || pawnMoves(c.an).length) return null;
  const closer = cheb(c.m.to, P.sq) < cheb(c.m.from, P.sq);
  return { tags: ['tempo-check'], idea: 'Un échec gagne du temps.',
    say: [closer ? `Ta dame se rapproche avec échec : ${king(c.def)} doit répondre, et son pion n’a pas le temps d’avancer.`
      : `Échec : ${king(c.def)} doit répondre, et son pion n’a pas le temps d’avancer.`],
    viz: { marks: marks([c.an.king(c.def)], 'mark-ko') } };
} });

// Le pion ne peut pas avancer (bloqué par son roi, ou cloué) : ton roi en profite pour approcher.
rule({ id: 'pawn-approach', aliases: ['approach'], run(c) {
  if (X.t(c) !== 'k' || c.an.status || c.m.cap) return null;
  const P = theirPawn(c);
  if (!P) return null;
  const d0 = cheb(c.m.from, P.sq), d1 = cheb(c.m.to, P.sq);
  if (!(d1 < d0)) return null;
  if (!X.safe(c)) return null;
  const blocked = !pawnMoves(c.an).length;
  const K = king(c.def), front = c.an.king(c.def) === P.promo;
  const say = blocked && front ? `${cap(K)} bloque son propre pion : ton roi en profite pour se rapprocher (distance ${d0} → ${d1}).`
    : blocked ? `Le pion ne peut pas avancer pour l’instant : ton roi en profite pour se rapprocher (distance ${d0} → ${d1}).`
    : `Ton roi se rapproche du pion (distance ${d0} → ${d1}).`;
  return { tags: ['pawn-approach', 'approach'], data: { d0, d1 }, idea: 'Ton roi doit venir aider.', say: [say],
    viz: { marks: marks([c.m.to, P.sq], 'mark-ok') }, viz1: {} };
} });

// Erreur : le coup laisse le pion adverse aller à dame, sans que la nouvelle dame puisse être prise.
const safePromotion = x => x.an.legal.find(r => r.promo === 'q' && !x.an.child(r).legal.some(y => y.to === r.to && y.cap));
reason({ id: 'allows-promotion', run(u, b) {
  if (u.an.status) return null;
  const P = soloPawn(u.an.g);
  if (!P || P.color !== u.def) return null;
  const r = safePromotion(u);
  if (!r || (b && !b.an.status && safePromotion(b))) return null;
  return { say: `Ton coup laisse le pion aller à dame : après ${mv(u.an.san(r))}, tu ne peux pas prendre la nouvelle dame.`,
    tags: ['allows-promotion'], viz: { arrows: [{ from: name(r.from), to: name(r.to), cls: 'threat' }] } };
} });

export default family({
  id: 'kqkp',
  rules: ['mate', 'rescue', 'mate-every-reply', 'win-pawn', 'in-front', 'pawn-pin', 'pawn-approach', 'tempo-check', 'queen-attacks-pawn',
    'promo-watch', 'driving-check',
    'box-shrink', 'approach', 'hanging-take', 'lookahead', 'check', 'capture'],
  warnings: ['stalemate-danger', 'underpromo'],
  mistakes: ['stalemate', 'piece-lost', 'missed-mate', 'allows-mate', 'allows-promotion'],
  fallback: {
    idea: 'Échecs et clouages : force le roi devant son pion.',
    say: 'L’essentiel : échecs et clouages pour forcer le roi devant son pion, et chaque fois ton roi gagne un pas.',
  },
});

// =====================================================================================================
// kqkp-def : nous avons le pion (en 7e), l'adversaire la dame.
// =====================================================================================================
// La dame peut prendre le pion maintenant, et chaque prise fait pat.
function stalemateTrap(c, P) {
  const caps = c.an.legal.filter(r => r.to === P.sq && r.cap && typeOf(r.p) === 'q');
  if (!caps.length) return null;
  return caps.every(r => c.an.child(r).status === 'stalemate') ? caps : null;
}
// Coups adverses (au trait dans an) qui font pat.
const stalematers = n => n.legal.filter(r => n.child(r).status === 'stalemate');

rule({ id: 'stalemate-defence', run(c) {
  if (X.t(c) !== 'k' || c.an.status) return null;
  const P = ourPawn(c);
  if (!P || !units(c.bn.g, c.def).some(u => u.t === 'q')) return null;
  const caps = stalemateTrap(c, P);
  if (!caps) return null;
  const corner = [0, 7, 56, 63].includes(c.m.to);
  const left = cheb(c.m.from, P.sq) === 1 && cheb(c.m.to, P.sq) > 1;
  const say = left ? 'Ton roi abandonne son pion : si la dame le prend, c’est pat.'
    : corner ? 'Ton roi se réfugie dans le coin : si la dame prend ton pion, c’est pat.'
    : 'Si la dame prend ton pion, c’est pat : ton roi n’aura plus aucun coup.';
  return { tags: ['stalemate-defence'], idea: 'Le pat peut te sauver.', say: [say],
    viz: { marks: marks([P.sq], 'mark-key'), arrows: [{ from: name(caps[0].from), to: name(caps[0].to), cls: 'threat' }] },
    viz1: { marks: marks([P.sq], 'mark-key') } };
} });

// Pion de la tour : le roi se cache dans le coin, devant son pion.
rule({ id: 'corner-hide', aliases: ['rook-pawn-corner'], run(c) {
  if (X.t(c) !== 'k' || c.an.status) return null;
  const P = ourPawn(c);
  if (!P || !P.rook || c.m.to !== P.promo || P.rel !== 6) return null;
  const n = stalematers(c.an).length;
  const say = ['Pion de la tour : ton roi se cache dans le coin, devant son pion.'];
  if (n) say.push(n === 1 ? 'Un coup adverse ferait déjà pat.' : `${n} coups adverses feraient déjà pat.`);
  return { tags: ['corner-hide'], data: { n }, idea: 'Pion de la tour : le coin peut te sauver.', say,
    viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Le roi reste près de son pion et le protège : la dame ne peut pas le prendre sans être reprise.
rule({ id: 'protect-pawn', aliases: ['stay-near-pawn'], run(c) {
  if (X.t(c) !== 'k' || c.an.status) return null;
  const P = ourPawn(c);
  if (!P || cheb(c.m.to, P.sq) !== 1) return null;
  const Kd = c.an.king(c.def);
  if (cheb(Kd, P.sq) <= 1) return null;
  // seule la dame (ou la tour) adverse pourrait prendre ; notre roi reprendrait (la case n'est défendue par rien d'autre)
  const others = units(c.an.g, c.def).filter(u => u.t !== 'k');
  if (others.length !== 1) return null;
  const was = cheb(c.m.from, P.sq) === 1, Q = { q: 'la dame', r: 'la tour' }[others[0].t];
  if (!Q) return null;
  return { tags: ['protect-pawn'], idea: 'Reste près de ton pion.',
    say: [was ? `Ton roi reste près de son pion et le protège : ${Q} ne peut pas le prendre sans être reprise.`
      : `Ton roi revient protéger son pion : ${Q} ne peut pas le prendre sans être reprise.`],
    viz: { marks: marks([P.sq], 'mark-ok') }, viz1: { marks: marks([P.sq], 'mark-key') } };
} });

// Le pion menace d'aller à dame : si l'adversaire passait, la promotion serait sûre (pièce promue imprenable).
rule({ id: 'promote-threat', run(c) {
  if (c.an.status || c.an.check) return null;
  const P = ourPawn(c);
  if (!P || P.rel !== 6) return null;
  const nl = c.an.nul;
  if (!nl) return null;
  const pr = nl.legal.find(m => typeOf(m.p) === 'p' && m.promo === 'q' && m.to === P.promo);
  if (!pr) return null;
  const n2 = nl.child(pr);
  if (n2.status || captures(n2).some(y => y.to === P.promo)) return null;
  if (X.t(c) === 'k' && c.m.from === P.promo) return { tags: ['promote-threat'], idea: 'Libère la case de promotion.',
    say: ['Ton roi libère la case de promotion : ton pion menace d’aller à dame.'], viz: { marks: marks([P.promo], 'mark-key') }, viz1: {} };
  return { tags: ['promote-threat'], idea: 'Ton pion peut-il aller à dame ?', say: ['Ton pion menace d’aller à dame.'],
    viz: { marks: marks([P.promo], 'mark-key') }, viz1: {} };
} });

family({
  id: 'kqkp-def',
  rules: ['stalemate-save', 'promote', 'stalemate-defence', 'corner-hide', 'promote-threat', 'protect-pawn', 'parry-threat', 'hanging-take', 'check', 'capture'],
  warnings: [],
  mistakes: ['stalemate', 'piece-lost', 'allows-mate'],
  fallback: {
    idea: 'Reste près de ton pion, et pense au pat.',
    say: 'L’essentiel : ton roi reste près de son pion ; pion fou ou tour, le coin et le pat te sauvent.',
  },
});

