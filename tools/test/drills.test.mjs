// Générateurs et objectifs des parcours d'échecs de finale (mats, pions, pièces, tours) — spec §6.2 items 3 et 4.
// node --test tools/test/drills.test.mjs   (QUICK=1 : rapide ; FULL=1 : complet ; ONLY=<id> : un seul exercice)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../../vendor/chess.js';
import { DRILLS } from '../../js/drills/index.js';
import { produce, finalize } from '../../js/drill/produce.js';
import { s0 } from '../../js/drill/s0.js';
import { rules, GOALS } from '../../js/drill/goals.js';
import { Attempt } from '../../js/drill/attempt.js';
import { mirrorFiles, swapColors } from '../../js/analysis.js';
import { makeCtx, closeCtx, simulate, oracle, N } from './harness.mjs';

const TB_IDS = ['mat-dame', 'mat-tour', 'pion-carre', 'pion-roi-devant', 'pion-opposition', 'pion-cases-cles', 'pion-defense', 'pion-tour'];
const ENGINE_IDS = ['mat-deux-tours', 'mat-dame-pions', 'mat-tour-pions', 'dame-contre-pion', 'dame-contre-pion-nulle', 'tour-contre-pion', 'lucena', 'philidor'];
const only = process.env.ONLY;
const pickIds = ids => ids.filter(id => !only || id === only);

let ctx;
before(async () => { ctx = await makeCtx({ seed: 42 }); });
after(() => closeCtx(ctx));

const placement = fen => fen.split(' ')[0];

for (const id of pickIds(TB_IDS)) {
  test(`${id} : positions légales, dans la famille, variées (tables)`, async () => {
    const spec = DRILLS[id];
    for (let level = 0; level < spec.levels.length; level++) {
      const n = N(10, 40, 150), seen = new Set();
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        const colour = i % 2 ? spec.userSide : (spec.userSide === 'w' ? 'b' : 'w');
        const s = await produce(spec, level, ctx, { colour });
        assert.ok(s, `${id} L${level} : aucune position`);
        assert.ok(s0(s.fen, spec.s0), `${id} : S0 ${s.fen}`);
        assert.equal(new Chess(s.fen).turn(), s.userColor, `${id} : l'utilisateur doit avoir le trait`);
        const p = ctx.tb.probe(s.fen);
        const userStrong = p.strong === s.userColor;
        if (spec.goal.kind === 'hold') assert.ok(!userStrong && !p.win, `${id} : doit être nulle ${s.fen}`);
        else assert.ok(userStrong && p.win, `${id} : doit être gagnant ${s.fen}`);
        // la forme canonique garde le même verdict
        const back = s.flip ? swapColors(s.fen) : s.fen;
        const canon = s.mirror ? mirrorFiles(back) : back;
        assert.equal(placement(canon), placement(s.canonical));
        assert.equal(ctx.tb.probe(canon).win, p.win);
        seen.add(placement(s.canonical));
      }
      const ms = (Date.now() - t0) / n;
      assert.ok(seen.size >= 0.9 * n, `${id} L${level} : diversité ${seen.size}/${n}`);
      assert.ok(ms < 300, `${id} L${level} : ${ms.toFixed(1)} ms par position`);
    }
  });

  test(`${id} : l'oracle réussit toujours (tables)`, async () => {
    const spec = DRILLS[id];
    for (let level = 0; level < spec.levels.length; level++) {
      for (let i = 0; i < N(3, 10, 30); i++) {
        const s = await produce(spec, level, ctx, {});
        const a = await simulate(spec, s, ctx, oracle());
        assert.equal(a.outcome?.status, 'success', `${id} L${level} ${s.fen} : ${a.outcome?.reason}`);
        assert.ok(a.outcome.clean, `${id} : réussite propre attendue (${a.userMoves} coups, réf. ${a.ref})`);
      }
    }
  });

  test(`${id} : un coup perdant est sanctionné tout de suite (tables)`, async () => {
    const spec = DRILLS[id];
    let checked = 0;
    for (let i = 0; i < N(5, 20, 60); i++) {
      const s = await produce(spec, spec.levels.length - 1, ctx, {});
      const a = new Attempt(spec, s, ctx);
      const p = ctx.tb.probe(a.fen), userStrong = p.strong === a.userColor;
      const bad = ctx.tb.rankMoves(a.fen).filter(m => (userStrong ? !m.win : m.win));
      if (!bad.length) continue;
      const r = await a.userMove(bad[0].uci);
      assert.equal(r.status, 'end', `${id} ${s.fen} ${bad[0].uci}`);
      assert.equal(r.outcome.status, 'fail', `${id} ${s.fen} ${bad[0].uci} : ${r.outcome.reason}`);
      assert.ok(a.keyFen, 'le moment clé est la position avant l’erreur');
      checked++;
    }
    assert.ok(checked > 0);
  });
}

// Familles moteur : vérification indépendante par une recherche plus longue.
for (const id of pickIds(ENGINE_IDS)) {
  test(`${id} : positions légales et confirmées par une recherche longue (moteur)`, { timeout: 30 * 60e3 }, async () => {
    const spec = DRILLS[id];
    for (let level = 0; level < spec.levels.length; level++) {
      const n = N(2, 6, 20);
      let agree = 0, ms = 0;
      for (let i = 0; i < n; i++) {
        const t0 = Date.now();
        const s = await produce(spec, level, ctx, {});
        ms += Date.now() - t0;
        assert.ok(s, `${id} L${level} : aucune position`);
        assert.ok(s0(s.fen, spec.s0));
        assert.equal(new Chess(s.fen).turn(), s.userColor);
        const [l] = await ctx.engine.analyse(s.fen, { movetime: 3000 });
        const ok = spec.goal.kind === 'hold' ? l.mate == null && Math.abs(l.cp) <= 100
          : spec.goal.kind === 'mate' ? (l.mate != null && l.mate > 0) || l.cp >= 1000 // la référence est un majorant
          : l.cp >= 300;
        if (ok) agree++;
        else console.log(`  désaccord ${id} L${level} ${s.fen} → ${JSON.stringify({ cp: l.cp, mate: l.mate })}`);
      }
      console.log(`  ${id} L${level} : ${agree}/${n} confirmées, ${(ms / n / 1000).toFixed(1)} s par position`);
      assert.ok(agree >= Math.ceil(0.9 * n), `${id} L${level} : ${agree}/${n}`);
    }
  });

  test(`${id} : l'oracle réussit (moteur)`, { timeout: 30 * 60e3 }, async () => {
    const spec = DRILLS[id];
    const n = N(1, 3, 10);
    let ok = 0;
    for (let i = 0; i < n; i++) {
      const s = await produce(spec, spec.levels.length - 1, ctx, {});
      const a = await simulate(spec, s, ctx, oracle(1000));
      if (a.outcome?.status === 'success') ok++;
      else console.log(`  échec de l'oracle ${id} ${s.fen} : ${a.outcome?.reason}`);
    }
    assert.ok(ok >= n - (n >= 10 ? 1 : 0), `${id} : ${ok}/${n}`);
  });
}

// ---------- Fixtures d'objectifs ----------
const fakeSt = (spec, fen, moves = []) => {
  const chess = new Chess(fen);
  moves.forEach(m => chess.move(m));
  return { spec, chess, userColor: 'w', ctx };
};

test('pat de l’attaquant : échec « Pat »', async () => {
  const spec = DRILLS['mat-dame'];
  const s = finalize(spec, { fen: 'k7/8/2K5/8/8/8/8/1Q6 w - - 0 1', level: 2 }, { ref: 2 });
  const a = new Attempt(spec, s, ctx);
  const r = await a.userMove('b1b6');
  assert.equal(r.outcome.status, 'fail');
  assert.match(r.outcome.reason, /Pat/);
});

test('dame en prise : échec immédiat avec la raison', async () => {
  const spec = DRILLS['mat-dame'];
  const s = finalize(spec, { fen: '8/8/3k4/8/8/8/8/2Q1K3 w - - 0 1', level: 2 }, { ref: 9 });
  const a = new Attempt(spec, s, ctx);
  const r = await a.userMove('c1c5');
  assert.equal(r.outcome.status, 'fail');
  assert.match(r.outcome.reason, /en prise/);
});

test('promotion en dame qui pate : perdue ; en tour : réussie', async () => {
  const spec = DRILLS['pion-roi-devant'];
  // Roi blanc b4, pion b7, roi noir a6 : b8=D est pat, b8=T gagne.
  const fen = '8/1P6/k7/8/1K6/8/8/8 w - - 0 1';
  const q = new Attempt(spec, finalize(spec, { fen, level: 0 }, { ref: 1 }), ctx);
  const rq = await q.userMove('b7b8q');
  assert.equal(rq.outcome.status, 'fail', rq.outcome.reason);
  const r = new Attempt(spec, finalize(spec, { fen, level: 0 }, { ref: 1 }), ctx);
  const rr = await r.userMove('b7b8r');
  assert.equal(rr.outcome.status, 'success', rr.outcome.reason);
});

test('triple répétition : « Tu tournes en rond » en attaque, réussite en défense', () => {
  const moves = ['Rb1', 'Kd7', 'Ra1', 'Kd8', 'Rb1', 'Kd7', 'Ra1', 'Kd8'];
  const st = fakeSt(DRILLS['mat-tour'], '3k4/8/8/8/8/8/8/R3K3 w - - 0 1', moves);
  assert.match(rules(st, 'opp').reason, /tournes en rond/);
  const hold = fakeSt(DRILLS['pion-defense'], '3k4/8/8/8/8/8/8/R3K3 w - - 0 1', moves);
  assert.equal(rules(hold, 'opp').status, 'success');
});

test('signature gagnée : plus que le roi adverse, ta dame en jeu', () => {
  const st = fakeSt(DRILLS['lucena'], '8/8/8/8/3k4/8/8/2Q1K3 b - - 0 1');
  assert.equal(GOALS.promote.afterAny(st)?.status, 'success');
});

test('Philidor : l’échange vers une finale roi et pion nulle est une réussite', () => {
  // Après l'échange des tours : roi e4 et pion e5 contre roi e7, Blancs au trait, nulle d'après les tables.
  const st = fakeSt(DRILLS['philidor'], '8/4k3/8/4P3/4K3/8/8/8 w - - 0 1');
  st.userColor = 'b';
  const p = ctx.tb.probe(st.chess.fen());
  assert.ok(p && !p.win, 'la position de test doit être nulle');
  assert.equal(GOALS.hold.afterAny(st)?.status, 'success');
});
