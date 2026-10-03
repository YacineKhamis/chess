import { Board } from '../board.js';
import { getEngine } from '../engine.js';
import { setText, Chess, destsOf, frSan, load, save, logActivity, h, $ } from '../util.js';

export const FINALES = [
  { id: 'krrk', label: 'Deux tours', long: 'Roi et deux tours contre roi', pieces: ['R', 'R'],
    tip: 'Les tours avancent en escalier : l’une coupe une rangée, l’autre donne échec sur la suivante.' },
  { id: 'kqk', label: 'Dame', long: 'Roi et dame contre roi', pieces: ['Q'],
    tip: 'Place ta dame à un saut de cavalier du roi adverse pour réduire sa cage, puis amène ton roi. Attention au pat.' },
  { id: 'krk', label: 'Tour', long: 'Roi et tour contre roi', pieces: ['R'],
    tip: 'La tour coupe le roi adverse ; ton roi vient en opposition ; la tour donne échec quand les rois se font face.' },
];

const FILES = 'abcdefgh';
const rnd = n => Math.floor(Math.random() * n);
const sqName = i => FILES[i % 8] + (Math.floor(i / 8) + 1);
const adjacent = (a, b) => Math.abs(a % 8 - b % 8) <= 1 && Math.abs(Math.floor(a / 8) - Math.floor(b / 8)) <= 1;
const onEdge = i => i % 8 === 0 || i % 8 === 7 || i < 8 || i >= 56;

export function randomPosition(pieces) {
  for (let t = 0; t < 2000; t++) {
    const used = new Set();
    const take = () => { let i; do { i = rnd(64); } while (used.has(i)); used.add(i); return i; };
    const wk = take(), bk = take();
    if (adjacent(wk, bk) || onEdge(bk)) continue;
    const placed = pieces.map(p => [p, take()]);
    const grid = Array(64).fill(null);
    grid[wk] = 'K'; grid[bk] = 'k';
    placed.forEach(([p, i]) => { grid[i] = p; });
    let fen = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const c = grid[r * 8 + f];
        if (!c) { empty++; continue; }
        if (empty) { fen += empty; empty = 0; }
        fen += c;
      }
      if (empty) fen += empty;
      if (r) fen += '/';
    }
    fen += ' w - - 0 1';
    let chess;
    try { chess = new Chess(fen); } catch { continue; }
    if (chess.isAttacked(sqName(bk), 'w')) continue;          // le roi noir ne doit pas être en échec
    // aucune pièce blanche ne doit être offerte au roi noir
    if (placed.some(([, i]) => adjacent(i, bk) && !chess.isAttacked(sqName(i), 'w'))) continue;
    return fen;
  }
  return '8/8/8/3k4/8/8/8/R3K3 w - - 0 1';
}

export function mount(root) {
  const store = load();
  let type = FINALES[0], chess, startFen, moves = 0, optimal = null, hints = 0, over = false, busy = false;
  let alive = true;

  const view = h(`
    <section class="trainer">
      <div class="board-wrap"><div class="board-el"></div></div>
      <div class="panel">
        <a class="back" href="#/">Retour au sommaire</a>
        <h2>Finales de base</h2>
        <div class="segmented" role="tablist">
          ${FINALES.map(f => `<button role="tab" data-id="${f.id}">${f.label}</button>`).join('')}
        </div>
        <p class="tip"></p>
        <div class="verdict" data-state="wait">Chargement du moteur…</div>
        <p class="meta"></p>
        <div class="actions">
          <button class="btn primary" data-act="new">Nouvelle position</button>
          <button class="btn" data-act="retry">Recommencer</button>
          <button class="btn ghost" data-act="hint">Indice</button>
        </div>
        <p class="stats"></p>
      </div>
    </section>`);
  root.replaceChildren(view);
  const board = new Board($('.board-el', view), { onMove: userMove });
  const verdict = $('.verdict', view), meta = $('.meta', view), stats = $('.stats', view);
  const engine = getEngine();

  function setVerdict(state, text) { verdict.dataset.state = state; setText(verdict, text); }
  function renderStats() {
    const r = store.finales[type.id];
    setText(stats, r ? `${type.long} : ${r.wins} mat${r.wins > 1 ? 's' : ''} réussi${r.wins > 1 ? 's' : ''} sur ${r.tries} essai${r.tries > 1 ? 's' : ''}, dont ${r.perfect || 0} proche${(r.perfect || 0) > 1 ? 's' : ''} de l’optimal.` : 'Aucun essai pour l’instant sur cette finale.');
  }
  function renderMeta() {
    const opt = optimal ? `Mat possible en ${optimal} coups.` : 'Calcul du mat optimal…';
    setText(meta, `${opt} Tu as joué ${moves} coup${moves > 1 ? 's' : ''}${hints ? `, ${hints} indice${hints > 1 ? 's' : ''}` : ''}.`);
  }
  function selectTab() {
    view.querySelectorAll('.segmented button').forEach(b => b.setAttribute('aria-selected', b.dataset.id === type.id));
    setText($('.tip', view), type.tip);
    renderStats();
  }

  async function start(fen) {
    startFen = fen || randomPosition(type.pieces);
    chess = new Chess(startFen);
    moves = 0; hints = 0; over = false; optimal = null;
    board.setOrientation('w');
    board.setPosition(startFen);
    board.setLastMove(null); board.setArrows([]);
    board.setDests(destsOf(chess));
    setVerdict('turn', 'À toi : mate le roi noir.');
    renderMeta();
    const myFen = startFen;
    const line = await engine.bestMove(startFen, { movetime: 1500 });
    if (!alive || myFen !== startFen) return;
    optimal = line && line.mate > 0 ? line.mate : null;
    renderMeta();
  }

  function finish(ok, text) {
    over = true;
    board.setDests(null);
    const r = store.finales[type.id] ||= { tries: 0, wins: 0, perfect: 0 };
    r.tries++;
    if (ok) { r.wins++; if (optimal && moves <= optimal + 2 && !hints) r.perfect = (r.perfect || 0) + 1; }
    save(); logActivity();
    setVerdict(ok ? 'ok' : 'ko', text);
    renderStats();
  }

  async function userMove(from, to) {
    if (over || busy) return;
    const mv = chess.move({ from, to, promotion: 'q' });
    if (!mv) return;
    moves++;
    board.setPosition(chess.fen()); board.setLastMove(from, to); board.setArrows([]);
    renderMeta();
    if (checkEnd(true)) return;
    busy = true;
    board.setDests(null);
    setVerdict('wait', 'Le roi noir réfléchit…');
    const reply = await engine.bestMove(chess.fen(), { movetime: 300 });
    busy = false;
    if (!alive || over) return;
    const bm = chess.move({ from: reply.move.slice(0, 2), to: reply.move.slice(2, 4) });
    board.setPosition(chess.fen()); board.setLastMove(bm.from, bm.to);
    if (checkEnd(false)) return;
    board.setDests(destsOf(chess));
    setVerdict('turn', `Le roi noir a joué ${frSan(bm.san)}. À toi.`);
  }

  function checkEnd() {
    if (chess.isCheckmate()) {
      const close = optimal && moves <= optimal + 2;
      finish(true, close ? `Mat en ${moves} coups : excellent, tout proche de l’optimal.` : `Mat en ${moves} coups. Réussi ! Recommence pour te rapprocher de ${optimal || 'l’optimal'}.`);
      return true;
    }
    if (chess.isStalemate()) { finish(false, 'Pat : le roi noir n’a plus de coup légal mais n’est pas en échec. Partie nulle.'); return true; }
    if (chess.isInsufficientMaterial()) { finish(false, 'Ta pièce a été prise : vérifie toujours qu’elle est protégée quand le roi s’approche.'); return true; }
    if (chess.isDraw()) { finish(false, 'Nulle (50 coups ou répétition). Il faut resserrer la cage plus vite.'); return true; }
    return false;
  }

  view.addEventListener('click', async e => {
    const tab = e.target.closest('.segmented button');
    if (tab) { type = FINALES.find(f => f.id === tab.dataset.id); selectTab(); start(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || busy) return;
    if (act === 'new') start();
    if (act === 'retry') start(startFen);
    if (act === 'hint' && !over) {
      hints++; renderMeta();
      const best = await engine.bestMove(chess.fen(), { movetime: 800 });
      if (best) board.setArrows([{ from: best.move.slice(0, 2), to: best.move.slice(2, 4), cls: 'hint' }]);
    }
  });

  selectTab();
  start();
  return () => { alive = false; };
}
