// « Pourquoi mon coup était mauvais ? » (spec §5.5) : gravité, puis raisons.
// Une raison ne signale que ce qui distingue le coup de l'utilisateur U du meilleur coup B : « ton coup agrandit la boîte »
// n'est jamais dit si B l'agrandit aussi. Chaque raison est calculée sur l'échiquier ; sinon, phrase générique honnête.
//
//   reason({ id, run(u, b, sev) → { say, tags?, viz?, noBetter? } | null })
//   u, b : contextes (rules.makeCtx) de U et de B (b peut être null) ; sev : gravité (severityOf).
import { reason, X, boxViz, marks } from './rules.js';
import {
  name, typeOf, cheb, VALUE, attacked, captures, stalemateDanger, hasMateIn1, matesIn1, see, seeMove,
  forkTargets, worstBoxAfter, realCut, cage, F, R,
} from './features.js';
import { cap, mine, theirs, king, side, who, pron, du, agree, cases, coups, plusQue, line, mv, evalText } from './fr.js';

// =====================================================================================================
// Gravité
// =====================================================================================================
const mateIn = v => (v != null && v >= 9000 ? Math.round((10000 - v) / 10) : null);
// Classe d'une valeur (point de vue de l'utilisateur, centipions) — seuils du §2.2.
const cls = v => (v >= 300 ? 'win' : v <= -300 ? 'loss' : v >= -100 && v <= 100 ? 'draw' : v > 0 ? 'edge+' : 'edge-');

// Tables exactes : classe et distance de chaque coup (rankMoves). null si la position n'est pas dans les tables.
function tbSeverity(tb, fen, um, bm) {
  let p = null;
  try { p = tb && tb.probe ? tb.probe(fen) : null; } catch { p = null; }
  if (!p) return null;
  const ranked = tb.rankMoves(fen);
  const find = u => u && (ranked.find(x => x.uci === u) || ranked.find(x => x.uci.slice(0, 4) === u.slice(0, 4) && (x.promo || '') === (u[4] || (x.promo ? 'q' : ''))));
  const U = find(um), B = find(bm) || ranked[0];
  if (!U || !B) return null;
  const turn = String(fen).trim().split(/\s+/)[1] === 'b' ? 'b' : 'w', strong = p.strong === turn;
  const kind = p.mate ? 'mate' : 'promo';
  if (strong) {
    if (B.win && !U.win) return { id: 'win-draw', exact: true, kind };
    if (!B.win || U.dist <= B.dist) return { id: 'same', exact: true, kind };
    return { id: 'slow', exact: true, kind, mu: U.dist + 1, mb: B.dist + 1 };
  }
  if (!B.win && U.win) return { id: 'draw-loss', exact: true, kind };
  if (B.win && U.win && U.dist < B.dist) return { id: 'worse', exact: true, kind };
  return { id: 'same', exact: true, kind };
}
// Moteur : evalBest (avant, meilleur coup) et evalUser (après U), tous deux du point de vue de l'utilisateur.
function engineSeverity(eb, eu) {
  if (eb == null || eu == null || !Number.isFinite(eb) || !Number.isFinite(eu)) return { id: 'unknown' };
  const mb = mateIn(eb), mu = mateIn(eu);
  if (mb != null && mu != null) return mu + 1 <= mb ? { id: 'same' } : { id: 'slow', exact: false, kind: 'mate' };
  if (Math.abs(eb - eu) <= 15) return { id: 'same' };
  // Deux recherches distinctes (fond, verdict) diffèrent de quelques dizaines de centipions sans que le coup soit pire.
  if (mb == null && mu == null && eb - eu < 50) return { id: 'close' };
  const a = cls(eb), b = cls(eu);
  if (a === 'win') {
    if (b === 'win') return mb != null && mu == null ? { id: 'slow', exact: false, kind: 'mate' } : { id: eu < eb ? 'weaker' : 'same' };
    if (b === 'loss') return { id: 'win-loss' };
    if (b === 'draw' || b === 'edge-') return { id: 'win-draw' };
    return { id: 'worse' };
  }
  if (b === 'loss' && a !== 'loss') return { id: 'draw-loss' };
  return { id: eu < eb ? 'worse' : 'same' };
}
export function severityOf({ fen, userMove, bestMove, tb, evalBest, evalUser }) {
  if (bestMove && userMove && userMove.slice(0, 5) === bestMove.slice(0, 5)) return { id: 'same', exact: true };
  return tbSeverity(tb, fen, userMove, bestMove) || engineSeverity(evalBest, evalUser);
}

// Phrase générique (aucune raison calculée), selon la gravité.
export function genericSentence(sev, eb, eu) {
  const e = sev.exact ? '' : (() => { const a = evalText(eb), b = evalText(eu); return a && b ? ` (le moteur passe de ${a} à ${b})` : ''; })();
  switch (sev.id) {
    case 'win-draw': return sev.exact ? 'Ce coup laisse filer le gain : la position est maintenant nulle.' : `Ce coup laisse échapper le gain${e}.`;
    case 'win-loss': return `Ce coup retourne la situation : tu es maintenant perdant${e}.`;
    case 'draw-loss': return sev.exact ? 'Ce coup perd : la nulle n’est plus là.' : `Ce coup perd${e}.`;
    case 'worse': return `Ce coup est moins bon${e}.`;
    case 'weaker': return `Ton coup garde l’avantage, mais moins nettement${e}.`;
    case 'slow': return slowSentence(sev);
    default: return 'Le moteur préfère un autre coup.';
  }
}
export function slowSentence(sev) {
  if (sev.exact && sev.mu && sev.mb) return sev.kind === 'promo'
    ? `Ça gagne toujours, mais plus lentement : promotion en ${coups(sev.mu)} au lieu de ${sev.mb}.`
    : `Ça gagne toujours, mais plus lentement : mat en ${sev.mu} au lieu de ${sev.mb}.`;
  return 'Ça gagne toujours, mais plus lentement.';
}

// =====================================================================================================
// Raisons
// =====================================================================================================
// Meilleure prise rentable de l'adversaire après un coup (SEE légale ; le roi ne prend que l'indéfendu).
function lossOf(x) {
  let best = null;
  for (const m of captures(x.an)) {
    if (typeOf(m.cap) === 'k') continue;
    const v = seeMove(x.an.pos, m);
    if (v > 0 && (!best || v > best.v || (v === best.v && VALUE[typeOf(m.cap)] > VALUE[typeOf(best.m.cap)]))) best = { m, v };
  }
  return best;
}
const lossOfMemo = x => x.get('loss', () => lossOf(x));

reason({ id: 'stalemate', run(u, b) {
  if (u.an.status !== 'stalemate' || (b && b.an.status === 'stalemate')) return null;
  const K = king(u.def);
  const say = X.bare(u) ? `Pat ! ${cap(K)} n’est pas en échec mais n’a plus aucun coup légal : la partie est nulle.`
    : `Pat ! ${cap(side(u.def))} ne sont pas en échec mais n’ont plus aucun coup légal : la partie est nulle.`;
  return { say, viz: { marks: { [name(u.an.king(u.def))]: 'mark-ko' } } };
} });

reason({ id: 'missed-mate', run(u, b) {
  if (!b || b.an.status !== 'mate' || u.an.status === 'mate') return null;
  return { say: `Il y avait mat en un coup : ${mv(b.san)}.`, noBetter: true, viz: { marks: { [name(b.an.king(b.def))]: 'mark-ko' } } };
} });

reason({ id: 'allows-mate', run(u, b) {
  if (u.an.status) return null;
  const T = hasMateIn1(u.an.pos);
  if (!T || (b && !b.an.status && hasMateIn1(b.an.pos))) return null;
  const san = u.an.san(T), them = cap(side(u.def));
  const before = u.bn.nul ? matesIn1(u.bn.nul.pos).some(x => x.from === T.from && x.to === T.to) : false;
  const say = before ? `${them} menaçaient ${mv(san, true)} mat, et ton coup ne pare pas la menace.`
    : `Après ton coup, ${side(u.def)} ont un mat en un coup : ${mv(san)}.`;
  return { say, tags: before ? ['threat-ignored'] : [], viz: { arrows: [{ from: name(T.from), to: name(T.to), cls: 'threat' }] } };
} });

reason({ id: 'bad-capture', run(u, b) {
  if (!u.m.cap) return null;
  const s = seeMove(u.bn.pos, u.m);
  if (s >= 0) return null;
  if (b && b.m.cap && seeMove(b.bn.pos, b.m) < 0) return null;
  const t = typeOf(u.m.cap);
  return { say: `${cap(theirs(t, u.def))} était ${agree('protégé', t)} : après la reprise, tu perds du matériel.`,
    viz: { marks: { [name(u.m.to)]: 'mark-ko' } } };
} });

reason({ id: 'piece-lost', run(u, b) {
  const L = lossOfMemo(u);
  if (!L) return null;
  if (b) { const Lb = lossOfMemo(b); if (Lb && Lb.v >= L.v) return null; }
  const x = L.m, sq = x.to, t = typeOf(x.cap), A = who(typeOf(x.p), u.def), P = cap(mine(t));
  const tail = `${A} ${pron(t, 'prend')} en ${name(sq)}`;
  let say;
  const nb = u.bn.nul;
  const wasLoss = nb && captures(nb).some(y => y.to === sq && seeMove(nb.pos, y) > 0);
  if (sq === u.m.to) say = `${P} se met en prise : ${tail}.`;
  else if (wasLoss) say = `${P} reste en prise : ${tail}.`;
  else if (attacked(u.bn.g, sq, u.us) && !attacked(u.an.g, sq, u.us)) say = `${P} n’est plus ${agree('protégé', t)} : ${tail}.`;
  else say = `${P} est maintenant en prise : ${tail}.`;
  return { say, tags: ['piece-lost-' + t], viz: { marks: { [name(sq)]: 'mark-ko' }, arrows: [{ from: name(x.from), to: name(sq), cls: 'threat' }] } };
} });

// L'adversaire obtient une fourchette sur notre roi (pièce qui fourche à l'abri).
function forkFor(x) {
  for (const r of x.an.legal) {
    const n = x.an.child(r);
    if (!n.check) continue;
    const ts = forkTargets(n, r.to, x.def).filter(t => t.t !== 'k');
    if (ts.length && see(n.pos, r.to) === 0) return { r, n, t: ts.sort((a, c) => VALUE[c.t] - VALUE[a.t])[0] };
  }
  return null;
}
reason({ id: 'allows-fork', run(u, b) {
  if (u.an.status) return null;
  const f = forkFor(u);
  if (!f || (b && !b.an.status && forkFor(b))) return null;
  const Ku = f.n.king(u.us);
  return { say: `Ton coup permet une fourchette : ${mv(u.an.san(f.r))} attaquerait ton roi en ${name(Ku)} et ${mine(f.t.t)} en ${name(f.t.sq)}.`,
    viz: { arrows: [{ from: name(f.r.from), to: name(f.r.to), cls: 'threat' }], marks: { [name(f.t.sq)]: 'mark-ko' } } };
} });

const MOTIF = {
  fork: 'une fourchette', skewer: 'une enfilade', pin: 'un clouage', 'hanging-take': 'une pièce gratuite', 'see-gain': 'un échange gagnant',
  'double-check': 'un échec double', 'mate-every-reply': 'un mat en deux coups', 'mate-threat': 'une menace de mat',
};
// B réalise un motif (avec gain confirmé quand le motif annonce du matériel), U ne le réalise pas.
reason({ id: 'missed-motif', run(u, b, sev, env) {
  if (!b || !env) return null;
  const pb = env.primary(b), pu = env.primary(u);
  if (!pb) return null;
  let id = pb.id;
  const tags = pb.tags || [];
  if (id === 'lookahead' && tags.includes('lookahead-mate')) id = 'lookahead-mate';
  const name2 = id === 'lookahead-mate' ? 'un mat' : MOTIF[id];
  if (!name2) return null;
  if (['fork', 'skewer', 'pin'].includes(id) && !tags.includes('gain')) return null;
  if (pu && pu.id === pb.id) return null;
  return { say: `Tu laisses passer ${name2}.`, tags: ['missed-' + id] };
} });

// ---------- Finales de mat ----------
reason({ id: 'useless-check', run(u, b) {
  if (!X.mating(u)) return null;
  const ch = X.check(u);
  if (!ch || ch.mate || !ch.useless) return null;
  if (b) { const cb = X.check(b); if (cb && !cb.mate && cb.useless) return null; }
  const a = ch.boxBefore, w = ch.worstBox, r = mv(u.an.san(ch.worstReply));
  const K = king(u.def);
  const say = w === a ? `Ton échec ne repousse pas ${K} : après ${r}, sa boîte fait toujours ${cases(w)}.`
    : `Ton échec ne repousse pas ${K} : après ${r}, sa boîte passe de ${a} à ${cases(w)}.`;
  return { say };
} });

const boxAfter = x => (x.an.status === 'mate' ? 0 : x.an.check ? worstBoxAfter(x.an, x.def) ?? 0 : x.an.box(x.def).size);
reason({ id: 'box-grow', run(u, b) {
  if (!X.mating(u) || u.an.check || u.an.status) return null;
  const a = u.bn.box(u.def).size, z = u.an.box(u.def).size;
  if (!(z > a)) return null;
  if (b && boxAfter(b) > a) return null;
  return { say: `Ton coup agrandit la boîte ${du(u.def)} : de ${a} à ${cases(z)}.`, data: { a, b: z }, viz: boxViz(u) };
} });

reason({ id: 'cut-lost', run(u, b) {
  if (!X.mating(u) || u.an.status) return null;
  const before = u.bn.cuts(u.def).filter(x => realCut(u.bn.g, u.def, x));
  if (!before.length) return null;
  const keeps = (x, c0) => x.an.cuts(x.def).some(y => y.kind === c0.kind && y.idx === c0.idx);
  const lost = before.find(c0 => !keeps(u, c0) && (!b || keeps(b, c0)));
  if (!lost) return null;
  const t = typeOf(u.bn.g[lost.sq]), co = lost.kind === 'file' ? F : R;
  const cg = cage(u.an.g, u.def);
  const across = [...cg.zone].some(z => Math.sign(co(z) - lost.idx) !== lost.side);
  return { say: `${cap(mine(t))} ne coupe plus ${king(u.def)} sur ${line(lost.kind, lost.idx)}${across ? ' : il peut maintenant la franchir' : ''}.` };
} });

reason({ id: 'stalemate-risk', run(u, b) {
  const d = stalemateDanger(u.an, u.def);
  if (!d || (b && stalemateDanger(b.an, b.def))) return null;
  const sqs = d.sqs.map(name);
  return { say: `${cap(king(u.def))} n’a ${plusQue(d.n)} (${sqs.join(', ')}) : attention au pat.`, viz: { marks: marks(sqs, 'mark-escape') } };
} });

reason({ id: 'king-away', run(u, b) {
  if (!X.mating(u) || typeOf(u.m.p) !== 'k') return null;
  const K = u.bn.king(u.def), d0 = cheb(u.m.from, K), d1 = cheb(u.m.to, K);
  if (!(d1 > d0)) return null;
  if (b && typeOf(b.m.p) === 'k' && cheb(b.m.to, K) > cheb(b.m.from, K)) return null;
  return { say: `Ton roi s’éloigne ${du(u.def)} (distance ${d0} → ${d1}) alors qu’il doit aider au mat.` };
} });

export { lossOf };
