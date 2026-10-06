// Écran d'entraînement générique : joue n'importe quel exercice du catalogue (#/drill/<id>).
import { Board } from '../board.js';
import { getEngine } from '../engine.js';
import { loadTB } from '../tb/probe.js';
import { Chess } from '../../vendor/chess.js';
import { load, save, logActivity, h, $, setText, fr, frSan, uci as toMove, yourPiece } from '../util.js';
import { kingZone, other } from '../analysis.js';
import { DRILLS, TRACKS, REGISTRY } from '../drills/index.js';
import { produce, replay } from '../drill/produce.js';
import { Attempt } from '../drill/attempt.js';
import { slackMate, slackPromo } from '../drill/goals.js';
import * as P from '../progress.js';

// Contexte partagé : moteur, tables exactes, hasard.
let ctxP = null;
export const drillContext = () => (ctxP ||= loadTB().then(tb => ({ engine: getEngine(), tb, rng: Math.random })));

const CAGE_FAMILIES = ['kqk', 'krk', 'krrk'];
const cap = s => s[0].toUpperCase() + s.slice(1);
const plural = (n, w, ws = w + 's') => `${n} ${n > 1 ? ws : w}`;
const KNOWN = ['acq', 'mast', 'rusty'];

export function mount(root, id, { tabs = null, onDone = null, mystery = false, replayItem = null } = {}) {
  const spec = DRILLS[id];
  if (!spec) {
    root.replaceChildren(h(`<section class="home"><p>Cet exercice n’existe pas (encore).</p><p><a href="#/parcours">Retour au parcours</a></p></section>`));
    return null;
  }
  const store = load();
  const track = TRACKS.find(t => t.id === spec.track);
  let ctx = null, attempt = null, start = null, busy = false, alive = true, nextP = null, cage = false, lastSetup = null;

  const view = h(`
    <section class="trainer drill">
      <div class="board-wrap"><div class="board-el"></div></div>
      <div class="panel">
        ${mystery ? '' : `<nav class="crumbs">${tabs ? '<a href="#/">Sommaire</a>' : `<a href="#/parcours">Parcours</a> › ${track ? track.title : ''}`}</nav>`}
        ${tabs ? `<div class="segmented" role="tablist">${tabs.map(t => `<button role="tab" data-tab="${t}" aria-selected="${t === id}">${DRILLS[t].short}</button>`).join('')}</div>` : ''}
        <h2>${mystery ? 'Mélange : reconnais la situation' : spec.title}</h2>
        <p class="levelrow"${mystery ? ' hidden' : ''}><span class="lvl"></span> <span class="streak"></span> <span class="state"></span></p>
        <p class="gate" hidden></p>
        <p class="tip"${mystery ? ' hidden' : ''}>${spec.tip}</p>
        <div class="verdict" data-state="wait">Préparation…</div>
        <p class="meta"></p>
        <div class="explain"></div>
        <div class="actions">
          <button class="btn ghost" data-act="hint">Indice (1/3)</button>
          <button class="btn" data-act="retry">Recommencer</button>
          <button class="btn" data-act="new">Nouvelle position</button>
          <button class="btn primary" data-act="next" hidden>Position suivante</button>
          <button class="btn" data-act="why" hidden>Pourquoi ?</button>
          <button class="btn" data-act="resume" hidden>Reprendre avant l’erreur</button>
          <button class="btn" data-act="same" hidden>Position équivalente</button>
          <button class="btn" data-act="key" hidden>Rejouer le moment clé</button>
          <a class="btn primary" data-act="go" hidden></a>
        </div>
        ${CAGE_FAMILIES.includes(spec.family) ? '<label class="toggle"><input type="checkbox" data-act="cage"> Voir la cage du roi adverse</label>' : ''}
        <p class="stats"></p>
      </div>
    </section>`);
  root.replaceChildren(view);
  const board = new Board($('.board-el', view), { onMove, onPromote: true });
  const verdict = $('.verdict', view), meta = $('.meta', view), explain = $('.explain', view);
  const btn = a => $(`[data-act="${a}"]`, view);
  const setVerdict = (state, text) => { verdict.dataset.state = state; setText(verdict, text); };
  const show = (list) => ['hint', 'retry', 'new', 'next', 'why', 'resume', 'same', 'key', 'go'].forEach(a => { btn(a).hidden = !list.includes(a); });
  const setExplain = lines => { explain.innerHTML = (lines || []).map(l => `<p>${fr(l).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`).join(''); };

  // ---------- Affichage de l'état ----------
  function rec() { return store.drills?.[spec.id]; }
  function renderHeader(level) {
    const r = rec(), top = spec.levels.length - 1;
    const L = spec.levels[level] || {};
    setText($('.lvl', view), spec.levels.length > 1 ? `Palier ${level + 1}/${top + 1} · ${L.label}` : L.label || '');
    const need = r?.need ?? spec.need ?? 3;
    setText($('.streak', view), r ? `Série propre ${P.streakDots(r, need)}` : '');
    setText($('.state', view), r ? P.stateLabel(r.st) : 'Nouveau');
    const gate = $('.gate', view);
    const missing = (spec.prereq || []).filter(x => DRILLS[x] && !KNOWN.includes(store.drills?.[x]?.st));
    gate.hidden = mystery || !missing.length || (r && r.st !== 'new');
    if (!gate.hidden) setText(gate, `Conseillé d’abord : ${missing.map(x => DRILLS[x].title).join(', ')}. Tu peux essayer quand même.`);
  }
  function renderStats() {
    const r = rec();
    if (!r || !r.n) { setText($('.stats', view), 'Aucun essai pour l’instant.'); return; }
    let s = `${plural(r.n, 'essai')}, ${plural(r.ok, 'réussite')}, dont ${plural(r.clean, 'propre')}.`;
    if (KNOWN.includes(r.st) && r.due) s += ` Prochain contrôle : ${P.dueLabel(r.due, Date.now())}.`;
    setText($('.stats', view), s);
  }
  function renderMeta() {
    if (!attempt) { setText(meta, ''); return; }
    const a = attempt, n = a.userMoves, ref = a.ref, g = spec.goal;
    let s = '';
    if (g.kind === 'mate' && g.n) s = `Mat en ${g.n} · coup ${n}`;
    else if (g.kind === 'mate' && ref) s = `${spec.oracle === 'tb' ? `Mat en ${ref} au mieux` : `Mat possible en ${ref}`} · coup ${n} · limite propre ${ref + slackMate(ref)}`;
    else if (g.kind === 'promote' && ref) s = `Promotion sûre possible en ${plural(ref, 'coup')} · coup ${n} · limite propre ${ref + slackPromo(ref)}`;
    else if (g.kind === 'hold') s = `Coup ${n}/${g.n}`;
    else if (g.kind === 'material' && a.k) s = `Gain le plus rapide : ${plural(a.k, 'coup')} · coup ${n}`;
    else s = `Coup ${n}`;
    if (a.hints) s += ` · ${plural(a.hints, 'indice')}`;
    setText(meta, s);
  }
  function renderCage() {
    if (!cage || !attempt) { board.setZone(null); return; }
    const z = kingZone(attempt.chess, other(attempt.userColor));
    board.setZone(z instanceof Set ? z : new Set(z.zone || z), 'zone');
  }
  function hintLabel() {
    const step = attempt?.hintMove && attempt.hintMove.fen === attempt.fen ? attempt.hintMove.step : 0;
    setText(btn('hint'), step >= 3 ? 'Indice (3/3)' : `Indice (${step + 1}/3)`);
  }
  function syncBoard(last) {
    board.setPosition(attempt.fen);
    board.setLastMove(last ? last.from : null, last ? last.to : null);
    board.setViz(null);
    renderCage();
  }
  function yourTurn(prefix = '') {
    board.setDests(destsOf(attempt.chess));
    setVerdict('turn', `${prefix}${prefix ? ' ' : ''}À toi.`);
    renderMeta(); hintLabel();
    attempt.think();
  }

  // ---------- Positions ----------
  async function prepare(setup, { sub } = {}) {
    lastSetup = setup;
    const s = await produce(spec, setup.level, ctx, { colour: setup.colour, sub });
    return s;
  }
  async function begin(s, opts = {}) {
    if (!alive) return;
    if (!s) { setVerdict('ko', 'Pas de position trouvée cette fois-ci. Réessaie.'); show(['new']); return; }
    start = s;
    attempt = new Attempt(spec, s, ctx, opts);
    if (window.__debugDrill) window.__debugDrill(attempt); // crochet pour les tests de bout en bout
    busy = false;
    setExplain([]);
    board.setOrientation(attempt.userColor);
    syncBoard(null);
    renderHeader(s.level ?? 0); renderStats();
    show(['hint', 'retry', 'new']);
    board.setDests(destsOf(attempt.chess));
    setVerdict('turn', `${opts.retry ? 'On reprend. ' : ''}${opts.note ? opts.note + ' ' : ''}${attempt.goalText()} Tu as les ${attempt.userColor === 'w' ? 'Blancs' : 'Noirs'}.`);
    renderMeta(); hintLabel();
    attempt.think();
  }
  // Une de tes positions difficiles revient, avec une symétrie neuve (spec §1.5).
  async function prepareReplay(item) {
    const s = replay(spec, item, ctx.rng, P.setupFor(spec, rec()).colour);
    if (spec.oracle === 'tb') {
      const p = ctx.tb.probe(s.fen);
      if (!p) return null;
      s.ref = p.win ? p.dist : null;
    } else {
      await ctx.engine.newGame();
      const [l] = await ctx.engine.analyse(s.fen, { movetime: 800 });
      if (!l) return null;
      s.E0 = l.cp; s.ref = spec.goal.kind === 'mate' && l.mate > 0 ? l.mate : null;
    }
    s.fromErr = item.fen;
    return s;
  }
  async function fresh({ same = false } = {}) {
    abandon();
    setVerdict('wait', 'Préparation de la position…');
    show([]); board.setDests(null);
    let s;
    if (replayItem && !same) {
      s = await prepareReplay(replayItem);
      replayItem = null;
      if (s) return begin(s, { fromErr: s.fromErr, note: 'Ta position difficile revient… en miroir ou en couleurs inversées.' });
    }
    if (nextP && !same) { s = await nextP; nextP = null; }
    else s = await prepare(same && start ? { level: start.level, colour: start.userColor } : P.setupFor(spec, rec()), same && start ? { sub: start.sub } : {});
    await begin(s);
  }
  function abandon() {
    if (attempt && !attempt.over && attempt.userMoves > 0 && !attempt.retry) {
      P.record(store, spec, attempt.summary({ abandoned: true }), Date.now(), REGISTRY);
      save();
    }
  }
  // Reprend une position précise (avant l'erreur, moment clé) hors série.
  function replayFrom(fen) {
    const tbP = ctx.tb && ctx.tb.probe(fen);
    begin({ ...start, fen, ref: tbP && tbP.win ? tbP.dist : null, E0: attempt.lastV ?? start.E0, k: null, key: null, keySet: null }, { retry: true });
  }

  // ---------- Coups ----------
  async function onMove(from, to, promo) {
    if (!attempt || !attempt.userToMove || busy) return;
    const uci = from + to + (promo || '');
    let preview;
    try { preview = new Chess(attempt.fen).move(toMove(uci)); } catch { return; }
    busy = true;
    board.setDests(null); board.setViz(null);
    board.setPosition(preview.after); board.setLastMove(from, to);
    setExplain([]);
    setVerdict('wait', 'L’adversaire réfléchit…');
    const res = await attempt.userMove(uci);
    if (!alive) return;
    busy = false;
    if (res.status === 'illegal' || res.status === 'ignored') { syncBoard(null); board.setDests(destsOf(attempt.chess)); return; }
    syncBoard(res.reply || { from, to });
    if (res.status === 'end') return finish(res);
    yourTurn(res.events?.find(e => e.type === 'reply')?.text || '');
  }

  function finish(res) {
    board.setDests(null);
    const o = res.outcome, a = attempt;
    renderMeta();
    let code = null, before = rec() ? { ...rec() } : null;
    if (!a.retry) {
      code = P.record(store, spec, a.summary(), Date.now(), REGISTRY);
      save(); logActivity();
    }
    const after = rec();
    const lines = [o.reason];
    if (code) lines.push(P.resultText({ spec, code, attempt: a.summary(), before, after, store, reg: REGISTRY }));
    else if (a.retry) lines.push('Hors série : cette partie ne compte pas pour la progression.');
    setVerdict(o.status === 'success' ? 'ok' : 'ko', lines.filter(Boolean).join(' '));
    // Flèches de la réfutation quand le coup a tout gâché.
    if (o.status === 'fail' && res.refutation && res.refutation.length) {
      board.setArrows([{ from: res.refutation[0].slice(0, 2), to: res.refutation[0].slice(2, 4), cls: 'threat' }]);
    }
    const list = ['next'];
    if (o.status === 'fail') { if (a.keyFen) list.push('why', 'resume'); list.push('same'); }
    else if (a.keyFen && !o.clean) list.push('key', 'why');
    // Exercice tout juste acquis : proposer la suite du parcours.
    const ns = P.nextStep(store, REGISTRY, spec.id);
    if (!mystery && !onDone && ns.kind === 'next' && after && before?.st !== after.st && after.st === 'acq') {
      const go = btn('go');
      go.href = `#/drill/${ns.id}`;
      setText(go, ns.label);
      list.push('go');
    }
    show(list);
    if (mystery) { setText($('h2', view), `C’était : ${spec.title}`); $('.tip', view).hidden = false; $('.levelrow', view).hidden = false; }
    renderHeader(a.level); renderStats();
    if (onDone) onDone(code, a);
    // Prépare déjà la position suivante.
    nextP = prepare(P.setupFor(spec, rec()));
  }

  // ---------- Boutons ----------
  view.addEventListener('click', async e => {
    const tab = e.target.closest('[data-tab]');
    if (tab && tabs) { if (tab.dataset.tab !== spec.id) { sessionStorage.setItem('finales-tab', tab.dataset.tab); location.hash = `#/finales/${tab.dataset.tab}`; } return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || act === 'cage' || act === 'go') return;
    if (busy || !ctx) return;
    if (act === 'new' || act === 'next') return fresh();
    if (act === 'same') return fresh({ same: true });
    if (act === 'retry' && start) { abandon(); return begin(start, { retry: true }); }
    if (act === 'resume' && attempt?.keyFen) return replayFrom(attempt.keyFen);
    if (act === 'key' && attempt?.keyFen) return replayFrom(attempt.keyFen);
    if (act === 'hint' && attempt?.userToMove) {
      busy = true;
      const r = await attempt.hint();
      busy = false;
      if (!alive || !r) return;
      renderMeta(); hintLabel();
      const from = r.move.slice(0, 2), to = r.move.slice(2, 4);
      const piece = attempt.chess.get(from);
      if (r.step === 1) { setExplain([r.idea || r.text?.[0]]); board.setViz({ ...r.viz, arrows: [] }); }
      if (r.step === 2) { setExplain([r.idea, `Joue ${yourPiece(piece.type)}.`]); board.setViz({ ...r.viz, arrows: [], marks: { ...(r.viz?.marks || {}), [from]: 'mark-hint' } }); }
      if (r.step === 3) {
        // Le nombre de bons coups n'éclaire que lorsqu'il est petit (tables exactes) : « le seul coup », « 2 coups ».
        const good = spec.goal.kind === 'hold' ? 'tient' : 'gagne';
        const extra = r.count === 1 ? [`C’est le seul coup qui ${good}.`] : r.count && r.count <= 3 ? [`${r.count} coups ${good === 'tient' ? 'tiennent' : 'gagnent'} ici.`] : [];
        setExplain([...(r.text || []), ...(spec.oracle === 'tb' ? extra : [])]);
        board.setViz({ ...r.viz, arrows: [...(r.viz?.arrows || []), { from, to, cls: 'hint' }] });
      }
      return;
    }
    if (act === 'why' && attempt) {
      busy = true;
      setExplain(['Analyse de l’erreur…']);
      const w = await attempt.why();
      busy = false;
      if (!alive) return;
      if (!w) { setExplain(['Pas d’explication disponible pour ce coup.']); return; }
      board.setPosition(w.fen); board.setLastMove(null);
      const arrows = [];
      if (w.userMove) arrows.push({ from: w.userMove.slice(0, 2), to: w.userMove.slice(2, 4), cls: 'threat' });
      if (w.bestMove) arrows.push({ from: w.bestMove.slice(0, 2), to: w.bestMove.slice(2, 4), cls: 'good' });
      board.setViz({ ...(w.viz || {}), arrows: [...arrows, ...((w.viz && w.viz.arrows) || [])] });
      setExplain([...(w.text || []), 'En rouge : ton coup. En vert : le meilleur.']);
    }
  });
  view.addEventListener('change', e => {
    if (e.target.matches('[data-act="cage"]')) { cage = e.target.checked; renderCage(); }
  });

  // ---------- Démarrage ----------
  setVerdict('wait', 'Chargement du moteur et des tables…');
  renderHeader(P.setupFor(spec, rec()).level); renderStats();
  drillContext().then(c => { if (!alive) return; ctx = c; fresh(); })
    .catch(() => setVerdict('ko', 'Impossible de charger le moteur ou les tables (data/tb). Recharge la page.'));

  function cleanup() {
    if (!alive) return;
    alive = false;
    abandon();
    if (ctx && ctx.engine) ctx.engine.stop('bg');
  }
  return cleanup;
}

// Destinations légales pour l'échiquier.
function destsOf(chess) {
  const m = new Map();
  for (const mv of chess.moves({ verbose: true })) {
    if (!m.has(mv.from)) m.set(mv.from, []);
    if (!m.get(mv.from).includes(mv.to)) m.get(mv.from).push(mv.to);
  }
  return m;
}

// L'ancien module « Finales de base » : les trois mats en onglets.
export const FINALES_TABS = ['mat-deux-tours', 'mat-dame', 'mat-tour'];
export function mountFinales(root, arg) {
  let id = FINALES_TABS.includes(arg) ? arg : sessionStorage.getItem('finales-tab');
  if (!FINALES_TABS.includes(id)) id = FINALES_TABS[0];
  return mount(root, id, { tabs: FINALES_TABS });
}
