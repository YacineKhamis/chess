// Déroulé d'une tentative, sans DOM (utilisé par l'interface et par les tests Node) — spec §1.6 et §2.3.
import { Chess } from '../../vendor/chess.js';
import { uci as toMove, frSan, yourPiece, hisPiece } from '../util.js';
import { balance, other, mirrorFiles, swapColors } from '../analysis.js';
import { GOALS, rules, moveCap, win, fail } from './goals.js';
import { thresholds, classify, lostText, mateIn } from './verdict.js';

// L'explicateur est chargé à la demande (indice, « Pourquoi ? »), ou fourni par ctx.explain dans les tests.
let explainer = null;
const getExplainer = async ctx => ctx.explain || (explainer ||= await import('../explain/index.js'));

const now = () => Date.now();
const lan = m => m.from + m.to + (m.promotion || '');

export class Attempt {
  constructor(spec, start, ctx, { retry = false, fromErr = null } = {}) {
    this.spec = spec; this.start = start; this.ctx = ctx;
    this.goal = GOALS[spec.goal.kind];
    this.chess = new Chess(start.fen);
    this.userColor = this.chess.turn();
    this.level = start.level ?? 0;
    this.ref = start.ref; this.E0 = start.E0; this.Ealt = start.Ealt; this.k = start.k;
    this.M0 = balance(this.chess, this.userColor);
    this.userMoves = 0; this.hints = 0; this.hintMax = 0; this.greyMoves = 0;
    this.history = [];           // { fen (avant), uci, san, by, v?, cls?, dist?, mate? }
    this.lastV = start.E0 ?? null;
    this.retry = retry; this.fromErr = fromErr;
    this.t0 = now(); this.over = false; this.outcome = null; this.keyFen = null; this.late = false;
    this.bg = null; this.hintMove = null;
    this.T = thresholds(spec, this);
  }

  get fen() { return this.chess.fen(); }
  get userToMove() { return !this.over && this.chess.turn() === this.userColor; }
  goalText() { return this.goal.text(this.spec, this); }

  // Analyse de fond pendant que l'utilisateur réfléchit (sert à l'indice et à l'explication d'une erreur).
  think() {
    if (this.spec.oracle !== 'engine' || this.over) return;
    const fen = this.fen;
    if (this.bg && this.bg.fen === fen) return;
    this.bg = { fen, p: this.ctx.engine.analyse(fen, { movetime: 600, multipv: 3, tag: 'bg' }) };
  }

  async userMove(move) {
    if (!this.userToMove) return { status: 'ignored' };
    if (this.spec.oracle === 'engine') this.ctx.engine.stop('bg');
    const before = this.fen;
    let mv;
    try { mv = this.chess.move(typeof move === 'string' ? toMove(move) : move); } catch { return { status: 'illegal' }; }
    if (!mv) return { status: 'illegal' };
    this.userMoves++; this.hintMove = null;
    const entry = { fen: before, uci: lan(mv), san: mv.san, by: 'user' };
    this.history.push(entry);
    const events = [];

    // 1. Règles et objectif, sans moteur
    let o = rules(this, 'user') ?? this.goal.afterUser?.(this, mv) ?? this.spec.afterUser?.(this, mv);
    if (o) return this.end(o, { keyFen: o.status === 'fail' ? before : null });

    // 2. Verdict sur la position après le coup (l'adversaire est au trait)
    const j = await this.judge();
    if (this.over) return { status: 'ignored' };
    Object.assign(entry, { v: j.v, cls: j.cls, dist: j.dist, mate: j.mate });
    if (j.v != null) this.lastV = j.v;
    if (j.cls === 'grey') this.greyMoves++;
    if (j.cls === 'lost') return this.end(fail(this.lostReason(j), { tag: 'lost' }), { keyFen: before, refutation: j.pv, verdict: j });
    o = this.goal.afterVerdict?.(this, j, mv) ?? this.goal.afterAny?.(this);
    if (o) return this.end(o);

    // 3. Réponse adverse
    if (!j.reply) return this.end(fail('Le moteur n’a pas trouvé de coup.'));
    const beforeReply = this.fen;
    let r;
    try { r = this.chess.move(toMove(j.reply)); } catch { r = null; }
    if (!r) return this.end(fail('Coup adverse impossible : position inattendue.'));
    this.history.push({ fen: beforeReply, uci: lan(r), san: r.san, by: 'opp' });
    events.push({ type: 'reply', uci: lan(r), san: r.san, text: `${this.userColor === 'w' ? 'Les Noirs' : 'Les Blancs'} jouent ${frSan(r.san)}.` });
    o = rules(this, 'opp') ?? this.goal.afterOpponent?.(this, r, j) ?? this.spec.afterOpponent?.(this, r) ?? this.goal.afterAny?.(this);
    if (o) return this.end(o, { reply: r, events });
    const capN = moveCap(this.spec, this);
    if (capN && this.userMoves >= capN) return this.end(fail(`Trop long : ${capN} coups sans atteindre l’objectif.`), { reply: r, events });
    return { status: 'continue', reply: r, events };
  }

  // Verdict : tables exactes, ou recherche moteur (qui fournit aussi la réponse adverse).
  async judge() {
    const fen = this.fen, ctx = this.ctx;
    if (this.spec.oracle === 'tb') {
      const p = ctx.tb.probe(fen);
      if (!p) return { cls: 'ok', v: null, reply: null };
      const userStrong = p.strong === this.userColor;
      const ok = userStrong ? p.win : !p.win;
      const reply = userStrong ? ctx.tb.stubborn(fen, ctx.rng) : ctx.tb.trap(fen, ctx.rng);
      return { cls: ok ? 'ok' : 'lost', v: null, dist: p.win ? p.dist : null, reply, pv: ok ? null : tbLine(ctx.tb, fen, 8, ctx.rng) };
    }
    let [l] = await ctx.engine.analyse(fen, { movetime: 300 });
    if (!l) [l] = await ctx.engine.analyse(fen, { depth: 1 });
    if (!l) return { cls: 'ok', v: null, reply: null };
    let v = -l.cp, line = l;
    if (v <= this.T.lost) {
      const [c] = await ctx.engine.analyse(fen, { movetime: this.T.confirmMs });
      if (c) { line = c; v = -c.cp; }
    }
    const mate = line.mate != null && line.mate < 0 ? -line.mate : null; // l'utilisateur mate en `mate` coups
    return { cls: classify(v, this.T), v, mate, reply: line.move, pv: line.pv };
  }

  // Texte d'échec : « ta dame est en prise » si la réfutation commence par prendre une pièce, sinon le texte du verdict.
  lostReason(j) {
    const first = (j.pv && j.pv[0]) || j.reply;
    if (first) {
      try {
        const m = new Chess(this.fen).move(toMove(first));
        if (m.captured && m.captured !== 'p') {
          const cap = s => s[0].toUpperCase() + s.slice(1);
          return `${cap(yourPiece(m.captured))} est en prise : ${hisPiece(m.piece)} la prend en ${m.to}.`;
        }
      } catch { /* coup illisible : texte générique */ }
    }
    return lostText(this.spec, this.spec.oracle);
  }

  end(outcome, extra = {}) {
    this.over = true;
    this.outcome = outcome;
    if (extra.keyFen) this.keyFen = extra.keyFen;
    if (outcome.status === 'success') {
      outcome.clean = !this.hints && outcome.quality !== 'other' && this.goal.clean(this);
      if (!outcome.clean && !this.hints) this.keyFen = this.worstMoment();
    }
    if (this.spec.oracle === 'engine') this.ctx.engine.stop('bg');
    return { status: 'end', outcome, ...extra };
  }

  // Moment clé d'une réussite trop lente : le coup qui a le plus allongé le chemin.
  worstMoment() {
    let worst = null, prev = this.spec.oracle === 'tb' ? this.ref : this.spec.goal.kind === 'mate' ? this.ref : this.E0, max = 0;
    for (const h of this.history.filter(x => x.by === 'user')) {
      let loss = 0;
      if (this.spec.oracle === 'tb' && h.dist != null && prev != null) { loss = h.dist - (prev - 1); prev = h.dist; }
      else if (h.mate != null && prev != null && this.spec.goal.kind === 'mate') { loss = h.mate - (prev - 1); prev = h.mate; }
      else if (h.v != null && prev != null && this.spec.goal.kind !== 'mate') { loss = (prev - h.v) / 100; prev = h.v; }
      if (loss > max) { max = loss; worst = h.fen; }
    }
    return max >= 2 ? worst : null;
  }

  // Coups jugés également bons dans la position actuelle (pour l'indice).
  async candidates(fen = this.fen, first = this.userMoves === 0) {
    const ctx = this.ctx;
    if (this.spec.oracle === 'tb') {
      const ranked = ctx.tb.rankMoves(fen), p = ctx.tb.probe(fen);
      if (!p) return { moves: [], lines: [] };
      const userStrong = p.strong === this.userColor;
      let good = ranked.filter(m => (userStrong ? m.win : !m.win));
      if (userStrong && good.length) { const d = Math.min(...good.map(m => m.dist)); good = good.filter(m => m.dist === d); }
      return { moves: good.map(m => m.uci), lines: [], count: ranked.filter(m => (userStrong ? m.win : !m.win)).length };
    }
    if (first && (this.start.key || this.start.keySet)) {
      const ks = this.start.keySet || [this.start.key];
      return { moves: ks, lines: this.start.pv ? [{ move: ks[0], pv: this.start.pv }] : [] };
    }
    let lines = this.bg && this.bg.fen === fen ? await this.bg.p : [];
    if (!lines.length) lines = await ctx.engine.analyse(fen, { movetime: 600, multipv: 3 });
    if (!lines.length) return { moves: [], lines: [] };
    const b = lines[0];
    const good = lines.filter(l => (b.mate != null ? l.mate === b.mate : l.mate == null && b.cp - l.cp <= 15));
    return { moves: good.map(l => l.move), lines };
  }

  // Indice en trois marches : idée, pièce, coup.
  async hint() {
    if (!this.userToMove) return null;
    const { explainMove, pickTeachingMove } = await getExplainer(this.ctx);
    this.hints++;
    if (!this.hintMove || this.hintMove.fen !== this.fen) {
      const { moves, lines, count } = await this.candidates();
      if (!moves.length) return null;
      const move = moves.length > 1 ? pickTeachingMove({ fen: this.fen, family: this.spec.family, ideas: this.spec.ideas, candidates: moves }) : moves[0];
      const line = lines.find(l => l.move === move);
      this.hintMove = { fen: this.fen, move, pv: line ? line.pv : [move], count, step: 0 };
    }
    const h = this.hintMove;
    h.step = Math.min(3, h.step + 1);
    this.hintMax = Math.max(this.hintMax, h.step);
    const ex = explainMove({ fen: this.fen, move: h.move, family: this.spec.family, ideas: this.spec.ideas, pv: h.pv,
      lastMove: this.history.at(-1)?.uci ?? null, tb: this.ctx.tb, level: h.step === 3 ? 3 : 1 });
    return { step: h.step, move: h.move, count: h.count, ...ex };
  }

  // Explication de l'erreur qui a mis fin à la tentative (bouton « Pourquoi ? »).
  async why() {
    const fen = this.keyFen;
    if (!fen) return null;
    const { explainMistake, pickTeachingMove } = await getExplainer(this.ctx);
    const i = this.history.findIndex(h => h.by === 'user' && h.fen === fen);
    const h = this.history[i];
    const cand = await this.candidates(fen, i === 0);
    if (!cand.moves.length) return null;
    const best = cand.moves.length > 1 ? pickTeachingMove({ fen, family: this.spec.family, ideas: this.spec.ideas, candidates: cand.moves }) : cand.moves[0];
    const bestLine = cand.lines.find(l => l.move === best);
    return { fen, userMove: h?.uci, bestMove: best, ...explainMistake({ fen, userMove: h?.uci, bestMove: best, family: this.spec.family,
      evalBest: bestLine ? bestLine.cp : null, evalUser: h?.v ?? null, pvBest: bestLine?.pv ?? [best], pvUser: [], tb: this.ctx.tb }) };
  }

  // Résumé pour l'enregistrement de la progression (spec §4.1).
  summary({ abandoned = false } = {}) {
    return {
      id: this.spec.id, level: this.level, color: this.userColor, sub: this.start.sub ?? null,
      reached: this.outcome?.status === 'success', clean: !!this.outcome?.clean,
      moves: this.userMoves, ref: this.ref, hints: this.hints, hintMax: this.hintMax,
      secs: (now() - this.t0) / 1000, retry: this.retry, abandoned: abandoned && !this.over,
      keyFen: this.keyFen ? canonical(this.keyFen, this.start) : null, fromErr: this.fromErr,
    };
  }
}

// Variante exacte (tables) depuis une position, pour montrer la réfutation.
function tbLine(tb, fen, n, rng) {
  const c = new Chess(fen), out = [];
  for (let i = 0; i < n && !c.isGameOver(); i++) {
    const p = tb.probe(c.fen());
    if (!p) break;
    const mv = c.turn() === p.strong ? tb.trap(c.fen(), rng) : tb.stubborn(c.fen(), rng);
    if (!mv) break;
    c.move(toMove(mv)); out.push(mv);
  }
  return out;
}

// Ramène une position jouée (miroir, couleurs) à la forme canonique de l'exercice.
export function canonical(fen, start) {
  let f = fen;
  if (start.flip) f = swapColors(f);
  if (start.mirror) f = mirrorFiles(f);
  return f;
}
export { other, win, fail, mateIn };
