// Familles « lucena » (gagner : tour et pion contre tour) et « philidor » (tenir : tour contre tour et pion).
// Spec §5.2 F22 : étapes de Lucena (coupure, pont, sortie du roi, interposition) et de Philidor (3e rangée, échecs par
// derrière). Pas de table à 5 pièces : chaque phrase est géométrique, vérifiée sur l'échiquier (coups légaux).
// Rangées : le texte donne la rangée de l'échiquier, avec la rangée « à toi » entre parenthèses si elle diffère.
import { family, rule, X, marks } from '../rules.js';
import { F, R, name, typeOf, cheb, between, attacked, attackersOf, units } from '../features.js';
import { cap, king, theirs, au, ord, side } from '../fr.js';
import { relR, pawnB, kingMoves } from './eg.js';

const ourPawn = c => { const P = pawnB(c); return P && P.color === c.us ? P : null; };
const theirPawn = c => { const P = pawnB(c); return P && P.color === c.def ? P : null; };
const rookEnding = g => { const w = units(g, 'w').map(u => u.t).sort().join(''), b = units(g, 'b').map(u => u.t).sort().join('');
  return [w, b].sort().join('|') === 'kpr|kr'; };
// « la 4e rangée (ta 5e) » : rangée de l'échiquier, et rangée relative au camp `col` si elle diffère.
const rankName = (s, col) => { const a = R(s) + 1, r = relR(s, col) + 1; return `la ${ord(a)} rangée${a !== r ? ` (ta ${ord(r)})` : ''}`; };
// Coups de l'adversaire (au trait dans n) qui donnent échec.
const checksOf = n => n.legal.filter(r => n.child(r).check);

// ---------- Lucena ----------
const lucena = c => (rookEnding(c.bn.g) && !c.an.status ? ourPawn(c) : null);

// Interposition : la tour se place sur la ligne de l'échec.
rule({ id: 'lucena-block', run(c) {
  const P = lucena(c);
  if (!P || !c.bn.check || X.t(c) !== 'r') return null;
  const Ku = c.bn.king(c.us), checkers = attackersOf(c.bn.g, Ku, c.def);
  if (checkers.length !== 1 || !between(checkers[0], Ku).includes(c.m.to)) return null;
  const safe = !checksOf(c.an).length, guarded = attacked(c.an.g, c.m.to, c.us);
  const say = safe ? `Ta tour s’interpose${guarded ? ', protégée par ton roi' : ''} : la tour adverse n’a plus aucun échec.`
    : `Ta tour s’interpose sur la ligne de l’échec${guarded ? ', protégée par ton roi' : ''}.`;
  return { tags: ['lucena-block'], idea: 'Interpose ta tour.', say: [say], viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Le pont : la tour sur ta 4e rangée pendant que ton roi est encore devant son pion (pion en 7e).
rule({ id: 'lucena-bridge', run(c) {
  const P = lucena(c);
  if (!P || X.t(c) !== 'r' || P.rel !== 6 || relR(c.m.to, c.us) !== 3 || relR(c.m.from, c.us) === 3) return null;
  const Ku = c.an.king(c.us);
  if (Ku !== P.promo) return null;
  return { tags: ['lucena-bridge'], idea: 'Prépare un abri contre les échecs.',
    say: [`Tu construis le pont : ta tour se place sur ${rankName(c.m.to, c.us)} pour pouvoir s’interposer plus tard contre les échecs.`],
    viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Le roi sort de devant son pion (case de promotion libérée).
rule({ id: 'lucena-out', run(c) {
  const P = lucena(c);
  if (!P || X.t(c) !== 'k' || P.rel !== 6 || c.m.from !== P.promo || F(c.m.to) === P.f) return null;
  const Kd = c.an.king(c.def), away = F(Kd) !== P.f && Math.sign(F(c.m.to) - P.f) !== Math.sign(F(Kd) - P.f);
  const say = [`Ton roi sort de devant son pion${away ? `, du côté opposé ${au(c.def)}` : ''} : la case de promotion est libre.`];
  const nl = c.an.nul;
  const pr = nl && !c.an.check ? nl.legal.find(m => typeOf(m.p) === 'p' && m.promo === 'q' && m.to === P.promo) : null;
  if (pr && !nl.child(pr).legal.some(y => y.to === P.promo && y.cap)) say.push('Le pion menace d’aller à dame.');
  return { tags: ['lucena-out'], idea: 'Ton roi doit sortir de devant son pion.', say, viz: { marks: marks([P.promo], 'mark-key') }, viz1: {} };
} });

// Coupure : la tour, sur une colonne entre le roi adverse et le pion, l'empêche de s'en approcher.
rule({ id: 'lucena-cut', aliases: ['cut'], run(c) {
  const P = lucena(c);
  if (!P || X.t(c) !== 'r') return null;
  const Kd = c.an.king(c.def), x = F(c.m.to);
  const between_ = (a, b, m) => (a < m && m < b) || (b < m && m < a);
  if (!between_(F(Kd), P.f, x)) return null;
  if (F(c.m.from) === x) return null;   // déjà sur cette colonne
  if (kingMoves(c.an).some(r => F(r.to) === x || r.cap)) return null;
  if (c.an.legal.some(r => r.to === c.m.to)) return null;   // la tour ne doit pas être prenable
  const col = `la colonne ${'abcdefgh'[x]}`;
  const say = c.an.check ? `Ta tour donne échec et coupe ${king(c.def)} de ton pion : il ne peut pas franchir ${col}.`
    : `Ta tour coupe ${king(c.def)} de ton pion : il ne peut pas franchir ${col}.`;
  return { tags: ['lucena-cut', 'cut'], idea: 'Coupe le roi adverse de ton pion.', say: [say], viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Le roi se met à l'abri des échecs (ou la tour l'abrite) : l'adversaire n'a plus aucun échec, ni aucune prise.
rule({ id: 'king-shelter', run(c) {
  const P = lucena(c);
  if (!P || !'kr'.includes(X.t(c)) || c.an.check) return null;
  if (!c.bn.check && !(c.bn.nul && checksOf(c.bn.nul).length)) return null;   // il y avait des échecs à craindre
  if (checksOf(c.an).length || c.an.legal.some(r => r.cap)) return null;
  const say = X.t(c) === 'k' ? `Ton roi se met à l’abri : ${side(c.def)} n’ont plus aucun échec.`
    : `Ta tour abrite ton roi : ${side(c.def)} n’ont plus aucun échec.`;
  return { tags: ['king-shelter'], idea: 'Mets ton roi à l’abri des échecs.', say: [say], viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Le pion était attaqué et sans défense : ton roi (ou ta tour) vient le protéger.
rule({ id: 'guard-pawn', run(c) {
  const P = lucena(c);
  if (!P || c.m.cap || !attacked(c.bn.g, P.sq, c.def) || attacked(c.bn.g, P.sq, c.us)) return null;
  if (!attacked(c.an.g, P.sq, c.us) || c.an.legal.some(r => r.cap && typeOf(r.cap) !== 'p')) return null;
  const t = X.t(c), by = typeOf(c.bn.g[attackersOf(c.bn.g, P.sq, c.def)[0]]);
  if (t !== 'k' && t !== 'r') return null;
  return { tags: ['guard-pawn'], idea: 'Ton pion est attaqué.',
    say: [`${cap(by === 'k' ? king(c.def) : theirs(by, c.def))} attaquait ton pion : ${t === 'k' ? 'ton roi' : 'ta tour'} vient le protéger.`],
    viz: { marks: marks([P.sq], 'mark-ok') }, viz1: { marks: marks([P.sq], 'mark-ko') } };
} });

// La tour se place derrière son propre pion (même colonne, ligne libre) : elle le protège.
rule({ id: 'rook-supports', run(c) {
  const P = lucena(c);
  if (!P || X.t(c) !== 'r' || F(c.m.to) !== P.f || relR(c.m.to, P.color) >= P.rel || F(c.m.from) === P.f) return null;
  if (between(c.m.to, P.sq).some(s => c.an.g[s]) || c.an.legal.some(r => r.to === c.m.to)) return null;
  return { tags: ['rook-supports'], idea: 'Ta tour peut soutenir ton pion.', say: ['Ta tour se place derrière ton pion et le protège.'],
    viz: { marks: marks([P.sq], 'mark-ok') }, viz1: {} };
} });

family({
  id: 'lucena',
  rules: ['mate', 'rescue', 'mate-every-reply', 'promote', 'lucena-block', 'lucena-cut', 'lucena-bridge', 'lucena-out', 'king-shelter',
    'guard-pawn', 'rook-supports', 'promote-threat', 'fork', 'skewer', 'hanging-take', 'parry-threat', 'lookahead', 'check', 'capture'],
  warnings: ['underpromo'],
  mistakes: ['stalemate', 'piece-lost', 'missed-mate', 'allows-mate', 'bad-capture', 'missed-motif'],
  fallback: {
    idea: 'Le pont : tour sur ta 4e rangée, le roi sort, la tour s’interpose.',
    say: 'L’essentiel : construis le pont, sors ton roi, et interpose ta tour contre les échecs.',
  },
});

// ---------- Philidor ----------
const philidor = c => (rookEnding(c.bn.g) && !c.an.status ? theirPawn(c) : null);

// Tour sur la 3e rangée (pour toi) tant que le pion n'y est pas : le roi adverse ne peut pas y avancer.
rule({ id: 'philidor-third', run(c) {
  const P = philidor(c);
  if (!P || X.t(c) !== 'r' || P.rel > 4 || relR(c.m.to, P.color) !== 5) return null;
  const Ka = c.an.king(c.def);
  if (relR(Ka, P.color) > 4) return null;
  if (kingMoves(c.an).some(r => relR(r.to, P.color) === 5)) return null;
  if (c.an.legal.some(r => r.to === c.m.to)) return null;
  const stay = relR(c.m.from, P.color) === 5, L = rankName(c.m.to, c.us), K = king(c.def);
  const near = relR(Ka, P.color) === 4;
  const say = !near ? `Défense Philidor : ta tour garde ${L}, devant le pion et ${K}.`
    : stay ? `Ta tour reste sur ${L} : ${K} ne peut toujours pas y avancer.`
    : `Défense Philidor : ta tour garde ${L}, ${K} ne peut pas y avancer.`;
  return { tags: ['philidor-third'], idea: `Garde ${rankName(c.m.to, c.us).replace(/ \(.*\)$/, '')} avec ta tour.`, say: [say],
    viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Le pion a atteint la 6e : la tour file tout en bas, pour donner des échecs par derrière.
rule({ id: 'philidor-behind', run(c) {
  const P = philidor(c);
  if (!P || X.t(c) !== 'r' || P.rel !== 5 || relR(c.m.to, P.color) > 1 || relR(c.m.from, P.color) <= 1) return null;
  if (c.an.legal.some(r => r.to === c.m.to)) return null;
  return { tags: ['philidor-behind'], idea: 'Le pion a avancé : change de plan.',
    say: [`Le pion est arrivé sur la ${ord(R(P.sq) + 1)} rangée : ta tour file tout en bas pour donner des échecs par derrière.`],
    viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Échec de loin : le roi adverse ne peut ni prendre la tour ni s'en approcher.
rule({ id: 'far-check', run(c) {
  const P = philidor(c);
  if (!P || X.t(c) !== 'r' || !c.an.check) return null;
  const Ka = c.an.king(c.def);
  if (cheb(c.m.to, Ka) < 3) return null;
  if (c.an.legal.some(r => r.to === c.m.to || (typeOf(r.p) === 'k' && cheb(r.to, c.m.to) <= 1))) return null;
  const behind = F(c.m.to) === F(Ka) && relR(c.m.to, P.color) < relR(Ka, P.color);
  return { tags: ['far-check'], idea: 'Donne des échecs de loin.',
    say: [`${behind ? 'Échec par derrière, de loin' : 'Échec de loin'} : ${king(c.def)} ne peut pas s’approcher de ta tour.`],
    viz: { marks: marks([Ka], 'mark-ko') }, viz1: {} };
} });

// Échec de près, la tour protégée par le roi : le roi adverse doit s'écarter.
rule({ id: 'guarded-check', run(c) {
  const P = philidor(c);
  if (!P || X.t(c) !== 'r' || !c.an.check) return null;
  const Ka = c.an.king(c.def);
  if (cheb(c.m.to, Ka) !== 1 || !attacked(c.an.g, c.m.to, c.us)) return null;
  if (!c.an.legal.every(r => typeOf(r.p) === 'k' && r.to !== c.m.to)) return null;
  return { tags: ['guarded-check'], idea: 'Ta tour peut chasser le roi adverse.',
    say: [`Ta tour, protégée par ton roi, donne échec : ${king(c.def)} doit s’écarter.`], viz: { marks: marks([Ka], 'mark-ko') }, viz1: {} };
} });

// Le roi garde la case de promotion (il est dessus ou à côté).
rule({ id: 'promo-guard', run(c) {
  const P = philidor(c);
  if (!P || X.t(c) !== 'k' || cheb(c.m.to, P.promo) > 1 || c.an.legal.some(r => r.cap)) return null;
  const was = cheb(c.m.from, P.promo) <= 1, sq = name(P.promo);
  return { tags: ['promo-guard'], idea: 'Garde la case de promotion.',
    say: [c.m.to === P.promo ? `Ton roi se place sur la case de promotion ${sq} : le pion ne peut pas y aller.`
      : was ? `Ton roi reste près de la case de promotion ${sq}, qu’il garde.` : `Ton roi revient garder la case de promotion ${sq}.`],
    viz: { marks: marks([P.promo], 'mark-key') }, viz1: { marks: marks([P.promo], 'mark-key') } };
} });

// Le roi attaque le pion.
rule({ id: 'king-attacks-pawn', run(c) {
  const P = philidor(c);
  if (!P || X.t(c) !== 'k' || cheb(c.m.to, P.sq) !== 1 || cheb(c.m.from, P.sq) === 1 || c.an.legal.some(r => r.to === c.m.to)) return null;
  const guarded = attacked(c.an.g, P.sq, c.def);
  return { tags: ['king-attacks-pawn'], idea: 'Attaque le pion.',
    say: [guarded ? 'Ton roi attaque le pion, protégé pour l’instant.' : 'Ton roi attaque le pion, qui n’est pas protégé.'],
    viz: { marks: marks([P.sq], 'mark-ko') }, viz1: {} };
} });

// La tour reste loin derrière le roi adverse, prête à donner échec.
rule({ id: 'rook-far', run(c) {
  const P = philidor(c);
  if (!P || X.t(c) !== 'r' || c.an.check) return null;
  const Ka = c.an.king(c.def);
  if (relR(c.m.to, P.color) > relR(Ka, P.color) - 3) return null;
  if (c.an.legal.some(r => r.to === c.m.to)) return null;
  const nl = c.an.nul;
  if (!nl || !nl.legal.some(m => m.from === c.m.to && nl.child(m).check)) return null;
  const stay = relR(c.m.from, P.color) <= relR(Ka, P.color) - 3;
  return { tags: ['rook-far'], idea: 'Garde ta tour loin du roi adverse.',
    say: [`Ta tour ${stay ? 'reste' : 'se place'} loin derrière ${king(c.def)}, prête à lui donner des échecs.`], viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Prise du pion : il ne reste qu'une tour de chaque côté.
rule({ id: 'take-pawn-r', run(c) {
  if (typeOf(c.m.cap) !== 'p' || !rookEnding(c.bn.g)) return null;
  const w = units(c.an.g, 'w').map(u => u.t).sort().join(''), b = units(c.an.g, 'b').map(u => u.t).sort().join('');
  if (w !== 'kr' || b !== 'kr') return null;
  return { tags: ['take-pawn'], idea: 'Le pion peut-il être pris ?', say: ['Tu prends le pion : il ne reste qu’une tour de chaque côté.'],
    viz: { marks: marks([c.m.to], 'mark-ok') } };
} });

family({
  id: 'philidor',
  rules: ['stalemate-save', 'take-pawn-r', 'philidor-third', 'philidor-behind', 'far-check', 'def-front', 'def-straight', 'promo-guard',
    'guarded-check', 'rook-far', 'king-attacks-pawn', 'parry-threat', 'hanging-take', 'check', 'capture'],
  warnings: [],
  mistakes: ['stalemate', 'piece-lost', 'allows-mate', 'bad-capture'],
  fallback: {
    idea: 'Tour sur ta 3e rangée ; si le pion y avance, tour tout en bas.',
    say: 'L’essentiel : ton roi devant le pion, ta tour sur ta 3e rangée, puis des échecs par derrière.',
  },
});

