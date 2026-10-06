// Faits de l'explicateur (spec §5.3–5.4) : bibliothèque de règles, registre des familles, composition du texte.
// Une règle lit le contexte (positions avant/après, coup, caractéristiques mémoïsées) et rend un fait vérifié ou null.
// Fait : { id, tags?, idea (indice niveau 1, sans révéler le coup), say: [phrase, phrase?], viz?, viz1?, excludes? }
import { idx } from './board64.js';
import {
  node, F, R, name, typeOf, colorOf, other, cheb, edge, VALUE, KING_N, between, knightJump,
  attacked, attackersOf, pieceAttacks, units, legalMoves, play, findMove, sanOf, hasLegal, inCheck,
  cuts, realCut, cutBorder, captures, threatenedBy, checkInfo, rescue, threatsNext, approach, opposition,
  stalemateDanger, mateEveryReply, matesIn1, hasMateIn1, goodReplies, see, seeMove, forkTargets, pins, skewers,
  pvGain, forcedGain, box,
} from './features.js';
import { cap, mine, theirs, king, side, subj, obj, agree, alone, pname, cases, coups, plusQue, line, lineNoun, mv, finish, visible } from './fr.js';

// ---------- Registre ----------
export const RULES = {};
export const FAMILIES = {};
export function rule(def) { RULES[def.id] = def; return def; }
export function register(fam) { for (const id of [].concat(fam.id)) FAMILIES[id] = fam; return fam; }

// ---------- Contexte d'un coup ----------
export function makeCtx({ fen, move, family, ideas = [], pv = [], lastMove = null, tb = null, level = 3 }) {
  const bn = node(fen);
  const m = bn.move(move);
  if (!m) return null;
  const us = bn.turn, def = other(us), an = bn.child(m);
  const c = { fen, move, family, ideas: ideas || [], pv: pv || [], lastMove, tb, level, bn, an, m, us, def, san: bn.san(m), memo: {} };
  c.get = (k, fn) => (k in c.memo ? c.memo[k] : (c.memo[k] = fn()));
  return c;
}
// Caractéristiques paresseuses partagées par les règles.
export const X = {
  t: c => typeOf(c.m.p),
  lone: c => c.bn.lone(c.def),
  K: c => king(c.def),
  Kd: c => c.bn.king(c.def),
  Ku: c => c.bn.king(c.us),
  boxB: c => c.bn.box(c.def),
  boxA: c => c.an.box(c.def),
  check: c => c.get('check', () => checkInfo(c.bn, c.an, c.m, c.def)),
  capsA: c => c.get('capsA', () => captures(c.an).filter(x => typeOf(x.cap) !== 'k')),
  safe: c => !X.capsA(c).length,
  cutsB: c => c.bn.cuts(c.def),
  cutsA: c => c.an.cuts(c.def),
  realCutsA: c => c.get('rcA', () => X.cutsA(c).filter(x => realCut(c.an.g, c.def, x))),
  approach: c => approach(c.m, X.Kd(c)),
  gain: c => c.get('gain', () => {
    // Gain matériel confirmé : variante fournie (≥ 2 en 5 demi-coups, ou mat), sinon recherche forcée courte.
    if (c.pv.length >= 2 && c.pv[0].slice(0, 4) === c.move.slice(0, 4)) {
      const g = pvGain(c.bn, c.pv, c.us);
      if (g.mate || g.gain >= 2) return g.mate ? 99 : g.gain;
    }
    const f = forcedGain(c.an, c.us);
    return f != null && f >= 2 ? f : 0;
  }),
};
const zoneOf = (zone, K) => [...zone].filter(s => s !== K).map(name);
const boxViz = (c, after = true) => ({ zone: zoneOf((after ? X.boxA(c) : X.boxB(c)).zone, after ? c.an.king(c.def) : X.Kd(c)) });
const du = col => `du roi ${col === 'w' ? 'blanc' : 'noir'}`;
const lineKind = (a, b) => (F(a) === F(b) ? 'file' : R(a) === R(b) ? 'rank' : null);
const marks = (list, cls) => Object.fromEntries(list.slice(0, 6).map(s => [typeof s === 'number' ? name(s) : s, cls]));

// =====================================================================================================
// Faits « résultat » et « sécurité » (fixed : jamais dépassés par les idées de l'exercice)
// =====================================================================================================
function matePattern(c) {
  const g = c.an.g, K = c.an.king(c.def), ch = attackersOf(g, K, c.us);
  if (ch.length !== 1) return null;
  const t = typeOf(g[ch[0]]), back = c.def === 'w' ? 0 : 7, fwd = c.def === 'w' ? 1 : -1;
  if (t === 'n' && KING_N[K].every(s => g[s] && colorOf(g[s]) === c.def)) return 'etouffe';
  if ((t === 'r' || t === 'q') && R(K) === back && R(ch[0]) === back) {
    const front = KING_N[K].filter(s => R(s) === back + fwd);
    if (front.some(s => typeOf(g[s]) === 'p' && colorOf(g[s]) === c.def)
      && front.every(s => (g[s] && colorOf(g[s]) === c.def) || attacked(g, s, c.us))) return 'couloir';
  }
  if (t === 'q' && cheb(ch[0], K) === 1 && attackersOf(g, ch[0], c.us).some(s => typeOf(g[s]) === 'b')) return 'batterie';
  return null;
}
rule({ id: 'mate', fixed: true, run(c) {
  if (c.an.status !== 'mate') return null;
  const K = X.K(c), pat = matePattern(c), s = mv(c.san);
  const say = pat === 'etouffe' ? `${s} est un mat à l’étouffée : ${K} est enfermé par ses propres pièces.`
    : pat === 'couloir' ? `${s} est le mat du couloir : ${K} est enfermé derrière ses pions.`
    : pat === 'batterie' ? `${s} est mat : ta dame, protégée par ton fou, touche ${K}.`
    : X.lone(c) ? `${s} est mat : ${K} est en échec et n’a plus aucune case.`
    : `${s} est mat : ${K} est en échec et n’a aucune parade.`;
  return { tags: pat ? ['mate', 'mate-' + pat] : ['mate'], idea: 'Il y a mat en un coup.', say: [say], viz: { marks: { [name(c.an.king(c.def))]: 'mark-ko' } } };
} });

rule({ id: 'mate-every-reply', fixed: true, run(c) {
  if (c.an.status) return null;
  const pairs = c.get('mer', () => mateEveryReply(c.an));
  if (!pairs) return null;
  const lone = X.lone(c), K = X.K(c), an = c.an;
  const rs = p => an.san(p.r), ms = p => sanOf(p.pos, p.m);
  let say;
  if (pairs.length === 1) say = lone ? `${cap(K)} n’a plus qu’un coup, ${mv(rs(pairs[0]))}, et ${mv(ms(pairs[0]), true)} sera mat.`
    : `${cap(side(c.def))} n’ont plus qu’un coup, ${mv(rs(pairs[0]))}, et ${mv(ms(pairs[0]), true)} sera mat.`;
  else if (pairs.length === 2 && lone) say = `S’il joue ${mv(rs(pairs[0]))}, ${mv(ms(pairs[0]), true)} est mat ; s’il joue ${mv(rs(pairs[1]))}, ${mv(ms(pairs[1]), true)} est mat.`;
  else say = lone ? `Quoi que joue ${K}, tu mates au coup suivant.` : `Quoi que jouent ${side(c.def)}, tu mates au coup suivant.`;
  const kingSq = pairs.filter(p => typeOf(p.r.p) === 'k').map(p => p.r.to);
  return { idea: 'Cherche un coup qui ne lui laisse que des coups perdants.', say: [say], excludes: ['stalemate-danger'],
    viz: { ...boxViz(c), marks: marks(kingSq, 'mark-escape') }, viz1: lone ? boxViz(c, false) : {} };
} });

function protector(c, t) {
  const tm = X.t(c);
  if (tm === 'k') return 'ton roi';
  if (tm === t) return `ton autre ${pname(t)}`;
  return mine(tm);
}
rule({ id: 'rescue', fixed: true, run(c) {
  if (!X.lone(c)) return null;
  const r = c.get('rescue', () => rescue(c.bn, c.an, c.m));
  if (!r) return null;
  const t = typeOf(r.piece), K = X.K(c), m = c.m;
  let say, tags = ['rescue'];
  if (r.how === 'flee') {
    tags.push('rescue-flee');
    const kind = lineKind(m.from, m.to), Kd = X.Kd(c);
    const cut = kind && X.realCutsA(c).find(x => x.sq === m.to && x.kind === kind);
    const al = kind === 'file' ? R : F;
    const far = kind && (al(m.to) === 0 || al(m.to) === 7) && Math.abs(al(m.to) - al(Kd)) >= 3 && Math.abs(al(m.to) - al(Kd)) > Math.abs(al(m.from) - al(Kd));
    if (cut && far) say = `${K} attaquait ${mine(t)} : ${subj(t)} s’éloigne à l’autre bout de ${line(kind, kind === 'file' ? F(m.to) : R(m.to))} et garde la coupure.`;
    else if (cut) say = `${K} attaquait ${mine(t)} : ${subj(t)} s’éloigne le long de ${line(kind, kind === 'file' ? F(m.to) : R(m.to))} et garde la coupure.`;
    else say = `${K} attaquait ${mine(t)} : ${subj(t)} se met à l’abri, hors de sa portée.`;
  } else if (r.how === 'defend') {
    tags.push('rescue-defend');
    say = `${K} attaquait ${mine(t)} : ${protector(c, t)} vient ${obj(t)} protéger.`;
  } else {
    say = `${K} attaquait ${mine(t)} : ton coup ${obj(t)} met hors de danger.`;
  }
  return { tags, idea: `${cap(mine(t))} est ${agree('attaqué', t)}.`, say: [say],
    viz1: { marks: { [name(r.sq)]: 'mark-ko' } }, viz: { ...boxViz(c), arrows: [] } };
} });

rule({ id: 'preemptive-flee', fixed: true, run(c) {
  if (!X.lone(c) || c.bn.check || c.an.status) return null;
  if (threatenedBy(c.bn).length || !X.safe(c)) return null;
  const nl = c.bn.nul;
  if (!nl) return null;
  const t0 = c.get('thr0', () => threatsNext(nl));
  if (!t0.length) return null;
  if (threatsNext(c.an).length) return null;
  const m = c.m, K = X.K(c);
  const first = t0.find(x => x.caps.some(k => k.to === m.from)) || t0[0];
  const target = first.caps.find(k => k.to === m.from)?.to ?? first.caps[0].to;
  const t = typeOf(c.bn.g[target]), rSan = nl.san(first.r);
  let say;
  if (target === m.from) {
    const kind = lineKind(m.from, m.to);
    const kept = kind && X.realCutsA(c).find(x => x.sq === m.to && x.kind === kind);
    say = `${K} menaçait d’attaquer ${mine(t)} (${mv(rSan)}) : ${subj(t)} s’éloigne tout de suite${kept ? `, en gardant la coupure sur ${line(kind, kind === 'file' ? F(m.to) : R(m.to))}` : ''}.`;
  } else if (pieceAttacks(c.an.g, m.to)[target]) say = `${K} menaçait d’attaquer ${mine(t)} (${mv(rSan)}) : ${protector(c, t)} vient ${obj(t)} protéger d’avance.`;
  else say = `${K} menaçait d’attaquer ${mine(t)} (${mv(rSan)}) : ton coup écarte cette menace.`;
  return { idea: `Que menacerait ${K} si tu passais ?`, say: [say], viz1: {},
    viz: { ...boxViz(c), arrows: [{ from: name(first.r.from), to: name(first.r.to), cls: 'threat' }] } };
} });

// =====================================================================================================
// Techniques de mat (roi seul)
// =====================================================================================================
rule({ id: 'opposition-check', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate || ch.kind !== 'direct' || !X.lone(c)) return null;
  const t = X.t(c);
  if (t !== 'r' && t !== 'q') return null;
  const Ku = X.Ku(c), Kd = X.Kd(c);
  if (opposition(Ku, Kd) !== 'direct') return null;
  const vertical = F(Ku) === F(Kd);
  if (vertical ? R(c.m.to) !== R(Kd) : F(c.m.to) !== F(Kd)) return null;
  const co = vertical ? R : F, d0 = Math.abs(co(Kd) - co(Ku));
  if (!ch.replies.every(r => typeOf(r.p) === 'k' && !r.cap && Math.abs(co(r.to) - co(Ku)) === d0 + 1)) return null;
  return { idea: 'Les rois se font face : profites-en.',
    say: [`Les rois se font face : l’échec de ${mine(t)} oblige ${X.K(c)} à reculer d’une ${vertical ? 'rangée' : 'colonne'}.`],
    viz: { marks: marks([Ku, Kd], 'mark-ok'), ...boxViz(c) }, viz1: { marks: marks([Ku, Kd], 'mark-ok') } };
} });

rule({ id: 'box-shrink', aliases: ['cut'], run(c) {
  if (!X.lone(c) || c.an.check || c.an.status || !X.safe(c)) return null;
  const a = X.boxB(c).size, b = X.boxA(c).size;
  if (!(b < a)) return null;
  const t = X.t(c), K = X.K(c);
  const cut = t === 'r' && X.realCutsA(c).find(x => x.sq === c.m.to && x.t === 'r');
  const viz = boxViz(c);
  if (cut) {
    viz.marks = marks(cutBorder(cut, X.boxA(c).zone), 'mark-line');
    return { tags: ['box-shrink', 'cut'], idea: `Cherche à resserrer la boîte avec ${mine(t)}.`,
      say: [`${cap(mine(t))} coupe ${K} sur ${line(cut.kind, cut.idx)} : sa boîte passe de ${a} à ${cases(b)}.`], viz, viz1: boxViz(c, false) };
  }
  return { idea: `Cherche à resserrer la boîte avec ${mine(t)}.`,
    say: [`${cap(mine(t))} resserre la boîte ${du(c.def)} : elle passe de ${a} à ${cases(b)}.`], viz, viz1: boxViz(c, false) };
} });

rule({ id: 'knight-jump', run(c) {
  if (X.t(c) !== 'q' || !X.lone(c) || c.an.check || c.an.status || !X.safe(c)) return null;
  const Kd = c.an.king(c.def);
  if (!knightJump(c.m.to, Kd) || edge(Kd) === 0) return null;
  const a = X.boxB(c).size, b = X.boxA(c).size;
  if (!(b < a)) return null;
  return { idea: `Place ta dame à un saut de cavalier ${du(c.def)}.`,
    say: [`Ta dame se place à un saut de cavalier ${du(c.def)} : sa boîte passe de ${a} à ${cases(b)}.`], viz: boxViz(c), viz1: boxViz(c, false) };
} });

rule({ id: 'shadow', run(c) {
  if (!c.lastMove || X.t(c) !== 'q' || !X.lone(c) || c.an.check || c.an.status || !X.safe(c)) return null;
  const lf = idx(c.lastMove.slice(0, 2)), lt = idx(c.lastMove.slice(2, 4)), m = c.m;
  if (lt !== X.Kd(c) || cheb(lf, lt) !== 1) return null;
  if (F(lt) - F(lf) !== F(m.to) - F(m.from) || R(lt) - R(lf) !== R(m.to) - R(m.from)) return null;
  if (!knightJump(m.to, lt) || edge(lt) === 0 || X.boxA(c).size > X.boxB(c).size) return null;
  return { idea: 'La dame suit le roi.', say: [`Ta dame suit ${X.K(c)} comme une ombre : même déplacement, toujours à un saut de cavalier.`],
    viz: boxViz(c), viz1: boxViz(c, false) };
} });

rule({ id: 'kqk-edge', run(c) {
  if (X.t(c) !== 'k' || !X.lone(c) || c.an.status || !X.safe(c)) return null;
  const Kd = X.Kd(c);
  if (edge(Kd) !== 0) return null;
  const Z = [...X.boxB(c).zone];
  const onEdge = [s => F(s) === 0, s => F(s) === 7, s => R(s) === 0, s => R(s) === 7].filter(f => f(Kd));
  if (!onEdge.some(f => Z.every(f))) return null;
  const q = units(c.bn.g, c.us).find(u => u.t === 'q');
  if (!q) return null;
  return { idea: `${cap(X.K(c))} est au bord : à ton roi de jouer.`,
    say: [`${cap(X.K(c))} est collé au bord : la dame a fini de le pousser.`, 'Amène maintenant ton roi.'], viz: boxViz(c), viz1: boxViz(c, false) };
} });

rule({ id: 'driving-check', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate || !X.lone(c) || !ch.driving || !X.safe(c)) return null;
  const Kd = X.Kd(c), K = X.K(c);
  const toward = ch.replies.every(r => edge(r.to) < edge(Kd));
  const a = ch.boxBefore, b = ch.worstBox, same = ch.bestBox === ch.worstBox;
  return { idea: 'Un échec peut le repousser.',
    say: [`L’échec repousse ${K}${toward ? ' vers le bord' : ''} : sa boîte passe de ${a} à ${cases(b)}${same ? '' : ' au plus'}.`],
    viz: { marks: marks(ch.replies.map(r => r.to), 'mark-escape') }, viz1: boxViz(c, false) };
} });

rule({ id: 'ladder', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate || ch.kind !== 'direct' || X.t(c) !== 'r' || !X.lone(c) || !X.safe(c)) return null;
  const Kd = X.Kd(c), m = c.m;
  const kind = R(m.to) === R(Kd) ? 'rank' : F(m.to) === F(Kd) ? 'file' : null;
  if (!kind) return null;
  const co = kind === 'rank' ? R : F, L = co(m.to);
  for (const o of units(c.an.g, c.us).filter(u => u.t === 'r' && u.i !== m.to && Math.abs(co(u.i) - L) === 1)) {
    const s = co(o.i) - L;
    if (!ch.replies.length || !ch.replies.every(r => typeOf(r.p) === 'k' && !r.cap && co(r.to) === L - s)) continue;
    return { idea: 'Escalier : une tour coupe, l’autre donne échec.',
      say: [`Escalier : ta tour en ${name(o.i)} garde ${line(kind, co(o.i))} pendant que l’autre donne échec sur ${line(kind, L)}.`,
        `${cap(X.K(c))} doit reculer d’une ${lineNoun(kind)}.`],
      viz: { marks: marks(ch.replies.map(r => r.to), 'mark-escape') }, viz1: boxViz(c, false) };
  }
  return null;
} });

rule({ id: 'rook-far', run(c) {
  if (X.t(c) !== 'r' || !X.lone(c) || c.an.check || c.an.status || !X.safe(c)) return null;
  const Kd = X.Kd(c), m = c.m, kind = lineKind(m.from, m.to);
  if (!kind || cheb(m.from, Kd) > 2 || cheb(m.to, Kd) < 3) return null;
  const al = kind === 'file' ? R : F, li = kind === 'file' ? F(m.to) : R(m.to);
  const dTo = Math.abs(al(m.to) - al(Kd));
  if (!(dTo >= 4 || ((al(m.to) === 0 || al(m.to) === 7) && dTo >= 3)) || dTo <= Math.abs(al(m.from) - al(Kd))) return null;
  const cut = X.realCutsA(c).find(x => x.sq === m.to && x.kind === kind);
  return { idea: `${cap(mine('r'))} est trop près ${du(c.def)}.`,
    say: [`${cap(mine('r'))} part à l’autre bout de ${line(kind, li)} : ${X.K(c)} ne peut plus l’attaquer${cut ? ', et la coupure reste en place' : ''}.`],
    viz: boxViz(c), viz1: { marks: { [name(m.from)]: 'mark-ko' } } };
} });

function waitingFact(c) {
  if (!X.lone(c) || c.an.check || c.an.status || c.m.cap || c.bn.check || !X.safe(c)) return null;
  if (X.approach(c) || X.boxA(c).size !== X.boxB(c).size) return null;
  const key = cs => cs.map(x => x.kind + x.idx).sort().join();
  if (key(X.cutsB(c)) !== key(X.cutsA(c))) return null;
  const nl = c.bn.nul;
  if (!nl) return null;
  if (!goodReplies(nl, c.def).length) return null;
  if (goodReplies(c.an, c.def).length) return null;
  const cut = X.realCutsA(c)[0];
  return { idea: 'Ne change rien à la boîte : cherche un coup d’attente.',
    say: [`Coup d’attente : ${cut ? `${mine(cut.t)} garde la même coupure et ` : ''}c’est au roi ${c.def === 'w' ? 'blanc' : 'noir'} de jouer.`,
      'Chacun de ses coups te permettra de resserrer la boîte ou de mater.'],
    viz: boxViz(c), viz1: boxViz(c, false) };
}
rule({ id: 'waiting', run: waitingFact });

rule({ id: 'approach-opp', run(c) {
  if (X.t(c) !== 'k' || !X.lone(c) || c.an.status || !X.safe(c) || !X.approach(c)) return null;
  const Kd = X.Kd(c);
  if (opposition(c.m.to, Kd) !== 'direct') return null;
  // Si c'était encore à nous : un échec de face le ferait-il reculer ? (vérifié sur la position « après passe »)
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
  return { idea: `Amène ton roi face ${du(c.def).replace('du', 'au')}.`,
    say: [`Ton roi se place face ${du(c.def).replace('du', 'au')} : quand les rois se font face, l’échec de ${mine(piece.t)} le fait reculer.`],
    viz: { marks: marks([c.m.to, Kd], 'mark-ok'), ...boxViz(c) }, viz1: boxViz(c, false) };
} });

rule({ id: 'approach', run(c) {
  if (!X.lone(c) || c.an.status || !X.safe(c)) return null;
  const a = X.approach(c);
  if (!a) return null;
  const piece = units(c.bn.g, c.us).filter(u => u.t !== 'k');
  // « sans lui, … ne peut pas mater » : vrai pour une tour seule ou une dame seule.
  const why = piece.length === 1 && (piece[0].t === 'r' || piece[0].t === 'q') ? ` : sans lui, ${alone(piece[0].t)} ne peut pas mater` : '';
  const say = a.cheb ? `Ton roi se rapproche (distance ${a.d0} → ${a.d1})${why}.` : `Ton roi se rapproche ${du(c.def)}${why}.`;
  return { idea: 'Ton roi doit participer.', say: [say], viz: { marks: marks([c.m.to, X.Kd(c)], 'mark-ok') }, viz1: boxViz(c, false) };
} });

// Variante principale prolongée par les tables si besoin (déterministe).
function lineOf(c) {
  const pv = c.pv.length && c.pv[0].slice(0, 4) === c.move.slice(0, 4) ? c.pv.slice(0, 3) : [c.move];
  if (pv.length >= 3 || !c.tb) return pv;
  try {
    let fen = c.an.fen;
    const out = [c.move];
    if (pv[1]) out.push(pv[1]);
    else { const r = c.tb.stubborn?.(fen, () => 0); if (!r) return out; out.push(r); }
    const n2 = c.an.child(c.an.move(out[1]) || {});
    fen = n2.fen;
    const best = c.tb.rankMoves?.(fen)?.[0];
    if (best && (best.win || best.dist === 0)) out.push(best.uci);
    return out;
  } catch { return pv; }
}
rule({ id: 'lookahead', run(c) {
  const pv = lineOf(c);
  if (pv.length < 3) return null;
  const r = c.an.move(pv[1]);
  if (!r) return null;
  const n2 = c.an.child(r), m2 = n2.move(pv[2]);
  if (!m2) return null;
  const n3 = n2.child(m2), rS = c.an.san(r), mS = n2.san(m2);
  const viz = { arrows: [{ from: name(m2.from), to: name(m2.to), cls: 'plan' }] };
  if (n3.status === 'mate') return { idea: 'Prépare la suite.', say: [`Prépare la suite : par exemple après ${mv(rS)}, ${mv(mS, true)} est mat.`], viz };
  if (!X.lone(c) || n3.status || captures(n3).some(x => typeOf(x.cap) !== 'k')) return null;
  const a = X.boxB(c).size;
  let b = n3.box(c.def).size;
  if (n3.check) b = Math.max(...n3.legal.map(x => box(play(n3.pos, x).g, c.def).size));
  if (!(b < a)) return null;
  return { idea: 'Prépare la suite.', say: [`Prépare la suite : par exemple après ${mv(rS)} ${mv(mS)}, la boîte tombe de ${a} à ${cases(b)}.`], viz: { ...viz, ...boxViz(c, false) } };
} });

// =====================================================================================================
// Motifs tactiques (F23–F24)
// =====================================================================================================
rule({ id: 'double-check', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate || ch.kind !== 'double') return null;
  return { idea: 'Deux pièces peuvent donner échec à la fois.',
    say: [`Échec double : deux pièces donnent échec, ${X.K(c)} est obligé de bouger.`],
    viz: { arrows: ch.checkers.slice(0, 2).map(s => ({ from: name(s), to: name(c.an.king(c.def)), cls: 'good' })) } };
} });

const target = (s, t, def) => (t === 'k' ? `le roi en ${name(s)}` : `${theirs(t, def)} en ${name(s)}`);
rule({ id: 'fork', run(c) {
  if (c.an.status) return null;
  const ts = forkTargets(c.an, c.m.to, c.us).sort((a, b) => (b.t === 'k') - (a.t === 'k') || VALUE[b.t] - VALUE[a.t] || a.sq - b.sq);
  if (ts.length < 2) return null;
  if (!c.an.check && see(c.an.pos, c.m.to) > 0) return null;
  const g = X.gain(c);
  const say = [`Fourchette : ${mv(c.san)} attaque à la fois ${target(ts[0].sq, ts[0].t, c.def)} et ${target(ts[1].sq, ts[1].t, c.def)}.`];
  if (g >= 2) say.push(g >= 99 ? 'La suite mène au mat.' : 'Tu gagnes du matériel.');
  const t = X.t(c);
  return { idea: t === 'n' ? 'Cherche une case d’où ton cavalier attaque deux pièces : avec échec, c’est imparable.' : `Une de tes pièces peut attaquer deux cibles à la fois.`,
    say, tags: g >= 2 ? ['fork', 'gain'] : ['fork'],
    viz: { arrows: ts.slice(0, 2).map(x => ({ from: name(c.m.to), to: name(x.sq), cls: 'good' })), marks: marks(ts.slice(0, 2).map(x => x.sq), 'mark-ko') } };
} });

rule({ id: 'skewer', run(c) {
  if (c.an.status) return null;
  const sk = skewers(c.an.g, c.m.to, c.us).sort((a, b) => (typeOf(c.an.g[b.front]) === 'k') - (typeOf(c.an.g[a.front]) === 'k'));
  if (!sk.length) return null;
  const s = sk[0], ft = typeOf(c.an.g[s.front]), bt = typeOf(c.an.g[s.behind]), t = X.t(c);
  if (ft !== 'k' && see(c.an.pos, c.m.to) > 0) return null;
  const g = X.gain(c), K = X.K(c);
  let say;
  if (ft === 'k') say = g >= 2 ? `Enfilade : échec sur la ligne, ${K} s’écarte et ${theirs(bt, c.def)} derrière lui tombe.`
    : `Enfilade : ${mine(t)} fait échec, et ${theirs(bt, c.def)} est derrière ${K} sur la même ligne.`;
  else say = g >= 2 ? `Enfilade : ${theirs(ft, c.def)} doit s’écarter, et ${theirs(bt, c.def)} derrière ${ft === 'q' || ft === 'r' ? 'elle' : 'lui'} tombe.`
    : `Enfilade : ${mine(t)} attaque ${theirs(ft, c.def)}, et ${theirs(bt, c.def)} est derrière sur la même ligne.`;
  return { idea: ft === 'k' ? 'Le roi et une pièce derrière lui sont alignés.' : 'Deux pièces adverses sont alignées.', say: [say],
    tags: g >= 2 ? ['skewer', 'gain'] : ['skewer'],
    viz: { arrows: [{ from: name(c.m.to), to: name(s.behind), cls: 'good' }], marks: marks([s.front, s.behind], 'mark-ko') } };
} });

rule({ id: 'pin', run(c) {
  if (c.an.status) return null;
  const after = pins(c.an.g, c.us), PA = pieceAttacks(c.an.g, c.m.to), mt = X.t(c);
  const stuck = sq => !c.an.legal.some(r => r.from === sq);
  // (b) le coup attaque une pièce clouée (absolument) avec moins cher qu'elle, ou sans défenseur
  const ex = after.find(p => p.abs && PA[p.sq] && p.by !== c.m.to && typeOf(c.an.g[p.sq]) !== 'k'
    && (VALUE[mt] < VALUE[typeOf(c.an.g[p.sq])] || !attacked(c.an.g, p.sq, c.def)));
  if (ex) {
    const t = typeOf(c.an.g[ex.sq]), g = X.gain(c);
    const say = [stuck(ex.sq) ? `Clouage : ${theirs(t, c.def)} ne peut pas bouger (son roi serait en échec) ; ${mv(c.san)} l’attaque.`
      : `Clouage : ${theirs(t, c.def)} ne peut pas quitter la ligne (son roi serait en échec) ; ${mv(c.san)} l’attaque.`];
    if (g >= 2) say.push(`Tu vas ${obj(t)} gagner.`);
    return { idea: 'Une pièce clouée ne peut pas fuir : attaque-la avec moins cher qu’elle.', say, tags: g >= 2 ? ['pin', 'gain'] : ['pin'],
      viz: { marks: marks([ex.sq], 'mark-ko'), arrows: [{ from: name(ex.by), to: name(ex.behind), cls: 'good' }] } };
  }
  // (a) le coup crée un clouage
  const before = pins(c.bn.g, c.us);
  const nw = after.find(p => p.by === c.m.to && !before.some(q => q.sq === p.sq && q.behind === p.behind));
  if (!nw || (see(c.an.pos, c.m.to) > 0 && !nw.abs)) return null;
  const t = typeOf(c.an.g[nw.sq]), tb = typeOf(c.an.g[nw.behind]);
  const say = nw.abs ? (stuck(nw.sq) ? `Clouage : ${theirs(t, c.def)} ne peut plus bouger, sinon son roi serait en échec.`
    : `Clouage : ${theirs(t, c.def)} ne peut plus quitter la ligne, sinon son roi serait en échec.`)
    : `Clouage : ${theirs(t, c.def)} est ${agree('cloué', t)} devant ${theirs(tb, c.def)}.`;
  return { idea: 'Une pièce adverse est sur la même ligne que son roi ou qu’une pièce plus chère.', say: [say],
    viz: { marks: marks([nw.sq], 'mark-ko'), arrows: [{ from: name(nw.by), to: name(nw.behind), cls: 'good' }] } };
} });

rule({ id: 'hanging-take', aliases: ['see-gain'], run(c) {
  const m = c.m;
  if (!m.cap) return null;
  const t = typeOf(m.cap), recap = c.an.legal.some(r => r.to === m.to && r.cap);
  if (!recap) {
    const said = attacked(c.bn.g, m.to, c.def)
      ? `Son défenseur ne peut pas reprendre : tu prends ${theirs(t, c.def)} gratuitement.`
      : `${cap(theirs(t, c.def))} n’était pas ${agree('protégé', t)} : tu ${obj(t)} prends gratuitement.`;
    return { tags: ['hanging-take'], idea: 'Une pièce adverse n’a aucun défenseur.', say: [said], viz: { marks: marks([m.to], 'mark-ko') } };
  }
  if (seeMove(c.bn.pos, m) >= 2) return { tags: ['see-gain'], idea: 'Un échange te rapporte du matériel.',
    say: [`Tu prends ${theirs(t, c.def)} : même après la reprise, tu gagnes du matériel.`], viz: { marks: marks([m.to], 'mark-ko') } };
  return null;
} });

rule({ id: 'mate-threat', run(c) {
  if (c.an.check || c.an.status) return null;
  const nl = c.an.nul;
  if (!nl) return null;
  const mt = hasMateIn1(nl.pos);
  if (!mt) return null;
  return { idea: 'Prépare une menace de mat.', say: [`Ce coup menace ${mv(nl.san(mt), true)} mat.`],
    viz: { arrows: [{ from: name(mt.from), to: name(mt.to), cls: 'plan' }] } };
} });

function parryHow(c, T, threatTo) {
  const m = c.m, Ku = c.an.king(c.us), t = X.t(c);
  if (m.cap && m.to === T.from) return 'tu prends la pièce qui menaçait';
  if (t === 'p' && KING_N[c.bn.king(c.us)].includes(m.from)) return 'tu donnes de l’air à ton roi';
  if (t === 'k') return 'ton roi se met à l’abri';
  if (between(T.from, threatTo).includes(m.to) || between(T.from, Ku).includes(m.to)) return 'tu bloques la ligne';
  if (pieceAttacks(c.an.g, m.to)[T.to]) {
    const back = c.us === 'w' ? 0 : 7;
    return R(T.to) === back ? 'tu protèges ta première rangée' : `tu protèges la case ${name(T.to)}`;
  }
  return 'ton coup pare la menace';
}
rule({ id: 'parry-threat', aliases: ['luft'], run(c) {
  if (c.bn.check || c.an.status) return null;
  const nb = c.bn.nul;
  if (!nb) return null;
  const threats = c.get('mThr', () => matesIn1(nb.pos));
  const them = cap(side(c.def));
  if (threats.length) {
    if (hasMateIn1(c.an.pos)) return null;
    const T = threats[0], how = parryHow(c, T, T.to);
    return { tags: how.includes('air') ? ['parry-threat', 'luft'] : ['parry-threat'], idea: 'Que menace son dernier coup ?',
      say: [`${them} menaçaient ${mv(nb.san(T), true)} mat : ${how}.`],
      viz: { arrows: [{ from: name(T.from), to: name(T.to), cls: 'threat' }] } };
  }
  const thr = captures(nb).filter(x => typeOf(x.cap) !== 'k' && seeMove(nb.pos, x) >= 2)
    .sort((a, b) => VALUE[typeOf(b.cap)] - VALUE[typeOf(a.cap)] || a.to - b.to);
  if (!thr.length) return null;
  if (captures(c.an).some(x => typeOf(x.cap) !== 'k' && seeMove(c.an.pos, x) >= 2)) return null;
  const T = thr[0], t = typeOf(T.cap), m = c.m;
  const how = m.from === T.to ? `${subj(t)} se met à l’abri` : m.cap && m.to === T.from ? 'tu prends la pièce qui attaquait'
    : pieceAttacks(c.an.g, m.to)[T.to] ? `tu ${obj(t)} protèges` : between(T.from, T.to).includes(m.to) ? 'tu bloques la ligne' : 'ton coup pare la menace';
  return { idea: 'Que menace son dernier coup ?', say: [`${them} menaçaient de prendre ${mine(t)} en ${name(T.to)} : ${how}.`],
    viz: { arrows: [{ from: name(T.from), to: name(T.to), cls: 'threat' }] } };
} });

// Faits génériques de dernier recours (toujours vrais)
rule({ id: 'check', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate) return null;
  const n = c.an.legal.length;
  return { idea: 'Un échec peut aider.', say: [`${mv(c.san)} donne échec : ${X.lone(c) ? X.K(c) : side(c.def)} ${X.lone(c) ? 'n’a' : 'n’ont'} ${n === 1 ? 'qu’un coup' : `que ${coups(n)}`} pour y répondre.`] };
} });
rule({ id: 'capture', run(c) {
  if (!c.m.cap) return null;
  return { idea: 'Regarde ce que tu peux prendre.', say: [`Tu prends ${theirs(typeOf(c.m.cap), c.def)}.`] };
} });

// Avertissements (second emplacement)
rule({ id: 'stalemate-danger', warn: true, run(c) {
  const d = stalemateDanger(c.an, c.def);
  if (!d) return null;
  const sqs = d.sqs.map(name);
  return { idea: 'Attention au pat !', say: [`Attention au pat : ${X.K(c)} n’a ${plusQue(d.n)} (${sqs.join(', ')}).`], viz: { marks: marks(sqs, 'mark-escape') } };
} });
rule({ id: 'underpromo', warn: true, run(c) {
  const m = c.m;
  if (!m.promo || m.promo === 'q') return null;
  const p2 = play(c.bn.pos, { ...m, promo: 'q' });
  if (hasLegal(p2) || inCheck(p2)) return null;
  return { idea: 'Attention : une dame ferait pat.', say: [`Promotion en ${pname(m.promo)} : une dame ferait pat.`] };
} });

// =====================================================================================================
// Composition
// =====================================================================================================
const asRule = r => (typeof r === 'string' ? RULES[r] : r);
const matchesIdea = (r, ideas) => ideas.includes(r.id) || (r.aliases || []).some(a => ideas.includes(a));
export const stats = { errors: 0, last: null };
function safeRun(r, c) {
  try { return r.run(c); } catch (e) { stats.errors++; stats.last = e; return null; }
}
// Évalue les règles de la famille dans l'ordre de priorité (paresseusement) → { primary, warning, prio }
export function evaluate(c, fam) {
  const list = (fam.rules || []).map(asRule).filter(Boolean);
  const ranked = list.map((r, i) => ({ r, i, prio: (r.fixed ? 2000 : 1000) - 10 * i + (!r.fixed && matchesIdea(r, c.ideas) ? 15 : 0) }))
    .sort((a, b) => b.prio - a.prio || a.i - b.i);
  let primary = null, prio = 0;
  for (const { r, prio: p } of ranked) {
    const f = safeRun(r, c);
    if (f) { primary = { id: r.id, ...f }; prio = p; break; }
  }
  let warning = null;
  for (const w of (fam.warnings || []).map(asRule).filter(Boolean)) {
    if (primary && (primary.excludes || []).includes(w.id)) continue;
    const f = safeRun(w, c);
    if (f) { warning = { id: w.id, ...f }; break; }
  }
  return { primary, warning, prio };
}
// Texte final : phrase principale, puis l'avertissement ou la seconde phrase du fait ; ≤ 180 caractères visibles.
export function sentences(primary, warning, max = 180) {
  const s = [primary.say[0]];
  const second = warning ? warning.say[0] : primary.say[1];
  if (second && visible(s[0] + ' ' + second) <= max) s.push(second);
  return s.map(finish).filter(Boolean);
}
// Fusion des visuels : 1 zone, ≤ 2 flèches, ≤ 6 marques.
export function mergeViz(...vs) {
  const out = {};
  for (const v of vs) {
    if (!v) continue;
    if (v.zone && !out.zone) out.zone = v.zone;
    if (v.marks) out.marks = { ...(out.marks || {}), ...v.marks };
    if (v.arrows) out.arrows = [...(out.arrows || []), ...v.arrows];
  }
  if (out.marks) out.marks = Object.fromEntries(Object.entries(out.marks).slice(0, 6));
  if (out.arrows) out.arrows = out.arrows.slice(0, 2);
  return out;
}
export { finish, visible };
