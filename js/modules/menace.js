import { Board } from '../board.js';
import { setText, Chess, destsOf, frSan, yourPiece, nullMoveFen, uci, load, save, recordResult, pickNext, wait, h, $ } from '../util.js';

const FEM = { q: true, r: true };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

// Décrit en français ce que menace le coup t (uci) si l'adversaire rejouait tout de suite.
export function describeThreat(fenAfter, t) {
  const c = new Chess(nullMoveFen(fenAfter));
  const me = c.turn() === 'w' ? 'b' : 'w'; // le joueur (celui qui doit parer)
  const mv = c.move(uci(t));
  const san = frSan(mv.san);
  if (c.isCheckmate()) return `${san} : échec et mat.`;
  if (mv.captured) {
    const defended = c.isAttacked(mv.to, me);
    const piece = yourPiece(mv.captured);
    if (!defended) return `${san} : il prendrait ${piece} en ${mv.to}, qui n’est pas défendu${FEM[mv.captured] ? 'e' : ''}.`;
    if (VAL[mv.captured] > VAL[mv.piece]) return `${san} : il prendrait ${piece} en ${mv.to} avec une pièce moins chère. Même défendu${FEM[mv.captured] ? 'e' : ''}, tu perds du matériel.`;
    return `${san} : il prendrait ${piece} en ${mv.to} et gagnerait du matériel.`;
  }
  const targets = c.board().flat()
    .filter(p => p && p.color === me && c.attackers(p.square, mv.color).includes(mv.to))
    .filter(p => p.type === 'k' || VAL[p.type] >= VAL[mv.piece] || !c.isAttacked(p.square, me));
  if (targets.length >= 2) {
    const list = targets.map(p => p.type === 'k' ? 'ton roi' : `${yourPiece(p.type)} en ${p.square}`);
    return `${san} : attaque double sur ${list.slice(0, -1).join(', ')} et ${list.at(-1)}.`;
  }
  if (targets.length === 1 && targets[0].type !== 'k') return `${san} : il attaquerait ${yourPiece(targets[0].type)} en ${targets[0].square}, qui ne pourrait pas s’échapper facilement.`;
  return `${san} : coup qui gagne du matériel ou prépare une attaque décisive.`;
}

export function mount(root) {
  const store = load();
  store.stats ||= {};
  const st = store.stats.menace ||= { done: 0, spotted: 0, parried: 0 };
  let items = [], cur = null, alive = true, phase = 'idle', spotOk = false, after = null;

  const view = h(`
    <section class="trainer">
      <div class="board-wrap"><div class="board-el"></div></div>
      <div class="panel">
        <a class="back" href="#/">Retour au sommaire</a>
        <h2>Quelle est la menace ?</h2>
        <p class="tip">Question 1 de ta checklist. Avant de penser à ton coup, regarde ce que le dernier coup adverse prépare.</p>
        <div class="verdict" data-state="wait">Chargement des positions…</div>
        <p class="explain"></p>
        <div class="actions">
          <button class="btn ghost" data-act="giveup">Je ne vois pas</button>
          <button class="btn primary" data-act="next" hidden>Position suivante</button>
        </div>
        <p class="stats"></p>
      </div>
    </section>`);
  root.replaceChildren(view);
  const board = new Board($('.board-el', view), {});
  const verdict = $('.verdict', view), explain = $('.explain', view);
  const btnNext = $('[data-act="next"]', view), btnGiveup = $('[data-act="giveup"]', view);
  const setVerdict = (s, t) => { verdict.dataset.state = s; setText(verdict, t); };
  const renderStats = () => {
    setText($('.stats', view), st.done
      ? `${st.done} position${st.done > 1 ? 's' : ''} travaillée${st.done > 1 ? 's' : ''} : menace vue ${st.spotted} fois, parée ${st.parried} fois.`
      : `${items.length} positions disponibles.`);
  };

  async function next() {
    cur = pickNext(items, 'menace', cur && cur.id);
    const c = new Chess(cur.fen);
    const m = c.move(uci(cur.last));
    after = c;
    spotOk = false;
    btnNext.hidden = true; btnGiveup.hidden = false;
    setText(explain, '');
    board.onSquare = null; board.setDests(null); board.setArrows([]); board.clearMarks();
    board.setOrientation(c.turn());
    board.setPosition(cur.fen); board.setLastMove(null);
    setVerdict('wait', 'Regarde le coup adverse…');
    await wait(600);
    if (!alive) return;
    board.setPosition(c.fen()); board.setLastMove(m.from, m.to);
    phase = 'spot';
    setVerdict('turn', `Ton adversaire a joué ${frSan(m.san)}. Que menace-t-il ? Touche la case où il voudrait jouer maintenant.`);
    board.onSquare = onSpot;
  }

  function reveal() {
    const arrows = cur.threats.map(t => ({ from: t.slice(0, 2), to: t.slice(2, 4), cls: 'threat' }));
    board.setArrows(arrows);
    setText(explain, describeThreat(after.fen(), cur.main));
  }

  function onSpot(sq) {
    if (phase !== 'spot') return;
    const squares = cur.threats.map(t => t.slice(2, 4));
    spotOk = squares.includes(sq);
    board.mark(sq, spotOk ? 'mark-ok' : 'mark-ko');
    startParry(spotOk ? 'Bien vu.' : 'Non, ce n’est pas là.');
  }

  function startParry(prefix) {
    phase = 'parry';
    btnGiveup.hidden = true;
    reveal();
    board.onSquare = null;
    board.setDests(destsOf(after));
    board.onMove = onParry;
    setVerdict(spotOk ? 'ok' : 'ko', `${prefix} Maintenant, pare la menace : joue ton coup.`);
  }

  function onParry(from, to) {
    if (phase !== 'parry') return;
    phase = 'done';
    const played = from + to;
    const ok = cur.good.some(g => g.slice(0, 4) === played);
    const c = new Chess(after.fen());
    const mv = c.move({ from, to, promotion: 'q' });
    board.setDests(null);
    st.done++; if (spotOk) st.spotted++; if (ok) st.parried++;
    save();
    recordResult('menace', cur.id, spotOk && ok);
    if (ok) {
      board.setPosition(c.fen()); board.setLastMove(from, to); board.setArrows([]);
      setVerdict(spotOk ? 'ok' : 'ko', spotOk ? `${frSan(mv.san)} : menace vue et parée. Parfait.` : `${frSan(mv.san)} pare la menace. La prochaine fois, repère-la avant de jouer.`);
    } else {
      const g = cur.good[0];
      const gm = new Chess(after.fen()).move(uci(g));
      board.setArrows([
        ...cur.threats.map(t => ({ from: t.slice(0, 2), to: t.slice(2, 4), cls: 'threat' })),
        { from: g.slice(0, 2), to: g.slice(2, 4), cls: 'good' },
      ]);
      setVerdict('ko', `${frSan(mv.san)} ne suffit pas, la menace reste. Une bonne défense : ${frSan(gm.san)} (flèche verte).`);
    }
    btnNext.hidden = false;
    renderStats();
  }

  view.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'next') next();
    if (act === 'giveup' && phase === 'spot') { spotOk = false; startParry('Voici la menace (flèche rouge).'); }
  });

  fetch('data/menace.json').then(r => r.json()).then(data => {
    if (!alive) return;
    items = data;
    renderStats();
    next();
  }).catch(() => setVerdict('ko', 'Impossible de charger data/menace.json. Vérifie que le fichier est bien dans le dépôt.'));

  return () => { alive = false; };
}
