// Faits de l'explicateur (spec §5.3–5.4) : registre des greffons, contexte d'un coup, bibliothèque de faits partagés.
//
// Un fait (« rule ») lit le contexte d'un coup et rend un énoncé vérifié, ou null. Il ne devine jamais : chaque
// nombre, chaque case et chaque mot (« mat », « gratuitement », « au plus »…) vient d'un calcul sur l'échiquier.
//
//   rule({ id, fixed?, warn?, aliases?, run(c) → Fact | null })
//   Fact = { idea,            // indice niveau 1 : l'idée, sans le coup ni sa case d'arrivée
//            say: [s1, s2?],  // niveau 3 : 1 ou 2 phrases (la 2e peut céder la place à un avertissement)
//            short?,          // forme courte d'un avertissement, si la longue ne tient pas
//            tags?, data?,    // étiquettes (tests, statistiques) et valeurs calculées
//            viz?, viz1?,     // visuels après le coup (niveau 3) / sans rien révéler (niveaux 1–2)
//            excludes? }      // avertissements rendus inutiles par ce fait
//
// Les familles (js/explain/families/*.js) assemblent ces faits par priorité : voir family() plus bas et index.js.
import { idx } from './board64.js';
import {
  node, F, R, name, typeOf, colorOf, other, cheb, edge, VALUE, KING_N, between,
  attacked, attackersOf, pieceAttacks, units, legalMoves, play, inCheck, dirOf, sanOf,
  realCut, cutBorder, captures, checkInfo, rescue, threatsNext, approach,
  stalemateDanger, mateEveryReply, matesIn1, hasMateIn1, see, seeMove, forkTargets, pins, skewers,
  lineGain, staticGain, worstBoxAfter, box,
} from './features.js';
import {
  cap, mine, theirs, king, side, subj, pron, du, who, agree, alone, pname, cases, plusQue, line,
  mv, finish, visible,
} from './fr.js';

// =====================================================================================================
// Registre
// =====================================================================================================
export const RULES = {};      // id → fait
export const REASONS = {};    // id → raison d'erreur (explainMistake), voir mistakes.js
export const FAMILIES = {};   // id de famille → définition
export function rule(def) { RULES[def.id] = def; return def; }
export function reason(def) { REASONS[def.id] = def; return def; }
// Une famille : { id (ou liste d'ids), rules: [ids ou faits, par priorité], warnings: [ids], mistakes: [ids de raisons],
//                 fallback: { idea, say } }. Les faits nommés par chaîne sont résolus à l'usage (ordre d'import libre).
export function family(def) {
  for (const id of [].concat(def.id)) FAMILIES[id] = { rules: [], warnings: [], mistakes: [], ...def, id };
  return def;
}
// Famille d'un exercice : exacte, sinon préfixe (« tactic:xyz » → « tactic:* »), sinon la famille générique « * ».
export function familyOf(id) {
  if (id && FAMILIES[id]) return FAMILIES[id];
  const pre = id && String(id).includes(':') ? String(id).split(':')[0] + ':*' : null;
  return (pre && FAMILIES[pre]) || FAMILIES['*'];
}

// =====================================================================================================
// Contexte d'un coup
// =====================================================================================================
const same4 = (a, b) => !!a && !!b && a.slice(0, 4) === b.slice(0, 4);
export function makeCtx({ fen, move, family: fam = null, ideas = [], pv = [], lastMove = null, tb = null, level = 3 }) {
  if (!fen || !move) return null;
  const bn = node(fen);
  const m = bn.move(move);
  if (!m) return null;
  const us = bn.turn, def = other(us), an = bn.child(m);
  const line = Array.isArray(pv) && pv.length && same4(pv[0], move) ? pv : [move];
  const c = { fen, move, family: fam, ideas: ideas || [], pv: line, lastMove, tb, level, bn, an, m, us, def, san: bn.san(m), memo: {} };
  c.get = (k, fn) => (k in c.memo ? c.memo[k] : (c.memo[k] = fn()));
  return c;
}
// Caractéristiques paresseuses partagées par les faits (mémoïsées dans le contexte ou dans les nœuds).
export const X = {
  t: c => typeOf(c.m.p),
  lone: c => c.bn.lone(c.def),
  // Le défenseur n'a que son roi et des pions (bloqués dans les exercices « avec pions »).
  bare: c => c.bn.bare(c.def),
  // Technique de mat : défenseur réduit au roi (et à des pions), et nous avons une tour ou une dame.
  mating: c => c.get('mating', () => c.bn.bare(c.def) && units(c.bn.g, c.us).some(u => u.t === 'r' || u.t === 'q')),
  K: c => king(c.def),
  Kd: c => c.bn.king(c.def),
  Ku: c => c.bn.king(c.us),
  boxB: c => c.bn.box(c.def),
  boxA: c => c.an.box(c.def),
  check: c => c.get('check', () => checkInfo(c.bn, c.an, c.m, c.def)),
  capsA: c => c.get('capsA', () => captures(c.an).filter(x => typeOf(x.cap) !== 'k')),
  // Après le coup, l'adversaire ne peut rien prendre.
  safe: c => !X.capsA(c).length,
  cutsB: c => c.bn.cuts(c.def),
  cutsA: c => c.an.cuts(c.def),
  realCutsA: c => c.get('rcA', () => X.cutsA(c).filter(x => realCut(c.an.g, c.def, x))),
  approach: c => approach(c.m, X.Kd(c)),
  // Gain matériel confirmé (spec §5.2 F24) : par la variante si elle commence par ce coup (≥ 2 demi-coups),
  // sinon par un minimax court. null = non confirmé.
  gain: c => c.get('gain', () => {
    if (c.pv.length >= 2) { const g = lineGain(c.bn, c.pv, c.us); if (g != null) return g; }
    return staticGain(c.an, c.m, c.us);
  }),
  // Pièce adverse qui attaque : « le roi noir », « le pion noir »…
  by: (c, mvObj) => who(typeOf(mvObj.p), c.def),
};
// Toute la boîte est colorée (case du roi comprise) : le nombre de cases annoncé est celui qu'on voit.
export const zoneOf = zone => [...zone].map(name);
export const boxViz = (c, after = true) => ({ zone: zoneOf((after ? X.boxA(c) : X.boxB(c)).zone) });
export const lineKind = (a, b) => (F(a) === F(b) ? 'file' : R(a) === R(b) ? 'rank' : null);
export const lineOfSq = (kind, s) => (kind === 'file' ? F(s) : R(s));
export const marks = (list, cls) => Object.fromEntries(list.slice(0, 6).map(s => [typeof s === 'number' ? name(s) : s, cls]));
const isHeavy = t => t === 'r' || t === 'q';
// Notre unique pièce (hors roi) est une tour ou une dame, et le défenseur n'a que son roi : « sans ton roi, … ne peut pas mater ».
const soloMajor = c => {
  if (!X.lone(c)) return null;
  const u = units(c.bn.g, c.us).filter(x => x.t !== 'k');
  return u.length === 1 && isHeavy(u[0].t) ? u[0].t : null;
};

// =====================================================================================================
// Résultat et sécurité (fixed : passent avant les idées de l'exercice)
// =====================================================================================================
function matePattern(c) {
  const g = c.an.g, K = c.an.king(c.def), ch = attackersOf(g, K, c.us);
  if (ch.length !== 1) return null;
  const t = typeOf(g[ch[0]]), back = c.def === 'w' ? 0 : 7, fwd = c.def === 'w' ? 1 : -1;
  if (t === 'n' && KING_N[K].every(s => g[s] && colorOf(g[s]) === c.def)) return 'etouffe';
  if (isHeavy(t) && R(K) === back && R(ch[0]) === back) {
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
    : X.bare(c) ? `${s} est mat : ${K} est en échec et n’a plus aucune case.`
    : `${s} est mat : ${K} est en échec et n’a aucune parade.`;
  return { tags: pat ? ['mate', 'mate-' + pat] : ['mate'], idea: 'Il y a mat en un coup.', say: [say],
    viz: { marks: { [name(c.an.king(c.def))]: 'mark-ko' } } };
} });

rule({ id: 'mate-every-reply', fixed: true, run(c) {
  if (c.an.status) return null;
  const pairs = c.get('mer', () => mateEveryReply(c.an));
  if (!pairs) return null;
  const ko = c.an.kingOnly, K = X.K(c), an = c.an;
  const rs = p => mv(an.san(p.r)), ms = p => mv(sanOf(p.pos, p.m), true);
  let say;
  if (pairs.length === 1) say = `${ko ? `${cap(K)} n’a` : `${cap(side(c.def))} n’ont`} plus qu’un coup, ${rs(pairs[0])}, et ${ms(pairs[0])} sera mat.`;
  else if (pairs.length === 2 && ko) say = `${cap(K)} n’a que deux coups : après ${rs(pairs[0])}, ${ms(pairs[0])} est mat ; après ${rs(pairs[1])}, ${ms(pairs[1])} aussi.`;
  else say = ko ? `Quoi que joue ${K}, tu mates au coup suivant.` : `Quoi que jouent ${side(c.def)}, tu mates au coup suivant.`;
  const kingSq = pairs.filter(p => typeOf(p.r.p) === 'k').map(p => p.r.to);
  return { idea: 'Cherche un coup qui ne lui laisse que des coups perdants.', say: [say], excludes: ['stalemate-danger'],
    viz: { ...(X.mating(c) ? boxViz(c) : {}), marks: marks(kingSq, 'mark-escape') }, viz1: X.mating(c) ? boxViz(c, false) : {} };
} });

function protector(c, t) {
  const tm = X.t(c);
  if (tm === 'k') return 'ton roi';
  if (tm === t) return `ton autre ${pname(t)}`;
  return mine(tm);
}
rule({ id: 'rescue', fixed: true, run(c) {
  if (!X.bare(c)) return null;
  const r = c.get('rescue', () => rescue(c.bn, c.an, c.m));
  if (!r || !r.by) return null;
  const t = typeOf(r.piece), m = c.m, A = X.by(c, r.by);
  let say;
  const tags = ['rescue'];
  if (r.how === 'flee') {
    tags.push('rescue-flee');
    const kind = lineKind(m.from, m.to);
    const cut = kind && X.realCutsA(c).find(x => x.sq === m.to && x.kind === kind);
    const L = kind && line(kind, lineOfSq(kind, m.to));
    const al = kind === 'file' ? R : F;
    const end = kind && (al(m.to) === 0 || al(m.to) === 7);
    if (cut && end) say = `${A} attaquait ${mine(t)} : ${subj(t)} s’éloigne au bout de ${L}, en gardant la coupure.`;
    else if (cut) say = `${A} attaquait ${mine(t)} : ${subj(t)} s’éloigne le long de ${L}, en gardant la coupure.`;
    else say = `${A} attaquait ${mine(t)} : ${subj(t)} se met à l’abri.`;
  } else if (r.how === 'defend') {
    tags.push('rescue-defend');
    say = `${A} attaquait ${mine(t)} : ${protector(c, t)} vient ${pron(t, 'protéger')}.`;
  } else {
    if (c.an.check) return null;
    say = `${A} attaquait ${mine(t)} : ton coup ${pron(t, 'met')} hors de prise.`;
  }
  const at = r.how === 'flee' ? m.to : r.sq;
  return { tags, idea: `${cap(mine(t))} est ${agree('attaqué', t)}.`, say: [say],
    viz1: { marks: { [name(r.sq)]: 'mark-ko' } }, viz: { ...boxViz(c), marks: { [name(at)]: 'mark-ok' } } };
} });

rule({ id: 'preemptive-flee', fixed: true, run(c) {
  if (!X.bare(c) || c.bn.check || c.an.status) return null;
  if (!X.safe(c)) return null;
  const nl = c.bn.nul;
  if (!nl || captures(nl).some(x => typeOf(x.cap) !== 'k' && seeMove(nl.pos, x) > 0)) return null;
  // Menaces à un coup du roi adverse, si nous passions : il marche, puis prend une pièce non défendue.
  const t0 = c.get('thr0', () => threatsNext(nl).filter(x => typeOf(x.r.p) === 'k' && x.caps.some(k => typeOf(k.p) === 'k')));
  if (!t0.length) return null;
  if (threatsNext(c.an).length) return null;
  const m = c.m, K = X.K(c);
  const first = t0.find(x => x.caps.some(k => k.to === m.from && typeOf(k.p) === 'k')) || t0[0];
  const target = first.caps.find(k => k.to === m.from)?.to ?? first.caps.find(k => typeOf(k.p) === 'k').to;
  const t = typeOf(c.bn.g[target]), rSan = nl.san(first.r);
  let say;
  if (target === m.from) {
    const kind = lineKind(m.from, m.to);
    const kept = kind && X.realCutsA(c).find(x => x.sq === m.to && x.kind === kind);
    say = `${cap(K)} menaçait d’attaquer ${mine(t)} (${mv(rSan)}) : ${subj(t)} s’éloigne tout de suite${kept ? `, en gardant la coupure sur ${line(kind, lineOfSq(kind, m.to))}` : ''}.`;
  } else if (pieceAttacks(c.an.g, m.to)[target]) say = `${cap(K)} menaçait d’attaquer ${mine(t)} (${mv(rSan)}) : ${protector(c, t)} vient ${pron(t, 'protéger')} d’avance.`;
  else if (X.t(c) === 'k') say = `${cap(K)} menaçait d’attaquer ${mine(t)} (${mv(rSan)}) : ton roi lui barre la route.`;
  else say = `${cap(K)} menaçait d’attaquer ${mine(t)} (${mv(rSan)}) : ton coup écarte cette menace.`;
  return { idea: `Que menacerait ${K} si tu passais ?`, say: [say], viz1: {},
    viz: { ...boxViz(c), arrows: [{ from: name(first.r.from), to: name(first.r.to), cls: 'threat' }] } };
} });

// =====================================================================================================
// Techniques de mat (roi seul, ou roi et pions bloqués)
// =====================================================================================================
rule({ id: 'box-shrink', aliases: ['cut'], run(c) {
  const t = X.t(c);
  if (!X.mating(c) || !'qrbn'.includes(t) || c.an.check || c.an.status || !X.safe(c)) return null;
  const a = X.boxB(c).size, b = X.boxA(c).size;
  if (!(b < a)) return null;
  const K = X.K(c), viz = boxViz(c);
  const cut = t === 'r' && X.realCutsA(c).find(x => x.sq === c.m.to && x.t === 'r');
  const idea = `Cherche à resserrer la boîte avec ${mine(t)}.`;
  if (cut) {
    viz.marks = marks(cutBorder(cut, X.boxA(c).zone), 'mark-line');
    return { tags: ['box-shrink', 'cut'], data: { a, b }, idea,
      say: [`${cap(mine(t))} coupe ${K} sur ${line(cut.kind, cut.idx)} : sa boîte passe de ${a} à ${cases(b)}.`], viz, viz1: boxViz(c, false) };
  }
  return { tags: ['box-shrink'], data: { a, b }, idea,
    say: [`${cap(mine(t))} resserre la boîte ${du(c.def)} : elle passe de ${a} à ${cases(b)}.`], viz, viz1: boxViz(c, false) };
} });

rule({ id: 'driving-check', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate || !X.mating(c) || !ch.driving || !X.safe(c)) return null;
  const Kd = X.Kd(c), K = X.K(c);
  const toward = ch.replies.every(r => typeOf(r.p) === 'k' && edge(r.to) < edge(Kd));
  const a = ch.boxBefore, b = ch.worstBox, same = ch.bestBox === ch.worstBox;
  return { tags: ['driving-check'], data: { a, b }, idea: `Un échec peut repousser ${X.K(c)}.`,
    say: [`L’échec repousse ${K}${toward ? ' vers le bord' : ''} : sa boîte passe de ${a} à ${cases(b)}${same ? '' : ' au plus'}.`],
    viz: { marks: marks(ch.replies.map(r => r.to), 'mark-escape') }, viz1: boxViz(c, false) };
} });

rule({ id: 'approach', run(c) {
  if (!X.mating(c) || c.an.status || !X.safe(c)) return null;
  const a = X.approach(c);
  if (!a) return null;
  const solo = soloMajor(c);
  const why = solo ? ` : sans lui, ${alone(solo)} ne peut pas mater` : '';
  const say = a.cheb ? `Ton roi se rapproche ${du(c.def)} (distance ${a.d0} → ${a.d1})${why}.` : `Ton roi se rapproche ${du(c.def)}${why}.`;
  return { tags: ['approach'], data: a, idea: 'Ton roi doit participer.', say: [say],
    viz: { marks: marks([c.m.to, X.Kd(c)], 'mark-ok') }, viz1: boxViz(c, false) };
} });

// ---------- Pions (finales de mat avec pions, et générique) ----------
rule({ id: 'promote', run(c) {
  const m = c.m;
  if (!m.promo) return null;
  return { tags: ['promote'], idea: 'Un de tes pions peut aller à dame.',
    say: [`${mv(c.san)} : ton pion devient ${m.promo === 'q' || m.promo === 'r' ? 'une' : 'un'} ${pname(m.promo)}.`],
    viz: { marks: marks([m.to], 'mark-ok') } };
} });
// Pion passé qui avance ; « il ne peut plus le rattraper » seulement par la règle du carré, chemin libre, défenseur sans pièces.
const passed = (g, s, us) => {
  const dir = us === 'w' ? 1 : -1, them = us === 'w' ? 'p' : 'P';
  for (let r = R(s) + dir; r >= 0 && r < 8; r += dir) for (let f = F(s) - 1; f <= F(s) + 1; f++) if (f >= 0 && f < 8 && g[r * 8 + f] === them) return false;
  return true;
};
rule({ id: 'passed-push', run(c) {
  const m = c.m;
  if (X.t(c) !== 'p' || m.promo || m.cap || c.an.status || !passed(c.an.g, m.to, c.us)) return null;
  if (captures(c.an).some(x => x.to === m.to)) return null;
  const dir = c.us === 'w' ? 1 : -1, last = c.us === 'w' ? 7 : 0, path = [];
  for (let r = R(m.to) + dir; dir > 0 ? r <= last : r >= last; r += dir) path.push(r * 8 + F(m.to));
  const steps = path.length, K = c.an.king(c.def), Q = last * 8 + F(m.to);
  // Règle du carré : le roi adverse (au trait) atteint-il la case de promotion à temps ?
  const out = X.bare(c) && c.an.kingOnly && path.every(s => !c.an.g[s]) && cheb(K, Q) - 1 > steps - 1 && cheb(K, m.to) > 1;
  return { tags: out ? ['passed-push', 'out-of-square'] : ['passed-push'], idea: 'Un pion passé ne demande qu’à avancer.',
    say: [out ? `Ton pion passé avance : ${X.K(c)} est hors du carré, il ne peut plus le rattraper.` : 'Ton pion passé avance vers la promotion.'],
    viz: { marks: marks([Q], 'mark-key') } };
} });

// ---------- Prolongement (F14) : « par exemple » ----------
// Suite de 3 demi-coups : la variante fournie, sinon (tables) une suite exacte choisie de façon symétrique :
// parmi les défenses les plus têtues, celle qui laisse la plus grande boîte après notre meilleure réponse.
function boxAt(n, def) {
  if (n.status === 'mate') return 0;
  if (n.check) return worstBoxAfter(n, def) ?? 0;
  return n.box(def).size;
}
function tbLine(c) {
  const tb = c.tb, an = c.an;
  if (!tb || an.status) return null;
  try {
    const replies = tb.rankMoves(an.fen);
    if (!replies.length) return null;
    const top = replies.filter(r => r.win === replies[0].win && r.dist === replies[0].dist && !r.capture);
    let pick = null;
    for (const r of top) {
      const rm = an.move(r.uci);
      if (!rm) continue;
      const n2 = an.child(rm), ours = tb.rankMoves(n2.fen);
      if (!ours.length || !ours[0].win) continue;
      const best = ours.filter(x => x.win && x.dist === ours[0].dist);
      let mine2 = null;
      for (const x of best) {
        const m2 = n2.move(x.uci);
        if (!m2) continue;
        const n3 = n2.child(m2);
        if (n3.status === 'stalemate' || captures(n3).length) continue;
        const s = boxAt(n3, c.def);
        if (!mine2 || s < mine2.s) mine2 = { m2, n3, s };
      }
      if (mine2 && (!pick || mine2.s > pick.s)) pick = { r: rm, n2, ...mine2 };
    }
    return pick;
  } catch { return null; }
}
function pvLine(c, plies) {
  const out = [];
  let n = c.bn;
  for (let i = 0; i < Math.min(plies, c.pv.length); i++) {
    const m = n.move(c.pv[i]);
    if (!m) break;
    const nx = n.child(m);
    out.push({ m, san: n.san(m), n: nx });
    n = nx;
    if (nx.status) break;
  }
  return out;
}
rule({ id: 'lookahead', run(c) {
  // 1. Mat dans la variante (≤ 5 demi-coups)
  const L = pvLine(c, 5);
  const mateAt = L.findIndex(x => x.n.status === 'mate');
  if (mateAt >= 2 && mateAt % 2 === 0) {
    const seq = L.slice(1, mateAt + 1).map(x => mv(x.san)).join(' ');
    const last = L[mateAt];
    return { tags: ['lookahead', 'lookahead-mate'], idea: 'Prépare la suite.', say: [`Prépare la suite : par exemple ${seq}, et c’est mat.`],
      viz: { arrows: [{ from: name(last.m.from), to: name(last.m.to), cls: 'plan' }] } };
  }
  // 2. Matériel gagné dans la variante (hors finales de mat)
  if (!X.mating(c) && L.length >= 3 && c.pv.length >= 3) {
    const g = lineGain(c.bn, c.pv, c.us);
    if (g != null && g >= 2 && g < 99) {
      const seq = L.slice(1, Math.min(L.length, 5)).map(x => mv(x.san)).join(' ');
      return { tags: ['lookahead', 'lookahead-gain'], idea: 'Prépare la suite.', say: [`Prépare la suite : par exemple ${seq}, et tu gagnes du matériel.`], viz: {} };
    }
    return null;
  }
  if (!X.mating(c)) return null;
  // 3. Finales de mat : la boîte après 3 demi-coups
  let r, rS, m2, mS, n3;
  if (L.length >= 3) { [r, m2] = [L[1].m, L[2].m]; rS = L[1].san; mS = L[2].san; n3 = L[2].n; }
  else {
    const p = c.get('tbLine', () => tbLine(c));
    if (!p) return null;
    r = p.r; m2 = p.m2; rS = c.an.san(r); mS = p.n2.san(m2); n3 = p.n3;
  }
  const viz = { arrows: [{ from: name(m2.from), to: name(m2.to), cls: 'plan' }] };
  if (n3.status === 'mate') return { tags: ['lookahead', 'lookahead-mate'], idea: 'Prépare la suite.',
    say: [`Prépare la suite : par exemple après ${mv(rS)}, ${mv(mS, true)} est mat.`], viz };
  if (n3.status || captures(n3).some(x => typeOf(x.cap) !== 'k')) return null;
  const a = X.boxB(c).size, b = boxAt(n3, c.def);
  if (b < a) return { tags: ['lookahead', 'lookahead-box'], data: { a, b }, idea: 'Prépare la suite.',
    say: [`Prépare la suite : par exemple après ${mv(rS)} ${mv(mS)}, la boîte ${du(c.def)} passe de ${a} à ${cases(b)}${n3.check ? ' au plus' : ''}.`],
    viz: { ...viz, ...boxViz(c, false) } };
  const e0 = edge(X.Kd(c)), e1 = edge(n3.king(c.def));
  if (!n3.check && e1 < e0) return { tags: ['lookahead', 'lookahead-edge'], idea: 'Prépare la suite.',
    say: [`Prépare la suite : par exemple après ${mv(rS)} ${mv(mS)}, ${X.K(c)} est repoussé vers le bord.`], viz };
  return null;
} });

// =====================================================================================================
// Motifs tactiques (F23–F24). us = le camp qui joue le coup expliqué.
// =====================================================================================================
rule({ id: 'double-check', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate || ch.kind !== 'double') return null;
  return { tags: ['double-check'], idea: 'Deux de tes pièces peuvent donner échec à la fois.',
    say: [`Échec double : deux pièces donnent échec, ${X.K(c)} est obligé de bouger.`],
    viz: { arrows: ch.checkers.slice(0, 2).map(s => ({ from: name(s), to: name(c.an.king(c.def)), cls: 'good' })) } };
} });

const target = (s, t, def) => (t === 'k' ? `le roi en ${name(s)}` : `${theirs(t, def)} en ${name(s)}`);
rule({ id: 'fork', run(c) {
  if (c.an.status) return null;
  const ts = forkTargets(c.an, c.m.to, c.us).sort((a, b) => (b.t === 'k') - (a.t === 'k') || VALUE[b.t] - VALUE[a.t] || a.sq - b.sq);
  if (ts.length < 2) return null;
  const g = X.gain(c), safeHere = see(c.an.pos, c.m.to) === 0;
  if (!safeHere && !(g >= 2)) return null;
  const say = [`Fourchette : ${mv(c.san)} attaque à la fois ${target(ts[0].sq, ts[0].t, c.def)} et ${target(ts[1].sq, ts[1].t, c.def)}.`];
  if (g >= 99) say.push('La suite mène au mat.');
  else if (g >= 2) say.push('Tu gagnes du matériel.');
  const t = X.t(c);
  const idea = t === 'n' ? 'Cherche une case d’où ton cavalier attaque deux pièces à la fois : avec échec, c’est encore plus fort.'
    : 'Une de tes pièces peut attaquer deux cibles à la fois.';
  const tg = ts.slice(0, 2).map(x => x.sq);
  return { idea, say, tags: g >= 2 ? ['fork', 'gain'] : ['fork'],
    viz: { arrows: tg.map(s => ({ from: name(c.m.to), to: name(s), cls: 'good' })), marks: marks(tg, 'mark-ko') },
    viz1: { marks: marks(tg, 'mark-ko') } };
} });

rule({ id: 'skewer', run(c) {
  if (c.an.status) return null;
  const sk = skewers(c.an.g, c.m.to, c.us).sort((a, b) => (typeOf(c.an.g[b.front]) === 'k') - (typeOf(c.an.g[a.front]) === 'k'));
  if (!sk.length) return null;
  const s = sk[0], ft = typeOf(c.an.g[s.front]), bt = typeOf(c.an.g[s.behind]), t = X.t(c);
  if (see(c.an.pos, c.m.to) > 0) return null;
  const g = X.gain(c), K = X.K(c), B = theirs(bt, c.def);
  let say;
  if (ft === 'k') {
    const flee = c.an.legal.every(r => typeOf(r.p) === 'k');
    say = g >= 2 && flee ? `Enfilade : échec sur la ligne, ${K} doit s’écarter et ${B}, derrière lui, tombe.`
      : g >= 2 ? `Enfilade : ${mine(t)} fait échec à ${K}, et ${B}, derrière lui, sera ${agree('pris', bt)}.`
      : `Enfilade : ${mine(t)} fait échec, et ${B} est derrière ${K} sur la même ligne.`;
  } else {
    const A = theirs(ft, c.def), pr = ft === 'q' || ft === 'r' ? 'elle' : 'lui';
    say = g >= 2 ? `Enfilade : ${mine(t)} attaque ${A} ; si ${subj(ft)} s’écarte, ${B}, derrière ${pr}, tombe.`
      : `Enfilade : ${mine(t)} attaque ${A}, et ${B} est derrière ${pr} sur la même ligne.`;
  }
  return { idea: ft === 'k' ? 'Le roi adverse et une pièce derrière lui sont alignés.' : 'Deux pièces adverses sont alignées.', say: [say],
    tags: g >= 2 ? ['skewer', 'gain'] : ['skewer'],
    viz: { arrows: [{ from: name(c.m.to), to: name(s.behind), cls: 'good' }], marks: marks([s.front, s.behind], 'mark-ko') },
    viz1: { marks: marks([s.front, s.behind], 'mark-ko') } };
} });

// Une pièce clouée (absolument) par une ligne de direction d peut-elle glisser le long de cette ligne ?
const slidesAlong = (t, d) => t === 'q' || (t === 'r' && d < 4) || (t === 'b' && d >= 4);
rule({ id: 'pin', run(c) {
  if (c.an.status) return null;
  const after = pins(c.an.g, c.us), PA = pieceAttacks(c.an.g, c.m.to), mt = X.t(c);
  // (b) le coup attaque une pièce clouée sur son roi, avec moins cher qu'elle, ou sans défenseur
  const ex = after.find(p => p.abs && PA[p.sq] && p.by !== c.m.to && typeOf(c.an.g[p.sq]) !== 'k'
    && (VALUE[mt] < VALUE[typeOf(c.an.g[p.sq])] || !attacked(c.an.g, p.sq, c.def)));
  if (ex) {
    const t = typeOf(c.an.g[ex.sq]), g = X.gain(c);
    const stuck = !slidesAlong(t, ex.d) && t !== 'p';
    const say = [`Clouage : ${theirs(t, c.def)} ne peut pas ${stuck ? 'bouger' : 'quitter la ligne'} (son roi serait en échec) ; ${mv(c.san)} ${pron(t, 'attaque')}.`];
    if (g >= 2) say.push(g >= 99 ? 'La suite mène au mat.' : 'Tu gagnes du matériel.');
    return { idea: 'Une pièce clouée ne peut pas fuir : attaque-la avec moins cher qu’elle.', say, tags: g >= 2 ? ['pin', 'gain'] : ['pin'],
      viz: { marks: marks([ex.sq], 'mark-ko'), arrows: [{ from: name(ex.by), to: name(ex.behind), cls: 'good' }] },
      viz1: { marks: marks([ex.sq], 'mark-ko') } };
  }
  // (a) le coup crée un clouage
  const before = pins(c.bn.g, c.us);
  const nw = after.find(p => p.by === c.m.to && !before.some(q => q.sq === p.sq && q.behind === p.behind));
  if (!nw || see(c.an.pos, c.m.to) > 0) return null;
  const t = typeOf(c.an.g[nw.sq]), tb = typeOf(c.an.g[nw.behind]);
  const stuck = !slidesAlong(t, nw.d) && t !== 'p';
  const say = nw.abs ? `Clouage : ${theirs(t, c.def)} ne peut plus ${stuck ? 'bouger' : 'quitter la ligne'}, sinon son roi serait en échec.`
    : `Clouage : ${theirs(t, c.def)} est ${agree('cloué', t)} devant ${theirs(tb, c.def)}.`;
  return { idea: 'Une pièce adverse est sur la même ligne que son roi ou qu’une pièce plus chère.', say: [say], tags: ['pin'],
    viz: { marks: marks([nw.sq], 'mark-ko'), arrows: [{ from: name(nw.by), to: name(nw.behind), cls: 'good' }] } };
} });

rule({ id: 'hanging-take', aliases: ['see-gain'], run(c) {
  const m = c.m;
  if (!m.cap) return null;
  const t = typeOf(m.cap), recap = c.an.legal.some(r => r.to === m.to && r.cap);
  const g = X.gain(c);
  if (g == null || g < Math.min(2, VALUE[t])) return null;
  if (!recap) {
    const said = attacked(c.bn.g, m.to, c.def)
      ? `Son défenseur ne peut pas reprendre : tu prends ${theirs(t, c.def)} gratuitement.`
      : `${cap(theirs(t, c.def))} n’était pas ${agree('protégé', t)} : tu ${pron(t, 'prends')} gratuitement.`;
    return { tags: ['hanging-take'], idea: 'Une pièce adverse n’a aucun défenseur.', say: [said],
      viz: { marks: marks([m.to], 'mark-ko') } };
  }
  if (seeMove(c.bn.pos, m) >= 2 && g >= 2) return { tags: ['see-gain'], idea: 'Un échange te rapporte du matériel.',
    say: [`Tu prends ${theirs(t, c.def)} : même après la reprise, tu gagnes du matériel.`], viz: { marks: marks([m.to], 'mark-ko') } };
  return null;
} });

rule({ id: 'mate-threat', run(c) {
  if (c.an.check || c.an.status) return null;
  const nl = c.an.nul;
  if (!nl) return null;
  const mt = hasMateIn1(nl.pos);
  if (!mt) return null;
  return { tags: ['mate-threat'], idea: 'Prépare une menace de mat.', say: [`Ce coup menace ${mv(nl.san(mt), true)} mat.`],
    viz: { arrows: [{ from: name(mt.from), to: name(mt.to), cls: 'plan' }] } };
} });

// Comment le coup pare la menace T : { how (« tu … »), what (« … » après le coup, 3e personne), tag }.
function parryHow(c, T) {
  const m = c.m, Ku0 = c.bn.king(c.us), Ku = c.an.king(c.us), t = X.t(c);
  if (m.cap && m.to === T.from) return { how: 'tu prends la pièce qui menaçait', what: 'prend la pièce qui menaçait', tag: 'capture-attacker' };
  if (t === 'p' && KING_N[Ku0].includes(m.from) && !c.an.g[m.from] && !attacked(c.an.g, m.from, c.def))
    return { how: `tu donnes de l’air à ton roi (case ${name(m.from)})`, what: 'donne de l’air à ton roi', tag: 'luft' };
  if (t === 'k') return { how: 'ton roi se met à l’abri', what: 'met ton roi à l’abri', tag: 'king-move' };
  if (between(T.from, T.to).includes(m.to) || between(T.from, Ku).includes(m.to)) return { how: 'tu bloques la ligne', what: 'bloque la ligne', tag: 'block' };
  if (pieceAttacks(c.an.g, m.to)[T.to]) {
    const back = c.us === 'w' ? 0 : 7;
    return R(T.to) === back ? { how: 'tu protèges ta première rangée', what: 'protège ta première rangée', tag: 'guard' }
      : { how: `tu protèges la case ${name(T.to)}`, what: `protège la case ${name(T.to)}`, tag: 'guard' };
  }
  return { how: 'ton coup pare la menace', what: 'pare la menace', tag: 'other' };
}
// Échecs « pour gagner un temps » puis parade, le long de la variante (≤ 5 demi-coups) : chaque coup intermédiaire est
// un échec, le dernier est calme, la menace existe encore juste avant lui et il ne laisse aucun mat en un coup.
function tempoParry(c) {
  if (c.pv.length < 3) return null;
  let n = c.an;
  const seq = [];
  for (let k = 1; k + 1 < Math.min(c.pv.length, 6); k += 2) {
    const r = n.move(c.pv[k]);
    if (!r) return null;
    seq.push(n.san(r));
    const n2 = n.child(r);
    const c2 = makeCtx({ fen: n2.fen, move: c.pv[k + 1] });
    if (!c2 || c2.an.status) return null;
    if (c2.an.check) { seq.push(c2.san); n = c2.an; continue; }
    const nb2 = c2.bn.nul, T2 = nb2 && matesIn1(nb2.pos)[0];
    if (!T2 || hasMateIn1(c2.an.pos)) return null;
    return { seq, last: c2.san, h: parryHow(c2, T2) };
  }
  return null;
}
rule({ id: 'parry-threat', aliases: ['luft'], run(c) {
  if (c.bn.check || c.an.status) return null;
  const nb = c.bn.nul;
  if (!nb) return null;
  const threats = c.get('mThr', () => matesIn1(nb.pos));
  const them = cap(side(c.def));
  if (threats.length) {
    const T = threats[0], arrow = { arrows: [{ from: name(T.from), to: name(T.to), cls: 'threat' }] };
    // Un échec ne pare rien : il retarde la menace. Seule une suite vérifiée (échecs puis vraie parade) est expliquée.
    if (c.an.check) {
      const tp = tempoParry(c);
      if (!tp) return null;
      return { tags: ['parry-threat', 'parry-mate', 'tempo', tp.h.tag], idea: 'Que menace son dernier coup ?',
        say: [`${them} menaçaient ${mv(nb.san(T), true)} mat : ton échec gagne un temps, et après ${tp.seq.map(x => mv(x)).join(' ')}, ${mv(tp.last)} ${tp.h.what}.`],
        viz: arrow };
    }
    if (hasMateIn1(c.an.pos)) return null;
    const h = parryHow(c, T);
    return { tags: ['parry-threat', 'parry-mate', h.tag], idea: 'Que menace son dernier coup ?',
      say: [`${them} menaçaient ${mv(nb.san(T), true)} mat : ${h.how}.`], viz: arrow };
  }
  if (c.an.check) return null;
  const thr = captures(nb).filter(x => typeOf(x.cap) !== 'k' && seeMove(nb.pos, x) >= 2)
    .sort((a, b) => VALUE[typeOf(b.cap)] - VALUE[typeOf(a.cap)] || a.to - b.to);
  if (!thr.length) return null;
  if (captures(c.an).some(x => typeOf(x.cap) !== 'k' && seeMove(c.an.pos, x) >= 2)) return null;
  const T = thr[0], t = typeOf(T.cap), m = c.m;
  const how = m.from === T.to ? `${subj(t)} se met à l’abri` : m.cap && m.to === T.from ? 'tu prends la pièce qui attaquait'
    : pieceAttacks(c.an.g, m.to)[T.to] ? `tu ${pron(t, 'protèges')}` : between(T.from, T.to).includes(m.to) ? 'tu bloques la ligne' : 'ton coup pare la menace';
  return { tags: ['parry-threat', 'parry-material'], idea: 'Que menace son dernier coup ?',
    say: [`${them} menaçaient de prendre ${mine(t)} en ${name(T.to)} : ${how}.`],
    viz: { arrows: [{ from: name(T.from), to: name(T.to), cls: 'threat' }] } };
} });

// Ordre des motifs tactiques (spec §5.3) ; `first` remonte le motif propre à l'exercice juste après le mat.
export const TACTICS = ['mate', 'mate-every-reply', 'double-check', 'fork', 'skewer', 'pin', 'hanging-take', 'mate-threat',
  'parry-threat', 'lookahead', 'check', 'capture'];
export const tacticOrder = (...first) => [...TACTICS.slice(0, 2), ...first, ...TACTICS.slice(2).filter(id => !first.includes(id))];

// ---------- Faits génériques (toujours vrais, peu instructifs) ----------
rule({ id: 'check', run(c) {
  const ch = X.check(c);
  if (!ch || ch.mate) return null;
  const n = c.an.legal.length, ko = c.an.kingOnly;
  const subjN = ko ? X.K(c) : side(c.def), verb = ko ? 'n’a' : 'n’ont';
  const rest = n === 1 ? `${verb} qu’une réponse` : n <= 3 ? `${verb} que ${n} réponses` : `${ko ? 'doit' : 'doivent'} d’abord y répondre`;
  return { tags: ['check'], idea: 'Un échec peut aider.', say: [`${mv(c.san)} donne échec : ${subjN} ${rest}.`],
    viz: { marks: marks([c.an.king(c.def)], 'mark-ko') } };
} });
rule({ id: 'capture', run(c) {
  if (!c.m.cap) return null;
  return { tags: ['capture'], idea: 'Regarde ce que tu peux prendre.', say: [`Tu prends ${theirs(typeOf(c.m.cap), c.def)} en ${name(c.m.to)}.`] };
} });

// ---------- Avertissements (second emplacement) ----------
rule({ id: 'stalemate-danger', warn: true, run(c) {
  const d = stalemateDanger(c.an, c.def);
  if (!d) return null;
  const sqs = d.sqs.map(name);
  return { tags: ['stalemate-danger'], idea: 'Attention au pat !', short: 'Attention au pat !',
    say: [`Attention au pat : ${X.K(c)} n’a ${plusQue(d.n)} (${sqs.join(', ')}).`], viz: { marks: marks(sqs, 'mark-escape') } };
} });
rule({ id: 'underpromo', warn: true, run(c) {
  const m = c.m;
  if (!m.promo || m.promo === 'q') return null;
  const n2 = c.bn.child({ ...m, promo: 'q' });
  if (n2.status !== 'stalemate') return null;
  return { tags: ['underpromo'], idea: 'Attention : une dame ferait pat.', short: 'Une dame ferait pat.',
    say: [`Promotion en ${pname(m.promo)} : une dame ferait pat.`] };
} });

// =====================================================================================================
// Composition
// =====================================================================================================
const asRule = r => (typeof r === 'string' ? RULES[r] : r);
const matchesIdea = (r, ideas) => ideas.includes(r.id) || (r.aliases || []).some(a => ideas.includes(a));
export const stats = { errors: 0, last: null };
export function safeRun(fn, ...args) {
  try { return fn(...args); } catch (e) { stats.errors++; stats.last = e; return null; }
}
// Priorité : faits « fixed » (résultat, sécurité), puis les idées de l'exercice, puis l'ordre de la famille.
export function ranked(c, fam) {
  return (fam.rules || []).map(asRule).filter(Boolean)
    .map((r, i) => ({ r, i, prio: (r.fixed ? 3000 : 0) + (!r.fixed && matchesIdea(r, c.ideas) ? 2000 : 0) + 1000 - 10 * i }))
    .sort((a, b) => b.prio - a.prio || a.i - b.i);
}
// Évalue paresseusement : le premier fait vrai prend la place principale, puis le premier avertissement.
export function evaluate(c, fam) {
  let primary = null, prio = 0;
  for (const { r, prio: p } of ranked(c, fam)) {
    const f = safeRun(x => r.run(x), c);
    if (f) { primary = { id: r.id, ...f }; prio = p; break; }
  }
  let warning = null;
  for (const w of (fam.warnings || []).map(asRule).filter(Boolean)) {
    if (primary && (primary.excludes || []).includes(w.id)) continue;
    const f = safeRun(x => w.run(x), c);
    if (f) { warning = { id: w.id, ...f }; break; }
  }
  return { primary, warning, prio };
}
// Texte final : phrase principale, puis l'avertissement (forme longue, sinon courte) ou la seconde phrase du fait.
export const MAX = 180;
export function sentences(primary, warning, max = MAX) {
  const s = [primary.say[0]];
  const cands = warning ? [warning.say[0], warning.short] : [primary.say[1]];
  for (const x of cands) if (x && visible(s[0] + ' ' + x) <= max) { s.push(x); break; }
  return s.map(finish).filter(Boolean);
}
// Fusion des visuels : 1 zone, ≤ 2 flèches, ≤ 6 marques.
export function mergeViz(...vs) {
  const out = {};
  for (const v of vs) {
    if (!v) continue;
    if (v.zone && v.zone.length && !out.zone) { out.zone = v.zone; if (v.zoneCls) out.zoneCls = v.zoneCls; }
    if (v.marks) out.marks = { ...(out.marks || {}), ...v.marks };
    if (v.arrows) out.arrows = [...(out.arrows || []), ...v.arrows];
  }
  if (out.marks) out.marks = Object.fromEntries(Object.entries(out.marks).slice(0, 6));
  if (out.arrows) out.arrows = out.arrows.slice(0, 2);
  return out;
}
export { finish, visible, idx, dirOf, inCheck, legalMoves, play, box };
