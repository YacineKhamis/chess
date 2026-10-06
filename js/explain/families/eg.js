// Outils et faits communs aux finales avec pion (kpk, kpk-def, kqkp, kqkp-def, krkp, lucena, philidor).
// Spec §5.2 F17–F22 : cases clés, carré du pion, opposition, coup d'épaule, roi devant le pion, coin du pion de la tour.
//
// Conventions (comme rules.js) : c.us = camp qui joue le coup expliqué, c.def = l'autre camp. Dans les exercices de
// défense (kpk-def, kqkp-def, philidor), c.def est donc l'attaquant. Les rangées sont « relatives » au camp du pion
// (0 = sa 1re rangée, 7 = sa rangée de promotion) ; le texte donne les coordonnées de l'échiquier.
// Toute affirmation « gagné », « nulle », « promotion assurée », « au plus N coups » vient des tables exactes (c.tb) ;
// sans tables (finales à 4 ou 5 pièces), seuls des faits géométriques vérifiés sur l'échiquier sont énoncés.
import { rule, reason, X, marks } from '../rules.js';
import { F, R, name, typeOf, colorOf, other, cheb, KING_N, attackSet, opposition } from '../features.js';
import { cap, king, side, au, mv } from '../fr.js';

// ---------- Pion et rangées relatives ----------
export const relR = (s, color) => (color === 'w' ? R(s) : 7 - R(s));
export const absSq = (f, rel, color) => (color === 'w' ? rel : 7 - rel) * 8 + f;
export const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
// Seules des pièces de ces types sur l'échiquier ?
export const only = (g, types) => g.every(p => !p || types.includes(typeOf(p)));
// L'unique pion de l'échiquier : { sq, color, f, rel, promo, n } ; n = coups jusqu'à la promotion (double pas compté).
export function soloPawn(g) {
  let sq = -1;
  for (let i = 0; i < 64; i++) if (typeOf(g[i]) === 'p') { if (sq >= 0) return null; sq = i; }
  if (sq < 0) return null;
  const color = colorOf(g[sq]), f = F(sq), rel = relR(sq, color);
  return { sq, color, f, rel, promo: absSq(f, 7, color), n: 7 - rel - (rel === 1 ? 1 : 0), rook: f === 0 || f === 7 };
}
export const pawnB = c => c.get('pawnB', () => soloPawn(c.bn.g));
export const pawnA = c => c.get('pawnA', () => soloPawn(c.an.g));
// La case s est-elle devant le pion (sur sa colonne, plus près de la promotion) ?
export const onPath = (s, P) => F(s) === P.f && relR(s, P.color) > P.rel;
// Roi « devant son pion » (attaque) : colonne du pion ou voisine, plus avancé que lui.
export const aheadNear = (s, P) => Math.abs(F(s) - P.f) <= 1 && relR(s, P.color) > P.rel;

// ---------- F17 cases clés ----------
// Pion de b à g sur sa 2e–4e rangée : les trois cases deux rangées devant ; 5e–6e : les six cases une et deux rangées
// devant. Pion de la tour : les deux cases de la colonne voisine sur la 7e et la 8e rangée (b7, b8 pour un pion a).
export function keySquares(P) {
  const out = [];
  if (P.rook) {
    const g = P.f === 0 ? 1 : 6;
    out.push(absSq(g, 6, P.color), absSq(g, 7, P.color));
    return out;
  }
  if (P.rel < 1 || P.rel > 5) return out;
  const rows = P.rel <= 3 ? [P.rel + 2] : [P.rel + 1, P.rel + 2];
  for (const rr of rows) for (const df of [-1, 0, 1]) if (onBoard(P.f + df, rr)) out.push(absSq(P.f + df, rr, P.color));
  return out;
}

// ---------- F18 carré du pion ----------
// Le pion au trait : le roi l'arrête s'il est dans le carré (Chebyshev jusqu'à la case de promotion ≤ n).
// Le roi au trait : il lui suffit de pouvoir y entrer (≤ n + 1). Hors de ces bornes, il ne peut pas le rattraper.
export const inSquare = (K, P, kingToMove = false) => cheb(K, P.promo) <= P.n + (kingToMove ? 1 : 0);
export function squareZone(P) {
  const out = [];
  for (let rr = 7 - P.n; rr <= 7; rr++) for (let f = P.f - P.n; f <= P.f + P.n; f++) if (onBoard(f, rr)) out.push(absSq(f, rr, P.color));
  return out.map(name);
}

// ---------- Tables exactes ----------
export function probe(c, fen) {
  try { return c.tb && c.tb.probe ? c.tb.probe(fen) : null; } catch { return null; }
}
export const tbA = c => c.get('tbA', () => probe(c, c.an.fen));
// Après le coup : gagné pour le camp col ? (null = pas dans les tables)
export const wonFor = (p, col) => (p ? p.win && p.strong === col : null);
// La position (le camp `col` vient de jouer) est-elle conforme à son rôle : gain s'il attaque, nulle s'il défend ?
export function tbOk(c, attacker) {
  const p = tbA(c);
  if (!p) return null;
  return attacker ? wonFor(p, c.us) : !p.win;
}

// ---------- F20 chemin du roi (BFS) ----------
// Nombre de pas du roi `col` (en K) pour atteindre une des cases `targets`, en évitant les cases occupées et celles
// attaquées par l'autre camp (grille g figée). Infinity si impossible.
export function kingSteps(g, K, col, targets) {
  if (!targets.length) return Infinity;
  const T = new Set(targets), A = attackSet(g, other(col), { ghost: K });
  if (T.has(K)) return 0;
  const seen = new Set([K]);
  let front = [K], d = 0;
  while (front.length) {
    d++;
    const next = [];
    for (const s of front) for (const t of KING_N[s]) {
      if (seen.has(t) || A[t] || (g[t] && t !== K)) continue;
      if (T.has(t)) return d;
      seen.add(t); next.push(t);
    }
    front = next;
  }
  return Infinity;
}
// Cases devant le pion (sa route), libres et non attaquées par le camp du pion : là où l'autre roi peut le bloquer.
export function blockSquares(g, P) {
  const out = [], A = attackSet(g, P.color);
  for (let rr = P.rel + 1; rr <= 7; rr++) { const s = absSq(P.f, rr, P.color); if (!g[s] && !A[s]) out.push(s); }
  return out;
}

// ---------- Opposition (F9) : le camp qui n'a PAS le trait la détient ----------
export const oppKind = (a, b) => opposition(a, b);
export function oppText(kind, a, b, them) {
  if (kind === 'direct') return `Tu prends l’opposition : rois face à face, une case entre eux, et c’est ${au(them)} de jouer.`;
  if (kind === 'distant') return `Tu prends l’opposition à distance : ${cheb(a, b) - 1} cases entre les rois, et c’est ${au(them)} de jouer.`;
  return `Tu prends l’opposition en diagonale : c’est ${au(them)} de jouer.`;
}
// Coups de roi légaux du camp au trait dans le nœud n.
export const kingMoves = n => n.legal.filter(m => typeOf(m.p) === 'k');

// Finale de pions pure (rois et pions).
const pawnEnding = c => only(c.bn.g, 'kp');

rule({ id: 'opposition', run(c) {
  if (X.t(c) !== 'k' || c.an.status || c.an.check || !pawnEnding(c)) return null;
  const P = pawnB(c);
  if (!P) return null;
  const Ku = c.m.to, Kd = c.an.king(c.def), kind = oppKind(Ku, Kd);
  if (!kind) return null;
  const attacker = P.color === c.us;
  if (!tbOk(c, attacker)) return null;
  const say = [oppText(kind, Ku, Kd, c.def)];
  if (attacker) {
    // « Il doit céder le passage » : après chacune de ses réponses, ton roi peut avancer en gardant le gain.
    const gives = c.an.legal.every(r => {
      const n2 = c.an.child(r);
      return kingMoves(n2).some(m2 => relR(m2.to, P.color) > relR(Ku, P.color) && wonFor(probe(c, n2.child(m2).fen), c.us));
    });
    if (gives && c.an.legal.length) say.push(`Il doit céder le passage à ton roi.`);
  } else {
    const Ka = Kd, adv = kingMoves(c.an).some(m2 => relR(m2.to, P.color) > relR(Ka, P.color));
    if (!adv) say.push(`${cap(king(c.def))} ne peut pas avancer.`);
  }
  return { tags: ['opposition', 'opposition-' + kind], data: { kind }, idea: 'Prends l’opposition.', say,
    viz: { marks: marks([Ku, Kd], 'mark-ok') }, viz1: {} };
} });

// ---------- Le défenseur devant le pion (kpk-def, philidor) ----------
rule({ id: 'def-front', run(c) {
  if (X.t(c) !== 'k' || c.an.status) return null;
  const P = pawnB(c);
  if (!P || P.color === c.us || !onPath(c.m.to, P)) return null;
  if (tbOk(c, false) === false) return null;
  const before = onPath(c.m.from, P);
  if (before && relR(c.m.to, P.color) >= relR(c.m.from, P.color)) return null;   // recul sur la colonne : def-straight
  if (!before) return { tags: ['def-front'], idea: 'Reste devant le pion.', say: ['Ton roi se place devant le pion : il bloque sa route vers la promotion.'],
    viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: { marks: marks([P.sq], 'mark-key') } };
  return { tags: ['def-front'], idea: 'Reste devant le pion.', say: ['Ton roi reste devant le pion : il bloque toujours sa route vers la promotion.'],
    viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: { marks: marks([P.sq], 'mark-key') } };
} });

// Recul tout droit, sur la colonne du pion (kpk-def, philidor). En finale de pions, la nulle est lue dans les tables
// et « tu pourras reprendre l'opposition » est vérifié réponse par réponse.
rule({ id: 'def-straight', run(c) {
  if (X.t(c) !== 'k' || c.an.status) return null;
  const P = pawnB(c);
  if (!P || P.color === c.us || !onPath(c.m.from, P) || F(c.m.to) !== P.f || relR(c.m.to, P.color) <= relR(c.m.from, P.color)) return null;
  const pure = only(c.bn.g, 'kp');
  if (pure && !tbOk(c, false)) return null;
  const say = ['Ton roi recule tout droit, sur la colonne du pion : il reste devant lui.'];
  const Ka = c.an.king(c.def);
  const adv = kingMoves(c.an).filter(r => relR(r.to, P.color) > relR(Ka, P.color));
  if (pure && adv.length && adv.every(r => {
    const n2 = c.an.child(r);
    return kingMoves(n2).some(m2 => oppKind(m2.to, r.to) === 'direct' && probe(c, n2.child(m2).fen)?.win === false);
  })) say.push(`Tu pourras reprendre l’opposition quand ${king(c.def)} avancera.`);
  return { tags: ['def-straight'], idea: 'Repoussé, recule tout droit.', say, viz: { marks: marks([c.m.to], 'mark-ok') }, viz1: {} };
} });

// Pat : le défenseur annule (tous les exercices de défense).
rule({ id: 'stalemate-save', fixed: true, run(c) {
  if (c.an.status !== 'stalemate') return null;
  return { tags: ['stalemate-save'], idea: 'Cherche le pat.', say: [`Pat : ${king(c.def)} n’est pas en échec, mais ${side(c.def)} n’ont plus aucun coup ; c’est nulle.`],
    viz: { marks: marks([c.an.king(c.def)], 'mark-ok') } };
} });

// ---------- F21 pion de la tour : le coin ----------
// Zone du coin : la case de promotion et ses voisines sur les deux dernières rangées (nulle vérifiée sur toute la table).
export function cornerZone(P) {
  const g = P.f === 0 ? 1 : 6;
  return [absSq(P.f, 7, P.color), absSq(g, 7, P.color), absSq(P.f, 6, P.color), absSq(g, 6, P.color)];
}

// =====================================================================================================
// Raisons d'erreur des finales de pions (explainMistake). u, b : contextes du coup joué et du meilleur coup.
// Elles ne parlent que si la gravité est terminale (le gain ou la nulle est perdu) : la phrase dit « c'est nulle ».
// =====================================================================================================
const isPawnEnding = x => only(x.bn.g, 'kp') && !!soloPawn(x.bn.g);
// Réponse de l'adversaire (au trait dans n) qui prend l'opposition et décide (tables) : [{ r, san, kind }]
function oppReplies(x, n, wantWinForThem) {
  const out = [];
  const Ku = n.king(x.us);
  for (const r of kingMoves(n)) {
    const kind = oppKind(r.to, Ku);
    if (!kind) continue;
    const n2 = n.child(r), p = probe(x, n2.fen);
    if (!p) continue;
    if (wantWinForThem ? wonFor(p, x.def) : !p.win) out.push({ r, san: n.san(r), kind, n2 });
  }
  return out;
}

reason({ id: 'opposition-given', run(u, b, sev) {
  if (!isPawnEnding(u) || u.an.status) return null;
  const P = soloPawn(u.bn.g), attacker = P.color === u.us;
  if (attacker ? sev.id !== 'win-draw' : sev.id !== 'draw-loss') return null;
  const rs = oppReplies(u, u.an, !attacker);
  if (!rs.length) return null;
  const x = rs.find(y => y.kind === 'direct') || rs[0];
  const tail = attacker ? 'et c’est nulle' : `et ${side(u.def)} gagnent`;
  return { say: `Tu laisses l’opposition ${au(u.def)} : après ${mv(x.san)}, c’est à toi de céder le passage, ${tail}.`,
    tags: ['opposition-given'], viz: { arrows: [{ from: name(x.r.from), to: name(x.r.to), cls: 'threat' }] } };
} });

reason({ id: 'push-too-early', run(u, b, sev) {
  if (!isPawnEnding(u) || sev.id !== 'win-draw' || typeOf(u.m.p) !== 'p' || u.m.promo || u.an.status) return null;
  if (b && typeOf(b.m.p) === 'p') return null;
  const P0 = soloPawn(u.bn.g), P1 = soloPawn(u.an.g);
  if (!P0 || P0.color !== u.us || !P1) return null;
  // Le roi adverse se place devant le pion, et c'est nulle.
  for (const r of kingMoves(u.an)) {
    if (!onPath(r.to, P1)) continue;
    const p = probe(u, u.an.child(r).fen);
    if (p && !p.win) return { say: `Pion poussé trop tôt : ${king(u.def)} se place devant lui (${mv(u.an.san(r))}), et c’est nulle.`,
      tags: ['push-too-early'], viz: { arrows: [{ from: name(r.from), to: name(r.to), cls: 'threat' }] } };
  }
  const Ku = u.bn.king(u.us);
  if (!keySquares(P0).includes(Ku)) return { say: 'Pion poussé trop tôt : ton roi n’était pas encore sur une case clé, et c’est nulle.',
    tags: ['push-too-early'], viz: { zone: keySquares(P0).map(name), zoneCls: 'zone-key' } };
  return null;
} });

reason({ id: 'entered-square', run(u, b, sev) {
  if (!isPawnEnding(u) || u.an.status) return null;
  const P = soloPawn(u.bn.g), attacker = P.color === u.us;
  if (attacker) {
    // L'attaquant a laissé le roi adverse entrer dans le carré (au lieu de pousser).
    if (sev.id !== 'win-draw' || typeOf(u.m.p) === 'p') return null;
    const Kd = u.an.king(u.def);
    if (inSquare(Kd, P, true)) return null;
    for (const r of kingMoves(u.an)) {
      if (!inSquare(r.to, P)) continue;
      const p = probe(u, u.an.child(r).fen);
      if (p && !p.win) return { say: `${cap(king(u.def))} peut maintenant entrer dans le carré du pion (${mv(u.an.san(r))}) : il arrivera à temps, c’est nulle.`,
        tags: ['entered-square'], viz: { zone: squareZone(P), zoneCls: 'zone-key', arrows: [{ from: name(r.from), to: name(r.to), cls: 'threat' }] } };
    }
    return null;
  }
  if (sev.id !== 'draw-loss' || typeOf(u.m.p) !== 'k') return null;
  // (a) Le roi sort du carré : il pouvait encore y entrer (il avait le trait), il n'y est plus (le pion a le trait).
  if (inSquare(u.m.from, P, true) && !inSquare(u.m.to, P) && (!b || typeOf(b.m.p) !== 'k' || inSquare(b.m.to, P)))
    return { say: 'Ton roi sort du carré du pion : il ne pourra plus le rattraper.', tags: ['entered-square', 'left-square'],
      viz: { zone: squareZone(P), zoneCls: 'zone-key', marks: marks([u.m.to], 'mark-ko') } };
  // (b) Il laisse passer le roi adverse sur une case clé.
  const keys = keySquares(P), Ka = u.an.king(u.def);
  if (keys.includes(Ka)) return null;
  for (const r of kingMoves(u.an)) {
    if (!keys.includes(r.to)) continue;
    const p = probe(u, u.an.child(r).fen);
    if (wonFor(p, u.def)) return { say: `Tu laisses passer ${king(u.def)} : après ${mv(u.an.san(r))}, il tient une case clé, et ${side(u.def)} gagnent.`,
      tags: ['entered-square', 'let-through'], viz: { zone: keys.map(name), zoneCls: 'zone-key', arrows: [{ from: name(r.from), to: name(r.to), cls: 'threat' }] } };
  }
  return null;
} });

