// Catalogue de caractéristiques de l'explicateur (spec §5.2, recherche F1–F24), mémoïsées par FEN.
// Tout est calculé sur la grille native (board64.js) : coups légaux exacts, ensembles d'attaque, remplissages du roi.
// Convention : « us » = camp qui joue le coup expliqué, « def » = l'autre camp (le roi seul dans les mats).
import {
  F, R, name, colorOf, typeOf, other, cheb, manh, edge, VALUE, KING_N, RAY, SLIDE, DIRS, dirOf, between,
  parse, fenOf, keyOf, attackSet, pieceAttacks, attacked, attackersOf, kingOf, inCheck, units,
  legalMoves, hasLegal, play, nullPos, findMove, sanOf, gridAfter,
} from './board64.js';

// ---------- Nœuds mémoïsés (une position = un nœud) ----------
const MEMO = new Map(), MEMO_MAX = 4000;
class Node {
  constructor(pos, key) { this.pos = pos; this.key = key; this.m = {}; }
  get g() { return this.pos.g; }
  get turn() { return this.pos.turn; }
  get fen() { return this.m.fen ??= fenOf(this.pos); }
  get legal() { return this.m.legal ??= legalMoves(this.pos); }
  get check() { return this.m.check ??= inCheck(this.pos); }
  get status() { return this.m.status ??= (this.legal.length ? null : this.check ? 'mate' : 'stalemate'); }
  king(c) { return kingOf(this.g, c); }
  // Le camp `c` n'a-t-il que son roi ?
  lone(c) { return (this.m['lone' + c] ??= units(this.g, c).length === 1); }
  san(m) { return sanOf(this.pos, m, this.legal); }
  move(uci) { return findMove(this.pos, uci, this.legal); }
  child(m) { return nodeOf(play(this.pos, m)); }
  get nul() { return this.m.nul ??= (this.check ? null : nodeOf(nullPos(this.pos))); }
  cage(def) { return this.m['cage' + def] ??= cage(this.g, def); }
  box(def) { return this.m['box' + def] ??= box(this.g, def); }
  cuts(def) { return this.m['cuts' + def] ??= cuts(this.g, def, this.box(def)); }
}
export function node(fen) {
  const key = keyOf(fen);
  let n = MEMO.get(key);
  if (!n) {
    if (MEMO.size >= MEMO_MAX) MEMO.clear();
    n = new Node(parse(fen), key);
    MEMO.set(key, n);
  }
  return n;
}
export function nodeOf(pos) {
  const key = keyOf(fenOf(pos));
  let n = MEMO.get(key);
  if (!n) {
    if (MEMO.size >= MEMO_MAX) MEMO.clear();
    n = new Node(pos, key);
    MEMO.set(key, n);
  }
  return n;
}
export const clearMemo = () => MEMO.clear();

// ---------- F1 cage : où le roi peut réellement marcher (statique, exact) ----------
// Lignes calculées À TRAVERS la case du roi (fantôme) ; nos pièces défendues sont des murs ; nos pièces non défendues
// sont des murs aussi mais signalées : `hanging` si adjacentes au roi, `leaks` si atteignables plus loin.
export function cage(g, def) {
  const us = other(def), K = kingOf(g, def);
  if (K < 0) return { zone: new Set(), size: 0, hanging: [], leaks: [] };
  const A = attackSet(g, us, { ghost: K });
  const zone = new Set([K]), stack = [K], hanging = [], leaks = [];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of KING_N[cur]) {
      if (zone.has(n) || A[n]) continue;
      const p = g[n];
      if (p && colorOf(p) === def) continue;
      if (p) { const l = cur === K ? hanging : leaks; if (!l.includes(n)) l.push(n); continue; }
      zone.add(n); stack.push(n);
    }
  }
  return { zone, size: zone.size, hanging, leaks };
}

// ---------- F2 boîte : le confinement fait par nos pièces autres que le roi ----------
// Même remplissage, notre roi ignoré comme attaquant ET comme bloqueur ; toutes nos autres pièces sont des murs.
export function box(g, def) {
  const us = other(def), K = kingOf(g, def), Ku = kingOf(g, us);
  if (K < 0) return { zone: new Set(), size: 0 };
  const A = attackSet(g, us, { ghost: K, skip: Ku });
  const zone = new Set([K]), stack = [K];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of KING_N[cur]) {
      if (zone.has(n) || A[n]) continue;
      const p = g[n];
      if (p && n !== Ku) continue;
      zone.add(n); stack.push(n);
    }
  }
  return { zone, size: zone.size };
}

// ---------- F3 coupures : une ligne de tour (ou de dame) entre la boîte et le reste ----------
// kind 'file' | 'rank', idx = numéro de la ligne, side = côté du roi (−1/+1), width = colonnes ou rangées laissées.
export function cuts(g, def, bx = box(g, def)) {
  const us = other(def), K = kingOf(g, def), Ku = kingOf(g, us), out = [];
  const Z = [...bx.zone];
  if (!Z.length) return out;
  for (let i = 0; i < 64; i++) {
    const p = g[i];
    if (!p || colorOf(p) !== us || (typeOf(p) !== 'r' && typeOf(p) !== 'q')) continue;
    for (const kind of ['file', 'rank']) {
      const co = kind === 'file' ? F : R, ot = kind === 'file' ? R : F, li = co(i);
      if (Z.some(z => co(z) === li)) continue;
      const side = Math.sign(co(Z[0]) - li);
      if (!Z.every(z => Math.sign(co(z) - li) === side)) continue;
      const lo = Math.max(0, Math.min(...Z.map(ot)) - 1), hi = Math.min(7, Math.max(...Z.map(ot)) + 1);
      const PA = pieceAttacks(g, i, { ghost: K, skip: Ku });
      let ok = true;
      for (let o = lo; o <= hi && ok; o++) {
        const s = kind === 'file' ? o * 8 + li : li * 8 + o;
        if (s !== i && !PA[s]) ok = false;
      }
      if (!ok) continue;
      const width = new Set(Z.map(co)).size;
      out.push({ sq: i, t: typeOf(p), kind, idx: li, side, width, gap: Math.min(...Z.map(z => Math.abs(co(z) - li))) });
    }
  }
  return out.sort((a, b) => a.width - b.width || a.sq - b.sq);
}
// La coupure tient aussi « pour de vrai » : la cage (notre roi compris) reste du même côté, sans fuite.
export function realCut(g, def, c) {
  const cg = cage(g, def), co = c.kind === 'file' ? F : R;
  if (cg.hanging.length || cg.leaks.length) return false;
  for (const z of cg.zone) if (Math.sign(co(z) - c.idx) !== c.side) return false;
  return true;
}
export const sameLine = (a, b) => a && b && a.kind === b.kind && a.idx === b.idx;
// Cases de la ligne de coupure qui bordent la boîte (pour le marquage 'mark-line').
export function cutBorder(c, zone) {
  const co = c.kind === 'file' ? F : R, ot = c.kind === 'file' ? R : F, Z = [...zone];
  const lo = Math.max(0, Math.min(...Z.map(ot))), hi = Math.min(7, Math.max(...Z.map(ot)));
  const out = [];
  for (let o = lo; o <= hi; o++) out.push(c.kind === 'file' ? o * 8 + c.idx : c.idx * 8 + o);
  return out.filter(s => s !== c.sq);
}

// ---------- Prises possibles (coups légaux) ----------
// Prises du camp au trait sur des pièces adverses (hors roi).
export const captures = n => n.legal.filter(m => m.cap);
// Ce que l'adversaire pourrait prendre « s'il jouait » dans la position n (us au trait) : prises légales après passe.
export function threatenedBy(n) {
  const nl = n.nul;
  return nl ? captures(nl) : [];
}

// ---------- F5 échecs ----------
export function checkInfo(bn, an, m, def) {
  if (!an.check) return null;
  const K = an.king(def), us = other(def);
  const checkers = attackersOf(an.g, K, us);
  const kind = checkers.length >= 2 ? 'double' : checkers[0] !== m.to ? 'discovered' : 'direct';
  if (an.status === 'mate') return { kind, mate: true, checkers, replies: [] };
  const replies = an.legal;
  const sizes = replies.map(r => box(play(an.pos, r).g, def).size);
  const worstBox = Math.max(...sizes), bestBox = Math.min(...sizes), boxBefore = bn.box(def).size;
  const worstReply = replies[sizes.indexOf(worstBox)];
  const towardEdge = replies.every(r => typeOf(r.p) !== 'k' || edge(r.to) <= edge(K));
  return { kind, mate: false, checkers, replies, sizes, worstBox, bestBox, worstReply, boxBefore,
    driving: worstBox < boxBefore, useless: worstBox >= boxBefore, towardEdge };
}

// ---------- F6 sauvetage : une pièce attaquée maintenant, plus après le coup ----------
export function rescue(bn, an, m) {
  if (bn.check) return null;
  const threatened = threatenedBy(bn).filter(c => typeOf(c.cap) !== 'k');
  const still = captures(an).filter(c => typeOf(c.cap) !== 'k');
  if (!threatened.length || still.length) return null;
  const sqs = [...new Set(threatened.map(c => c.to))];
  const by = threatened.find(c => c.to === m.from);
  if (by) return { sq: m.from, piece: bn.g[m.from], how: 'flee', by };
  // Défense : la pièce menacée est maintenant défendue (par la pièce jouée de préférence).
  const sq = sqs.find(s => pieceAttacks(an.g, m.to)[s]) ?? sqs[0];
  return { sq, piece: bn.g[sq], how: pieceAttacks(an.g, m.to)[sq] ? 'defend' : 'other', by: threatened.find(c => c.to === sq) };
}

// ---------- F7 fuite préventive : la menace à un coup ----------
// Coups de l'adversaire (au trait dans n) après lesquels il pourrait prendre une de nos pièces.
export function threatsNext(n) {
  const out = [];
  for (const r of n.legal) {
    const p2 = play(n.pos, r);
    if (inCheck(p2)) continue;
    const back = legalMoves({ ...p2, turn: other(p2.turn), ep: -1 });
    const caps = back.filter(c => c.cap && typeOf(c.cap) !== 'k');
    if (caps.length) out.push({ r, caps });
  }
  return out;
}

// ---------- F8 / F9 rois ----------
export function approach(m, Kdef) {
  if (typeOf(m.p) !== 'k') return null;
  const d0 = cheb(m.from, Kdef), d1 = cheb(m.to, Kdef), e0 = manh(m.from, Kdef), e1 = manh(m.to, Kdef);
  if (d1 < d0 || (d1 === d0 && e1 < e0)) return { d0, d1, cheb: d1 < d0 };
  return null;
}
// 'direct' (face à face), 'distant', 'diagonal' ou null (comme analysis.opposition, en indices).
export function opposition(a, b) {
  const df = Math.abs(F(a) - F(b)), dr = Math.abs(R(a) - R(b));
  if ((df === 0 && dr === 2) || (dr === 0 && df === 2)) return 'direct';
  if ((df === 0 && dr % 2 === 0 && dr > 2) || (dr === 0 && df % 2 === 0 && df > 2)) return 'distant';
  if (df === dr && df % 2 === 0) return 'diagonal';
  return null;
}

// ---------- F11 pat ----------
export function stalemateDanger(an, def) {
  if (an.check || an.status) return null;
  if (!an.lone(def)) return null;
  const ms = an.legal;
  if (ms.length > 2) return null;
  return { n: ms.length, sqs: [...new Set(ms.map(r => r.to))] };
}

// ---------- Mats en un coup (coups légaux, filtrés par l'échec) ----------
export function matesIn1(pos) {
  const out = [], them = other(pos.turn);
  for (const m of legalMoves(pos)) {
    const h = gridAfter(pos.g, m), K = kingOf(h, them);
    if (K < 0 || !attacked(h, K, pos.turn)) continue;
    const p2 = play(pos, m);
    if (!hasLegal(p2)) out.push(m);
  }
  return out;
}
export function hasMateIn1(pos) {
  const them = other(pos.turn);
  for (const m of legalMoves(pos)) {
    const h = gridAfter(pos.g, m), K = kingOf(h, them);
    if (K < 0 || !attacked(h, K, pos.turn)) continue;
    if (!hasLegal(play(pos, m))) return m;
  }
  return null;
}

// ---------- F12 mat après chaque réponse ----------
export function mateEveryReply(an, maxReplies = 12) {
  if (an.status) return null;
  const replies = an.legal;
  if (!replies.length || replies.length > maxReplies) return null;
  const pairs = [];
  for (const r of replies) {
    const p2 = play(an.pos, r);
    const mt = hasMateIn1(p2);
    if (!mt) return null;
    pairs.push({ r, m: mt, pos: p2 });
  }
  return pairs;
}

// ---------- F13 coup d'attente ----------
// Peut-on progresser (mat, boîte plus petite, échec qui repousse) sans rien laisser prendre ni pater ?
export function canProgress(pos, def) {
  const base = box(pos.g, def).size;
  for (const m of legalMoves(pos)) {
    const p2 = play(pos, m), ms = legalMoves(p2);
    const chk = inCheck(p2);
    if (!ms.length) { if (chk) return m; continue; }
    if (ms.some(r => r.cap)) continue;
    if (chk) {
      let worst = 0;
      for (const r of ms) worst = Math.max(worst, box(play(p2, r).g, def).size);
      if (worst < base) return m;
    } else if (box(p2.g, def).size < base) return m;
  }
  return null;
}
// Réponses de l'adversaire (au trait dans n) après lesquelles on ne peut pas progresser.
export function goodReplies(n, def) {
  return n.legal.filter(r => !canProgress(play(n.pos, r), def));
}

// ---------- F23 échange (SEE avec coups légaux) ----------
const val = p => (typeOf(p) === 'k' ? 100 : VALUE[typeOf(p)]);
export function see(pos, sq, depth = 8) {
  if (!depth) return 0;
  const caps = legalMoves(pos, { to: sq }).filter(m => m.cap);
  if (!caps.length) return 0;
  const m = caps.reduce((a, b) => (val(a.p) <= val(b.p) ? a : b));
  const v = VALUE[typeOf(m.cap)] + (m.promo ? VALUE[m.promo] - 1 : 0) - see(play(pos, m), sq, depth - 1);
  return Math.max(0, v);
}
// Gain net d'une prise précise m (le camp au trait prend), l'adversaire reprenant au mieux.
export function seeMove(pos, m) {
  return VALUE[typeOf(m.cap)] + (m.promo ? VALUE[m.promo] - 1 : 0) - see(play(pos, m), m.to);
}
// Matériel du point de vue de `c`.
export function balance(g, c) {
  let s = 0;
  for (const p of g) if (p) s += (colorOf(p) === c ? 1 : -1) * VALUE[typeOf(p)];
  return s;
}

// ---------- F24 motifs tactiques (sur la position après le coup ; us = le camp qui vient de jouer) ----------
// Une cible « vaut la peine » : le roi (échec), plus chère que l'attaquant, ou sans défenseur.
export function forkTargets(an, at, us) {
  const g = an.g, def = other(us), A = pieceAttacks(g, at), mover = typeOf(g[at]), out = [];
  for (let s = 0; s < 64; s++) {
    if (!A[s] || !g[s] || colorOf(g[s]) !== def) continue;
    const t = typeOf(g[s]);
    if (t === 'p') continue;
    if (t === 'k' || VALUE[t] > VALUE[mover] || !attacked(g, s, def)) out.push({ sq: s, t });
  }
  return out;
}
// Clouages par nos pièces à longue portée : [{ by, sq (cloué), behind, abs }]
export function pins(g, us) {
  const def = other(us), out = [];
  for (let i = 0; i < 64; i++) {
    const p = g[i];
    if (!p || colorOf(p) !== us || !SLIDE[typeOf(p)]) continue;
    for (const d of SLIDE[typeOf(p)]) {
      let first = -1;
      for (const j of RAY[i][d]) {
        if (!g[j]) continue;
        if (colorOf(g[j]) !== def) break;
        if (first < 0) { first = j; continue; }
        const A = typeOf(g[first]), B = typeOf(g[j]);
        if (B === 'k') out.push({ by: i, sq: first, behind: j, abs: true, d });
        else if (A !== 'k' && VALUE[B] > VALUE[A]) out.push({ by: i, sq: first, behind: j, abs: false, d });
        break;
      }
    }
  }
  return out;
}
// Enfilade : une pièce à longue portée attaque une cible A (roi en échec, ou pièce plus chère) avec B derrière elle.
export function skewers(g, at, us) {
  const p = g[at], def = other(us), out = [];
  if (!p || !SLIDE[typeOf(p)]) return out;
  for (const d of SLIDE[typeOf(p)]) {
    let first = -1;
    for (const j of RAY[at][d]) {
      if (!g[j]) continue;
      if (colorOf(g[j]) !== def) break;
      if (first < 0) { first = j; continue; }
      const A = typeOf(g[first]), B = typeOf(g[j]);
      if (B !== 'p' && B !== 'k' && (A === 'k' || VALUE[A] > VALUE[B])) out.push({ by: at, front: first, behind: j, d });
      break;
    }
  }
  return out;
}

// Le gain matériel annoncé est-il confirmé ? Par la variante (Δ ≥ 2 en 5 demi-coups, ou mat), sinon par une recherche
// courte : après chaque réponse adverse, une de nos prises gagne au moins `need` (SEE).
export function pvGain(bn, pv, us, plies = 5) {
  let pos = bn.pos;
  const b0 = balance(pos.g, us);
  let best = -99;
  for (let i = 0; i < Math.min(plies, pv.length); i++) {
    const m = findMove(pos, pv[i]);
    if (!m) break;
    pos = play(pos, m);
    if (!hasLegal(pos) && inCheck(pos)) return { mate: true, gain: 99 };
    best = Math.max(best, balance(pos.g, us) - b0);
  }
  // Les prises en suspens comptent seulement quand la variante s'arrête sur un coup adverse : on regarde la reprise.
  return { mate: false, gain: best };
}
export function forcedGain(an, us, need = 2, maxReplies = 8) {
  if (an.status) return an.status === 'mate' ? 99 : -99;
  const replies = an.legal;
  if (replies.length > maxReplies) return null;
  let worst = 99;
  for (const r of replies) {
    const p2 = play(an.pos, r);
    const lost = r.cap ? VALUE[typeOf(r.cap)] : 0;
    let best = -lost;
    for (const m of legalMoves(p2)) {
      if (!m.cap) continue;
      const g = seeMove(p2, m) - lost;
      if (g > best) best = g;
    }
    if (hasMateIn1(p2)) best = 99;
    worst = Math.min(worst, best);
    if (worst < need) return worst;
  }
  return worst;
}

export {
  F, R, name, colorOf, typeOf, other, cheb, manh, edge, VALUE, KING_N, RAY, SLIDE, DIRS, dirOf, between,
  attackSet, pieceAttacks, attacked, attackersOf, kingOf, inCheck, units, legalMoves, hasLegal, play, findMove, sanOf, gridAfter,
};
