import { Board } from '../board.js';
import { setText, Chess, destsOf, frSan, uci, load, recordResult, pickNext, wait, h, $ } from '../util.js';

export const THEMES = {
  mateIn1: 'Mat en 1', mateIn2: 'Mat en 2', mateIn3: 'Mat en 3', backRankMate: 'Mat du couloir',
  smotheredMate: 'Mat à l’étouffée', hangingPiece: 'Pièce en prise', fork: 'Fourchette', pin: 'Clouage',
  skewer: 'Enfilade', discoveredAttack: 'Attaque à la découverte', doubleCheck: 'Échec double',
  deflection: 'Déviation', attraction: 'Attraction', trappedPiece: 'Pièce piégée',
  defensiveMove: 'Coup défensif', capturingDefender: 'Éliminer le défenseur', advantage: 'Gain de matériel',
};

let cache = null;
async function loadPuzzles() {
  if (cache) return cache;
  const get = url => fetch(url).then(r => (r.ok ? r.json() : [])).catch(() => []);
  const [seed, lichess] = await Promise.all([get('data/puzzles.json'), get('data/puzzles-lichess.json')]);
  cache = lichess.length ? lichess : seed;
  return cache;
}

export function mount(root) {
  const store = load();
  let all = [], list = [], theme = sessionStorage.getItem('puzzle-theme') || 'all';
  let cur = null, chess = null, idx = 0, failed = false, done = false, alive = true, busy = false;

  const view = h(`
    <section class="trainer">
      <div class="board-wrap"><div class="board-el"></div></div>
      <div class="panel">
        <a class="back" href="#/">Retour au sommaire</a>
        <h2>Puzzles par thème</h2>
        <div class="chips"></div>
        <div class="verdict" data-state="wait">Chargement des puzzles…</div>
        <p class="explain"></p>
        <div class="actions">
          <button class="btn ghost" data-act="solution">Voir la solution</button>
          <button class="btn primary" data-act="next" hidden>Puzzle suivant</button>
          <button class="btn" data-act="retry" hidden>Rejouer</button>
        </div>
        <p class="stats"></p>
      </div>
    </section>`);
  root.replaceChildren(view);
  const board = new Board($('.board-el', view), { onMove });
  const verdict = $('.verdict', view), explain = $('.explain', view);
  const setVerdict = (s, t) => { verdict.dataset.state = s; setText(verdict, t); };
  const btn = a => $(`[data-act="${a}"]`, view);

  function renderChips() {
    const counts = {};
    all.forEach(p => p.themes.forEach(t => { if (THEMES[t]) counts[t] = (counts[t] || 0) + 1; }));
    const keys = Object.keys(THEMES).filter(k => counts[k]);
    $('.chips', view).innerHTML = [`<button data-theme="all">Tous <span>${all.length}</span></button>`,
      ...keys.map(k => `<button data-theme="${k}">${THEMES[k]} <span>${counts[k]}</span></button>`)].join('');
    view.querySelectorAll('.chips button').forEach(b => b.setAttribute('aria-pressed', b.dataset.theme === theme));
  }
  function renderStats() {
    const recs = list.map(p => store.puzzles[p.id]).filter(Boolean);
    const firstTry = list.filter(p => store.puzzles[p.id] && store.puzzles[p.id].box > 0).length;
    const toReview = list.filter(p => store.puzzles[p.id] && store.puzzles[p.id].box === 0).length;
    setText($('.stats', view), recs.length
      ? `Dans cette sélection : ${recs.length} puzzle${recs.length > 1 ? 's' : ''} déjà vu${recs.length > 1 ? 's' : ''}, ${firstTry} réussi${firstTry > 1 ? 's' : ''} au dernier essai, ${toReview} à revoir.`
      : `${list.length} puzzles dans cette sélection.`);
  }
  function applyFilter() {
    list = theme === 'all' ? all : all.filter(p => p.themes.includes(theme));
    if (!list.length) { theme = 'all'; list = all; }
    renderChips(); renderStats();
  }

  async function play(p) {
    cur = p; chess = new Chess(p.fen); idx = 0; failed = false; done = false;
    btn('next').hidden = true; btn('retry').hidden = true; btn('solution').hidden = false;
    setText(explain, '');
    board.setDests(null); board.setArrows([]); board.clearMarks();
    board.setOrientation(chess.turn() === 'w' ? 'b' : 'w');
    board.setPosition(p.fen); board.setLastMove(null);
    setVerdict('wait', 'Coup de l’adversaire…');
    await wait(600);
    if (!alive || cur !== p) return;
    playScripted();
    const col = chess.turn() === 'w' ? 'les Blancs' : 'les Noirs';
    setVerdict('turn', `Tu joues ${col}. Trouve le meilleur coup.`);
  }
  function playScripted() {
    const m = chess.move(uci(cur.moves[idx++]));
    board.setPosition(chess.fen()); board.setLastMove(m.from, m.to);
    board.setDests(destsOf(chess));
  }

  async function onMove(from, to) {
    if (done || busy) return;
    const expected = cur.moves[idx];
    const mv = chess.move({ from, to, promotion: expected && expected[4] ? expected[4] : 'q' });
    if (!mv) return;
    const isLast = idx === cur.moves.length - 1;
    const good = mv.lan === expected || (isLast && chess.isCheckmate());
    if (!good) {
      chess.undo();
      board.setPosition(chess.fen());
      board.setDests(destsOf(chess));
      if (!failed) { failed = true; recordResult('puzzles', cur.id, false); renderStats(); }
      setVerdict('ko', `${frSan(mv.san)} ne marche pas. Cherche encore, ou regarde la solution.`);
      return;
    }
    idx++;
    board.setPosition(chess.fen()); board.setLastMove(from, to); board.setArrows([]);
    if (idx >= cur.moves.length) return solved();
    busy = true; board.setDests(null);
    setVerdict('ok', `${frSan(mv.san)} : oui, continue.`);
    await wait(500);
    busy = false;
    if (!alive) return;
    playScripted();
  }

  function solved() {
    done = true; board.setDests(null);
    if (!failed) recordResult('puzzles', cur.id, true);
    setVerdict(failed ? 'ko' : 'ok', failed ? 'Résolu, avec de l’aide. Ce puzzle reviendra bientôt.' : 'Réussi du premier coup.');
    const names = cur.themes.map(t => THEMES[t]).filter(Boolean);
    setText(explain, (names.length ? `Thème : ${names.join(', ')}.` : '') + (cur.rating ? ` Classement Lichess : ${cur.rating}.` : ''));
    btn('next').hidden = false; btn('retry').hidden = false; btn('solution').hidden = true;
    renderStats();
  }

  async function showSolution() {
    if (done || busy) return;
    if (!failed) { failed = true; recordResult('puzzles', cur.id, false); }
    const expected = cur.moves[idx];
    const san = frSan(new Chess(chess.fen()).move(uci(expected)).san);
    board.setArrows([{ from: expected.slice(0, 2), to: expected.slice(2, 4), cls: 'good' }]);
    setVerdict('ko', `Le coup était ${san}. Joue-le pour continuer.`);
  }

  view.addEventListener('click', e => {
    const chip = e.target.closest('.chips button');
    if (chip) { theme = chip.dataset.theme; sessionStorage.setItem('puzzle-theme', theme); applyFilter(); play(pickNext(list, 'puzzles')); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next') play(pickNext(list, 'puzzles', cur && cur.id));
    if (act === 'retry') play(cur);
    if (act === 'solution') showSolution();
  });

  loadPuzzles().then(data => {
    if (!alive) return;
    all = data;
    if (!all.length) { setVerdict('ko', 'Aucun puzzle trouvé dans data/. Lance l’action « Construire les puzzles » sur GitHub.'); return; }
    applyFilter();
    play(pickNext(list, 'puzzles'));
  });

  return () => { alive = false; };
}
