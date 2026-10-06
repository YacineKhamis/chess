// Tests du pilote UCI (js/engine.js) : d’abord avec un faux moteur scripté (déterministe),
// puis avec le vrai Stockfish dans un processus fils (§6.2-1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, parseInfo, goCommand } from '../../js/engine.js';
import { nodeEngine } from './node-engine.mjs';

const QUICK = !!process.env.QUICK;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ITALIAN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const RC3 = '8/8/8/8/8/2RK4/8/3k4 w - - 0 1';
const MATED = 'k7/1Q6/1K6/8/8/8/8/8 b - - 0 1';
const STALEMATE = 'k7/2Q5/1K6/8/8/8/8/8 b - - 0 1';
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} : pas de réponse en ${ms} ms`)), ms).unref())]);

// ---------- Faux moteur ----------
// script(goCmd) → { lines, best, hold } ; hold : n’envoie bestmove qu’à réception de « stop ».
function fake(script) {
  let fn = () => {}, onErr = () => {}, held = null;
  const t = { sent: [], gos: [] };
  const emit = ls => setTimeout(() => ls.forEach(l => fn(l)), 1);
  t.send = cmd => {
    t.sent.push(cmd);
    if (cmd === 'uci') emit(['id name Faux', 'uciok']);
    else if (cmd === 'isready') emit(['readyok']);
    else if (cmd.startsWith('go')) {
      t.gos.push(cmd);
      const r = script(cmd, t.gos.length);
      if (r.hold) { held = r; emit(r.lines); } else emit([...r.lines, `bestmove ${r.best}`]);
    } else if (cmd === 'stop' && held) { const r = held; held = null; emit([...(r.after || []), `bestmove ${r.best}`]); }
  };
  t.listen = (f, e) => { fn = f; onErr = e; };
  t.crash = () => onErr(new Error('panne simulée'));
  return t;
}
const info = (s) => `info ${s}`;

test('parseInfo : score, mat, pv, profondeur, lignes de borne ignorées', () => {
  const a = parseInfo('info depth 12 seldepth 18 multipv 2 score cp -35 nodes 9 nps 9 hashfull 1 time 3 pv e7e5 g1f3 b8c6');
  assert.deepEqual(a, { k: 2, line: { move: 'e7e5', cp: -35, mate: null, pv: ['e7e5', 'g1f3', 'b8c6'], depth: 12 } });
  assert.equal(parseInfo('info depth 9 multipv 1 score mate 2 nodes 1 pv d3e3 d1e1 c3c1').line.cp, 9980);
  assert.equal(parseInfo('info depth 9 multipv 1 score mate -1 nodes 1 pv d1e1 c3c1').line.cp, -9990);
  assert.equal(parseInfo('info depth 15 seldepth 26 multipv 1 score cp 22 upperbound nodes 1 pv d2d3 f8c5'), null);
  assert.equal(parseInfo('info depth 15 seldepth 26 multipv 1 score cp 22 lowerbound nodes 1 pv d2d3'), null);
  assert.equal(parseInfo('info depth 0 score mate 0'), null);
  assert.equal(parseInfo('info string NNUE evaluation using nn.nnue'), null);
  assert.equal(parseInfo('info depth 3 currmove e2e4 currmovenumber 1'), null);
  assert.deepEqual(parseInfo('info depth 4 score cp 10 pv e7e8q e1e2').line.pv, ['e7e8q', 'e1e2']);
});

test('goCommand : limites combinées, movetime 500 par défaut, searchmoves en dernier', () => {
  assert.equal(goCommand({}), 'go movetime 500');
  assert.equal(goCommand({ depth: 40, movetime: 400 }), 'go depth 40 movetime 400');
  assert.equal(goCommand({ depth: 8, searchmoves: ['a2a3', 'h2h3'] }), 'go depth 8 searchmoves a2a3 h2h3');
  assert.equal(goCommand({ searchmoves: 'e2e4 d2d4' }), 'go movetime 500 searchmoves e2e4 d2d4');
  assert.equal(goCommand({ movetime: 300, searchmoves: [] }), 'go movetime 300');
});

test('faux moteur : tri multipv, bornes ignorées, MultiPV envoyé seulement s’il change', async () => {
  const t = fake(() => ({
    best: 'e2e4',
    lines: [
      info('depth 10 seldepth 12 multipv 2 score cp 20 nodes 5 pv d2d4 d7d5'),
      info('depth 10 seldepth 12 multipv 1 score cp 30 nodes 5 pv e2e4 e7e5'),
      info('depth 11 seldepth 13 multipv 1 score cp 80 lowerbound nodes 9 pv g1f3'),
      info('depth 11 seldepth 13 multipv 2 score cp -5 upperbound nodes 9 pv c2c4'),
    ],
  }));
  const e = new Engine(t);
  const r = await e.analyse(START, { multipv: 2, depth: 11 });
  assert.deepEqual(r.map(l => [l.move, l.cp, l.depth]), [['e2e4', 30, 10], ['d2d4', 20, 10]]);
  assert.deepEqual(r[0].pv, ['e2e4', 'e7e5']);
  await e.analyse(START, { multipv: 2 });
  await e.analyse(START);
  assert.deepEqual(t.sent.filter(c => c.startsWith('setoption name MultiPV')), ['setoption name MultiPV value 2', 'setoption name MultiPV value 1']);
  assert.deepEqual(t.gos, ['go depth 11', 'go movetime 500', 'go movetime 500']);
  assert.ok(t.sent.indexOf('setoption name Hash value 16') < t.sent.indexOf('go depth 11'), 'initialisation avant la première recherche');
});

test('faux moteur : bestmove (none) → [] sans relance ; résultat vide → une relance en depth 1', async () => {
  const t = fake((cmd, n) => {
    if (n === 1) return { best: '(none)', lines: [info('depth 0 score mate 0')] };
    if (n === 2) return { best: 'e2e4', lines: [] };
    return { best: 'e2e4', lines: [info('depth 1 multipv 1 score cp 15 pv e2e4')] };
  });
  const e = new Engine(t);
  assert.deepEqual(await e.analyse(MATED, { movetime: 300 }), []);
  const r = await e.analyse(START, { movetime: 300, searchmoves: ['e2e4'] });
  assert.deepEqual(t.gos, ['go movetime 300', 'go movetime 300 searchmoves e2e4', 'go depth 1 searchmoves e2e4']);
  assert.equal(r[0].move, 'e2e4');
});

test('faux moteur : stop(tag) arrête la recherche en cours et vide la file de ce tag', async () => {
  const t = fake(cmd => cmd.includes('movetime 9999')
    ? { hold: true, best: 'e2e4', lines: [info('depth 8 multipv 1 score cp 25 pv e2e4 e7e5')] }
    : { best: 'd2d4', lines: [info('depth 5 multipv 1 score cp 10 pv d2d4')] });
  const e = new Engine(t);
  const order = [];
  const a = e.analyse(START, { movetime: 9999, tag: 'bg' }).then(r => (order.push('a'), r));
  const b = e.analyse(START, { movetime: 9999, tag: 'bg' }).then(r => (order.push('b'), r));
  const c = e.analyse(START, { depth: 5, tag: 'x' }).then(r => (order.push('c'), r));
  await tick(20);
  await e.stop('x');                       // c n’est pas en cours : retiré de la file sans « stop »
  assert.deepEqual(await c, []);
  assert.equal(t.sent.filter(s => s === 'stop').length, 0);
  const d = e.analyse(START, { depth: 5 });
  await e.stop('bg');
  const [ra, rb, rd] = await Promise.all([a, b, d]);
  assert.equal(ra[0].move, 'e2e4', 'la recherche arrêtée rend ses lignes');
  assert.deepEqual(rb, [], 'la recherche en file avec ce tag rend []');
  assert.equal(rd[0].move, 'd2d4');
  assert.deepEqual(order, ['c', 'b', 'a']);
  assert.equal(t.sent.filter(s => s === 'stop').length, 1);
  assert.equal(t.gos.length, 2, 'b et c n’ont jamais été envoyés au moteur');
  await e.stop('bg');                       // plus rien en cours : sans effet
  assert.equal(t.sent.filter(s => s === 'stop').length, 1);
});

test('faux moteur : newGame dans la file, panne → rejet, quit → []', async () => {
  const t = fake(() => ({ best: 'e2e4', lines: [info('depth 5 multipv 1 score cp 10 pv e2e4')] }));
  const e = new Engine(t);
  const a = e.analyse(START, { depth: 5 });
  const g = e.newGame();
  const b = e.analyse(START, { depth: 6 });
  await Promise.all([a, g, b]);
  const iNew = t.sent.indexOf('ucinewgame');
  assert.ok(t.sent.indexOf('go depth 5') < iNew && iNew < t.sent.indexOf('go depth 6'));
  assert.equal(t.sent[iNew + 1], 'isready');

  const t2 = fake(() => ({ hold: true, best: 'e2e4', lines: [] }));
  const e2 = new Engine(t2);
  const p = e2.analyse(START, { movetime: 9999 });
  await tick(20);
  t2.crash();
  await assert.rejects(p, /panne simulée/);
  await assert.rejects(e2.analyse(START), /panne simulée/);

  const t3 = fake(() => ({ hold: true, best: 'e2e4', lines: [] }));
  t3.close = () => { t3.closed = true; };
  const e3 = new Engine(t3);
  const q = e3.analyse(START, { movetime: 9999 });
  await tick(20);
  e3.quit();
  assert.deepEqual(await q, []);
  assert.deepEqual(await e3.analyse(START), []);
  assert.ok(t3.closed && t3.sent.includes('quit'));
});

// ---------- Vrai Stockfish ----------
test('Stockfish dans Node', { timeout: 60000 }, async t => {
  const log = [];
  const engine = nodeEngine({ log: (dir, l) => log.push([dir, l]) });
  t.after(() => engine.close());
  await within(engine.ready, 20000, 'initialisation');
  await engine.analyse(START, { depth: 1 });   // échauffement (réseau NNUE)

  // Lignes « info … pv » reçues entre la dernière commande go et bestmove.
  const lastSearch = () => {
    const i = log.findLastIndex(([d, l]) => d === '>' && l.startsWith('go'));
    return log.slice(i + 1).filter(([d, l]) => d === '<' && l.startsWith('info') && l.includes(' pv ')).map(([, l]) => l);
  };

  await t.test('depth 40 + movetime 400 : arrêt à 400 ms, pv et depth présents, bornes ignorées', async () => {
    let bounds = 0, worst = 0;
    const runs = QUICK ? 1 : 3;
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const r = await engine.analyse(ITALIAN, { depth: 40, movetime: 400, multipv: i ? 2 : 1 });
      const ms = performance.now() - t0;
      assert.ok(ms < 550, `rendu en ${ms.toFixed(0)} ms`);
      worst = Math.max(worst, ms);
      assert.ok(log.some(([d, l]) => d === '>' && l === 'go depth 40 movetime 400'));
      assert.equal(r.length, i ? 2 : 1);
      for (const l of r) {
        assert.ok(Array.isArray(l.pv) && l.pv.length >= 1 && l.pv[0] === l.move, 'pv commence par le coup');
        assert.ok(Number.isInteger(l.depth) && l.depth > 5, `profondeur ${l.depth}`);
        assert.equal(l.mate, null);
      }
      // La ligne rendue est la dernière ligne exacte (sans borne) de multipv 1.
      const infos = lastSearch();
      bounds += infos.filter(l => / (lower|upper)bound /.test(l)).length;
      const exact = infos.filter(l => !/ (lower|upper)bound /.test(l) && / multipv 1 /.test(l)).at(-1);
      assert.deepEqual(r[0], parseInfo(exact).line);
    }
    t.diagnostic(`go depth 40 movetime 400 : ${worst.toFixed(0)} ms au pire ; lignes de borne vues (et ignorées) : ${bounds}`);
  });

  await t.test('searchmoves en dernier et respecté', async () => {
    const r = await engine.analyse(START, { depth: 8, movetime: 2000, multipv: 3, searchmoves: ['a2a3', 'h2h3'] });
    assert.ok(log.some(([d, l]) => d === '>' && l === 'go depth 8 movetime 2000 searchmoves a2a3 h2h3'));
    assert.equal(r.length, 2, 'deux coups autorisés → deux lignes');
    assert.deepEqual(r.map(l => l.move).sort(), ['a2a3', 'h2h3']);
    const one = await engine.bestMove(ITALIAN, { movetime: 200, searchmoves: 'b2b3' });
    assert.equal(one.move, 'b2b3');
  });

  await t.test('codage du mat : mat en 2 → cp 9980, mat subi en 1 → cp −9990', async () => {
    // Sans ucinewgame, l’historique des recherches précédentes peut faire trouver un mat plus long
    // (mesuré : mat en 3 une fois sur trois ici) ; d’où newGame() avant chaque nouvelle position.
    await engine.newGame();
    const [l] = await engine.analyse(RC3, { depth: 12 });
    assert.equal(l.mate, 2);
    assert.equal(l.cp, 9980);
    assert.equal(l.pv.length, 3);
    const [m] = await engine.analyse('8/8/8/8/8/2R1K3/8/3k4 b - - 0 1', { depth: 8 });
    assert.deepEqual([m.move, m.mate, m.cp], ['d1e1', -1, -9990]);
  });

  await t.test('bestmove (none) sur mat et pat → [] sans blocage ni relance', async () => {
    for (const fen of [MATED, STALEMATE]) {
      const n = log.length;
      assert.deepEqual(await within(engine.analyse(fen, { movetime: 300 }), 3000, fen), []);
      assert.equal(log.slice(n).filter(([d, l]) => d === '>' && l.startsWith('go')).length, 1);
      assert.ok(log.slice(n).some(([d, l]) => d === '<' && l === 'bestmove (none)'));
    }
    assert.equal(await engine.bestMove(MATED, { depth: 3 }), null);
  });

  await t.test('stop("bg") rend la main tôt avec des lignes ; la file de ce tag est vidée', async () => {
    const t0 = performance.now();
    const bg = engine.analyse(ITALIAN, { movetime: 8000, multipv: 3, tag: 'bg' }).then(r => [r, performance.now() - t0]);
    const queued = engine.analyse(START, { movetime: 8000, tag: 'bg' }).then(r => [r, performance.now() - t0]);
    const reply = engine.analyse(RC3, { movetime: 200 });
    await tick(300);
    await engine.stop('bg');
    const [[lines, ms], [none, ms2]] = await Promise.all([bg, queued]);
    assert.ok(ms < 1200, `arrêtée après ${ms.toFixed(0)} ms`);
    t.diagnostic(`stop('bg') après 300 ms : rendu à ${ms.toFixed(0)} ms`);
    assert.equal(lines.length, 3);
    assert.ok(lines.every(l => l.pv.length && l.depth >= 1));
    assert.deepEqual(none, []);
    assert.ok(ms2 < 1200);
    const [r] = await within(reply, 3000, 'recherche suivante');
    assert.equal(r.mate, 2, 'la recherche suivante tourne normalement');
  });

  await t.test('newGame() puis analyse ; travaux concurrents servis dans l’ordre', async () => {
    const n = log.length;
    await within(engine.newGame(), 3000, 'newGame');
    const sent = log.slice(n).filter(([d]) => d === '>').map(([, l]) => l);
    assert.deepEqual(sent, ['ucinewgame', 'isready']);
    const fens = [RC3, START, '8/8/8/8/8/2R1K3/8/3k4 b - - 0 1'];
    const res = await Promise.all(fens.map(f => engine.analyse(f, { depth: 6 })));
    assert.equal(res[0][0].mate, 2);
    assert.ok(Math.abs(res[1][0].cp) < 150 && res[1][0].mate === null);
    assert.equal(res[2][0].mate, -1);
  });
});
