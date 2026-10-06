# Spec v2 « Exercices en boucle »: implementable specification

Audience: the engineer implementing v2 in `/home/user/chess` (vanilla ES modules, no build step, French UI, static GitHub Pages).

Sources: the four research documents (Endgames, Tactics, Progression, Explainer) and a reading of the current code (`js/engine.js`, `js/board.js`, `js/util.js`, `js/main.js`, `js/analysis.js`, `js/modules/finales.js`, `tools/test/node-engine.mjs`).

Five facts were re-measured during the merge, in Node with the repo's own Stockfish build:

| What was measured | Result |
|---|---|
| Building the exact tables with the researchers' `endcat/tb3.mjs` | KQK 1.37 s, KRK 1.34 s, KPK 0.93 s, plus distance-to-promotion 0.23 s. Maxima: KQK mate in 10, KRK mate in 16, distance to safe promotion 19. White wins 76.5 % of KPK positions with White to move. |
| `go depth 40 movetime 400` | Stops at 400 ms, so combined limits work. `lowerbound`/`upperbound` info lines do occur (1 of the 19 `pv` lines in that search). |
| New prototype: `piece-en-prise` generator, depth 10 | Acceptance 21 % with no decoy, 25 % with 1 decoy, 6 % with 2 decoys. Median engine check 11–20 ms. |
| New prototype: `parer-couloir`, the back-rank defence twin | 63 % acceptance. 1 of the 3 printed samples gave the user their own mate in 1, so the filter in §3.7 is mandatory. |
| New prototype: smothered mate in 2 (« legs de Philidor »), built constructively | 30 accepted out of 32 checks (94 %), depth 12, mate in 2 and unique. |

Scratch scripts: `/tmp/claude-0/-home-user-chess/0f7ae9ab-cdb4-5553-a217-1156c31fdb50/scratchpad/` (subfolders `endcat/` and `spec/`).

---

## 0. Summary and decisions

### 0.1 What v2 is
- **One generic drill runner** (`#/drill/<id>`) that plays any drill described by a declarative spec.
- **A catalogue** of 24 Phase A drills in 7 tracks (endgame and tactical). Each drill is a family of random but equivalent positions, played out against a perfect defender, with an objective yardstick.
- **Progression**:
  - difficulty levels inside each drill;
  - mastery states: Acquis, then Maîtrisé after a later-day check;
  - spaced checks;
  - a « Séance du jour » planner, the « Parcours » page, and an interleaved « Mélange ».
- **A rule-based explainer** that turns the hint and the user's mistake into one or two true French sentences. This answers the user's complaint « sans explication c'est difficile ».
- **Exact 3-piece tables** (KPK, KQK, KRK), shipped as about 180 KB of binary data. They give exact verdicts, exact yardsticks and exact « only move » families. They also fix the current KRK bug where « Calcul du mat optimal… » hangs forever.

### 0.2 Contradictions between researchers, resolved

| # | Topic | Positions | Decision |
|---|---|---|---|
| 1 | Eval scale | Brief: winning KPK ≈ +20. Endgames: +5.9…+14 at 300 ms. Tactics: +6…+8 at depth 12. Progression: +4.8…mate. | This build has **no bitbase-scale evals**. One classifier for everything (§2.2): attack OK ≥ +300 and LOST ≤ +100; hold OK ≥ −100 and LOST ≤ −300; grey zone in between, where no verdict is given. |
| 2 | Draw band | Progression \|cp\| ≤ 60; Explainer ≤ 150 (win ≥ 400); Tactics \|cp\| ≤ 50 | **Rejected as play-time thresholds.** Measured draws reach +0.70 (queen vs rook/bishop pawn) and +1.02 (wrong bishop, long search). ±50/±100 is used only to *accept a starting position* for hold drills. The explainer severity uses the verdict classifier. |
| 3 | Confirmation search | Endgames: 1200 ms movetime. Progression: depth 18. | **movetime 1200.** Depth has no time bound on a phone. Decisive classes still agreed 100 % at 100 ms. |
| 4 | Yardstick for KQK/KRK | Endgames: exact tables. Progression: offline pools searched 8–10 s. | **Exact tables.** They also give exact distance-to-mate bands for the levels, which is progression's backward chaining. |
| 5 | Tables built in the browser or shipped | Endgames: either | **Shipped** binary files built by `tools/build_tb.mjs`. The naive builder holds millions of successor objects in memory, which is risky on a phone. |
| 6 | Mastery criterion | Endgames: level 3 and 4 of the last 5 clean. Tactics: 8/10 and median time ≤ 20 s. Progression: 3 clean in a row at the top level with a Black game, then a later-day check. | **Progression's criterion.** `need` = 3 for play-out drills, 5 for one-key-move drills. **No time gate in Phase A** (time is logged; Chrono is Phase B). |
| 7 | Level staircase | Endgames: +1 after 3 clean, −1 after 2 failures. Progression: 3 up / 1 down, plus a fast track. | **Progression's rule.** It converges to about 79 % clean, and the fast track avoids a grind for players who already know the material. Acquired drills stay at the top level. |
| 8 | Realism ladder | Progression: rungs n1…n5 per concept. Tactics: N1…N5 per motif. Endgames: rungs as separate drills. | **Rule:** a variation that keeps the *same solution idea and the same verification* is a **level** inside the drill (distance, inert noise, colour). A variation that adds a *new idea* (pawns as stalemate traps, a live pawn, a defended target) is a **new drill** linked by `prereq`. The user's « finales rarement sans pions » is therefore a drill chain: `mat-tour → mat-tour-pions → tour-contre-pion → lucena`. |
| 9 | Review intervals | `util.js` [0,1,3,7,16,35]; Progression [1,3,7,14,30,60,120] | New `DRILL_INTERVALS = [1,3,7,14,30,60,120]` days for drills. The v1 modules keep `INTERVALS`. |
| 10 | What a review is | Endgames: a 3-position mini-series. Progression: one attempt. | The **first attempt of the day** on an acquired drill is the check. The session plays 2 positions (the check, then one practice game). |
| 11 | Hint cost | Tactics: level 1 is free. Explainer: 0.25/0.5/1. Progression: any hint → H. | **Any hint level marks the attempt `H` (not clean).** H is **neutral** for the level staircase. UI text: « L’indice ne coûte que la série, pas le palier. » |
| 12 | Feedback during play | Endgames: « Imprécis », « plus lentement ». Progression: none. | **Only terminal verdicts during play.** Slower or imprecise moves are shown in the debrief. |
| 13 | Attacker in hold drills | Endgames (exact tables): sets traps. Progression: engine MultiPV trap-setter. | Exact-table drills set traps in **Phase A** (exact and cheap). Engine trap-setting is **Phase B**. Phase A engine hold drills use the engine's best move. |
| 14 | Engine workers | Endgames: a second worker. Tactics: one queue. | **One worker in Phase A.** Background jobs are tagged and stoppable. Positions are generated only when no attempt is live. |
| 15 | depth or movetime | Tactics: depth, for reproducibility. Endgames: movetime. | Tactic **generation** checks use depth with a movetime cap. Endgame verification and **every play-time search** use movetime. |
| 16 | Storage | `store.motifs` plus `motifs/<id>@N` keys, or `store.drills` | A single `store.drills[id]` (§1.8). |
| 17 | Trainer modules | `motifs.js`, `trainer.js`, a new `finales.js` | **One runner.** `#/finales` becomes a thin wrapper around it. |
| 18 | Colour flip | Endgames: from L3. Tactics: 50 % from N2. Progression: a Black game is required. | Flip only at the **top level** of drills with `flip:true`, 50 % of the time. The missing colour is forced when the streak is one game short. |
| 19 | Clean slack for mates | v1: opt + 2. Endgames: max(2, ⌈0.2·opt⌉). Progression: max(2, ⌈ref/4⌉). | **max(2, ⌈ref/4⌉)**. For ref ≤ 8 it equals v1. Tactical mate-in-N uses an exact N. |
| 20 | Grey-zone moves and clean | Endgames: they break clean. Progression: they don't. | **They don't.** The grey zone is engine noise, not user skill. They are logged. |
| 21 | KPK oracle | Engine at runtime, or exact tables | **Exact tables.** No engine call for the whole pawn track. |
| 22 | Key squares | Endgames and Explainer agree | Kept. The explainer additionally requires the exact table to say « gagné ». |

### 0.3 Cut from v2 entirely (unreliable)
- KQ vs KR. The eval is only +2.4…+3.4 and no mate is found.
- Opposite-coloured bishops as a play-out. Long evals spread over +1…+4.5.
- Rook behind the passed pawn as a play-out (mostly grey zone; it might return later as a choice format).
- Greek gift as a play-out (it might return as « correct ou pas ? »).
- Windmill, interference, clearance, intermezzo by random generation.
- A kiss-mate drill (always has duals).
- Légal as a best-move position.
- Triangulation and Réti until curated seeds exist.
- Eval-based verdicts in KBNK/KBBK.
- A live eval bar and per-move red/green during play.

---

## 1. Architecture

### 1.1 File layout

```
js/
  engine.js              CHANGED  §1.2
  board.js               CHANGED  promotion picker, extra mark classes, setZone(cls)
  analysis.js            CHANGED  split kingZone hanging/leaks, + kingDist, keySquares, symmetry helpers
  util.js                CHANGED  load() → migrate(); importProgress → migrate()
  progress.js            NEW  pure progression logic (store passed in) + thin load/save wrappers
  tb/build.js            NEW  retrograde builder (Node tool + tests only)
  tb/probe.js            NEW  loader, probe(), rankMoves(), policies (browser + Node)
  drill/geom.js          NEW  sq math, toFen(map), between(), origins(), knight/king vectors, rng (mulberry32)
  drill/s0.js            NEW  sanity filter
  drill/noise.js         NEW  inert noise
  drill/verify.js        NEW  verification library V.*
  drill/produce.js       NEW  generation pipeline (strata, anti-repeat, transforms, seeds)
  drill/verdict.js       NEW  thresholds, classify, judge()
  drill/goals.js         NEW  goal kinds: mate | promote | capture | hold | material
  drill/attempt.js       NEW  DOM-free attempt state machine (used by UI and Node tests)
  drills/index.js        NEW  DRILLS, TRACKS, PARCOURS, coveredBy
  drills/mats.js pions.js pieces.js tours.js tactique.js images.js vigilance.js   NEW specs
  explain/board64.js features.js rules.js fr.js index.js                          NEW §5
  modules/drill.js       NEW  UI for #/drill/<id>
  modules/parcours.js    NEW  #/parcours
  modules/seance.js      NEW  #/seance
  modules/finales.js     REPLACED by a wrapper (tabs over the 3 mate drills)
data/tb/kqk.bin krk.bin kpk.bin        NEW (≈180 KB total)
data/drills/<id>.json                  OPTIONAL seed pools (only where §3 says so)
tools/build_tb.mjs                     NEW
tools/build_drills.mjs                 NEW (seed pools; Phase A needs it only as a fallback)
tools/test/node-engine.mjs             CHANGED (bounds, pv)
tools/test/*.test.mjs                  NEW (node --test)
.github/workflows/tests.yml            NEW (quick mode)
```

### 1.2 `engine.js` changes (exact)

1. **Parser.** Skip info lines that contain ` lowerbound ` or ` upperbound `. Keep `pv` (the array of UCI moves after `pv`) and `depth`. Line object: `{move, cp, mate, pv, depth}`. The mate encoding is unchanged: `cp = mate>0 ? 10000−10·mate : −10000−10·mate`.
2. **Signature.** `analyse(fen, { depth, movetime, multipv = 1, searchmoves, tag })`. Build the command as:

   ```
   go [depth D] [movetime M] [searchmoves m1 m2 …]
   ```

   - `searchmoves` must come **last**: Stockfish consumes every token after it.
   - With neither limit given, default to `movetime 500`.
   - Combined `depth + movetime` stops at whichever comes first (verified).
3. **`newGame()`** queues `ucinewgame` followed by `isready`. Call it before each new start position and before each verification candidate.
4. **`stop(tag)`.** If the job currently running was submitted with that `tag`, send `stop`. The job then resolves with the lines it has. Use it for the background hint analysis (`tag:'bg'`) before queuing the reply search.
5. **Robustness.**
   - `bestmove (none)` resolves `[]`.
   - Callers must check game-over with chess.js *before* searching.
   - If a search returns `[]` on a non-terminal position, retry once with `depth 1`.

Search budgets used everywhere:

| Purpose | Limits |
|---|---|
| Opponent reply and per-move verdict (the same search) | `movetime 300` |
| Confirmation of a suspected failure | `movetime 1200` |
| Background hint pre-analysis while the user thinks | `movetime 600, multipv 3, tag 'bg'` (stopped on user move) |
| Engine yardstick at start (KRRK, mates with pawns) | `movetime 1500` |
| Start-position check, endgame families | `movetime 300` then `movetime 1000` |
| Start-position check, tactical families | `depth 10` (L1) / `12` (L2–L3), `movetime` cap 1500, `multipv 2`; stability check at depth D−2 |
| Defence-twin check | null-move position `depth 10`; position `depth 10, multipv min(legal, 30)` |

### 1.3 Exact tables (`js/tb/`)

**Build.**
- `tools/build_tb.mjs` imports `js/tb/build.js`, a port of `scratchpad/endcat/tb3.mjs` using typed arrays, and writes three files.
- Semantics: KPK counts a promotion as safe when the resulting KQK/KRK position, Black to move, is a win. That covers both « queen not capturable » and « not stalemate ».

**Binary format** (white = strong side, white to move only):

| File | Layout | Bytes | Value byte |
|---|---|---|---|
| `kqk.bin`, `krk.bin` | `idx = (t·64 + bk)·64 + x`. `t` = index of the white king, after the symmetry below, in `TRI = [a1,b1,c1,d1,b2,c2,d2,c3,d3,d4]` | 40,960 each | 1…16 = White mates in v moves; 0 = draw; 255 = illegal (overlap, adjacent kings, Black in check) |
| `kpk.bin` | Pawn on files a–d (mirror all squares if the pawn is on e–h). `idx = (wk·64 + bk)·24 + (rank(p)−1)·4 + file(p)`, with 0-based rank 1…6 (ranks 2–7) and file 0…3 | 98,304 | 1…19 = moves to safe promotion, promotion included; 0 = draw; 255 = illegal |

- **Pawnless symmetry.** Flip files if file(wk) > 3, flip ranks if rank(wk) > 3, then transpose if file(wk) < rank(wk). Apply the same map to `bk` and `x`.
- The builder fills every `(t, bk, x)` from the full table, so the two equivalent placements on the diagonal are both correct.

**Probe API** (`js/tb/probe.js`). It never instantiates `Chess`: it parses the FEN placement and uses integer king/slider helpers shared with the builder.

```js
export async function loadTB(names = ['kpk', 'kqk', 'krk'])   // fetch data/tb/<n>.bin → Uint8Array, cached
export function signature(fen)        // 'KPK'|'KQK'|'KRK'|null (exactly kings + one Q/R/P), strong colour
// Exact result from any side to move. dist = strong side's moves still needed (mate or safe promotion).
export function probe(fen)            // → null | { sig, strong: 'w'|'b', win: boolean, dist: number|null, mate: boolean }
export function rankMoves(fen)        // all legal moves of the side to move, each probed after the move:
                                      // → [{ uci, win (strong side still wins), dist, captures, promo }]
                                      // promotion to B/N → draw; capture leaving K vs K → draw
```

- **Normalising the colours.** If the strong piece is black, apply `swapColors` (from `analysis.js`) before the lookup and map the results back.
- **Strong side to move.** Direct lookup: `dist = v`.
- **Defender to move.** Compute it with one ply of the defender's king moves:
  - no legal move and in check: mate, `dist = 0`;
  - no legal move and not in check: stalemate, draw;
  - any reply that captures the piece or pawn: that branch is a draw;
  - otherwise `win = every reply wins` and `dist = max over replies`.
- **Sanity check.** The best strong move from distance v leads to a defender-to-move position with distance v − 1.

**Opponent policies** (used only by the attempt state machine):
- **`tb-stubborn`** (the user attacks): the defender plays the move that maximises `dist`. Ties go to the move leaving the user the fewest winning replies, then to a random choice.
- **`tb-trap`** (the user defends): the attacker keeps the win if one exists. Among drawing moves it plays the one that leaves the user the fewest drawing replies. It never gives the pawn away unless forced. Ties are random.

### 1.4 Drill spec interface (exact)

One default export per drill, collected by `js/drills/index.js`. All functions are pure apart from `verify`, which receives the engine and the tables through `ctx`.

```js
/**
 * @typedef {Object} DrillSpec
 * @property {string} id            stable kebab-case id; it is the storage key
 * @property {'mats'|'pions'|'pieces'|'tours'|'tactique'|'images'|'vigilance'} track
 * @property {string} title         French title, e.g. 'Prendre l’opposition'
 * @property {string} short         chip label
 * @property {'A'|'B'} phase
 * @property {'tb'|'engine'} oracle
 * @property {string} family        explainer family: 'kqk'|'krk'|'krrk'|'kpk'|'kpk-def'|'kqkp'|'krkp'|'lucena'|'philidor'|'tactic:<motif>'|'mate-pic'|'parry'
 * @property {'w'|'b'} userSide     user colour in the canonical (unflipped) form; the user always moves first
 * @property {Goal} goal            §2.4: {kind:'mate'|'promote'|'capture'|'hold'|'material', ...}
 * @property {Level[]} levels       ≥1, easy → hard; the top level is the last one
 * @property {boolean} flip         colour swap allowed (top level only, §4.2)
 * @property {number} [need=3]      clean streak at the top level for « Acquis »
 * @property {string[]} prereq      soft prerequisites (§4.5)
 * @property {string[]} [covers]    drills whose play is literally included (implicit review, placement)
 * @property {string[]} [contrast]  same material, different plan (used by Mélange)
 * @property {string} tip           1–2 French sentences, always visible
 * @property {string[]} ideas       explainer fact ids this drill teaches (+10 priority, §5.3)
 * @property {'tb-dtm'|'tb-dtp'|'engine-mate'|'mate-n'|'gain'|'hold-n'|null} yardstick
 * @property {number|((ref:number|null)=>number)} [moveCap]
 * @property {(level:number)=>string[]} [strata]   sub-cases cycled round-robin (§3.0.4)
 * @property {Object} [s0]          { allowCheck?:boolean, allowCaptures?:boolean }
 * @property {(rng:()=>number, level:number, sub:string|null)=>Candidate|null} generate   SYNC, chess.js only
 * @property {(ctx:Ctx, c:Candidate, level:number)=>Promise<Verified|null>} verify      usually a V.* from §3.0.5
 * @property {string} [seeds]       'data/drills/<id>.json': fallback pool [{fen, level, sub, key?, ref?, E0?, Ealt?}]
 * @property {(ctx:Ctx, st:State)=>Outcome|null} [afterUser]      drill-specific check, run before the generic verdict
 * @property {(ctx:Ctx, st:State)=>Outcome|null} [afterOpponent]
 * @property {{ok:number, lost:number, confirmMs?:number}} [thresholds]  overrides §2.2 (user POV, cp)
 *
 * @typedef {{label:string, tries?:number, [k:string]:any}} Level   generator parameters live here
 * @typedef {{fen:string, key?:string, keySet?:string[], roles?:Object, sub?:string, meta?:Object}} Candidate
 *          fen: canonical, user (= spec.userSide) to move, castling '-', ep '-', halfmove 0
 *          roles: named squares for hints, e.g. {piece:'g5', to:'f7', targets:['h8','d8'], line:[...], threat:'d4d1'}
 * @typedef {{E0?:number, Ealt?:number, ref?:number, key?:string, pv?:string[], roles?:Object}} Verified
 * @typedef {{status:'success'|'fail', reason:string, quality?:'optimal'|'late'|'other'}} Outcome
 * @typedef {{engine:Engine, tb:TB, rng:()=>number}} Ctx
 */
```

### 1.5 Generation pipeline (`drill/produce.js`)

```js
export async function produce(spec, level, ctx, { sub = null, colour, recent }) {
  const L = spec.levels[level];
  const tries = L.tries ?? (spec.oracle === 'tb' ? 3000 : 40);
  for (let t = 0; t < tries; t++) {
    const c = spec.generate(ctx.rng, level, sub);
    if (!c || !s0(c.fen, spec.s0)) continue;
    const key = c.fen.split(' ')[0];
    if (recent.has(key)) continue;                         // last 30 canonical placements per drill (memory)
    if (spec.oracle === 'engine') await ctx.engine.newGame();
    const v = await spec.verify(ctx, c, level);
    if (!v) continue;
    recent.add(key);
    return finalize(spec, c, v, { mirror: ctx.rng() < 0.5, flip: colour !== spec.userSide });
  }
  return fromSeeds(spec, level, sub, ctx) ?? null;         // null → UI: « Pas de position trouvée, réessaie. »
}
```

- **`finalize`** applies the file mirror (always allowed) and the colour swap (`swapColors`, when flipped) to `fen`, `key`, `keySet`, `roles` squares and `pv`. Evals and `ref` do not change under these symmetries. It sets `userColor`.
- **Timing.** The next position is produced as soon as an attempt ends (debrief screen). If the user clicks « Position suivante » before it is ready, the verdict line shows « Préparation de la position… ».
- **Hard positions.** One attempt in four in a séance focus block comes from `r.err` (§4.1), passed through `finalize` with a fresh random symmetry: « Ta position difficile revient… en miroir. »

### 1.6 The attempt state machine (`drill/attempt.js`, DOM-free)

```js
export class Attempt {
  constructor(spec, start, ctx, { level, retry = false })   // start = finalize() output; chess = new Chess(start.fen)
  // state: chess, userColor, level, ref, E0, Ealt, M0 (material balance, user POV), userMoves, hints, hintMax,
  //        history: [{fen, uci, san, by:'user'|'opp', v?, cls?, dist?}], greyMoves, t0, over
  async userMove(uci)     // → { status:'continue'|'end', reply?, outcome?, refutation?, events:[{type, text}] }   (§2.3)
  async hint()            // raises the hint level 1→2→3 → { level, text, viz }   (§5.1)
  summary()               // → attempt record for progress.record() (§4.1)
}
```

**The UI module `js/modules/drill.js`** reuses the existing `.trainer` layout.

Panel, top to bottom:
1. back link and breadcrumb « Parcours › {track} »;
2. title and level chip « Palier 2/3 »;
3. `.tip`;
4. `.verdict` showing the goal sentence (§2.4);
5. `.meta` showing the yardstick and counter, e.g. « Coup 7 · référence 12 · limite propre 15 »;
6. streak dots « Série propre ●●○ (Acquis à 3) »;
7. actions: « Indice (1/3) », « Recommencer » (code R), « Nouvelle position »;
8. `.explain` paragraph;
9. `.stats` line.

At the end of an attempt:
- **Failure:** « Pourquoi ? » (replays the refutation PV slowly with arrows, then shows `explainMistake`), « Reprendre avant l’erreur » (same attempt, from the FEN before the losing move; code R), « Position équivalente » (same level, same sub-case, new symmetry), « Position suivante ».
- **Success:** the result line (§4.8), the key moment when the attempt was not clean (§5.6), « Rejouer depuis le moment clé » (R), « Position suivante ».

**Board additions** (`board.js`):
- **Promotion picker:** an `onPromote(from, to, color) → Promise<'q'|'r'|'b'|'n'>` option that shows a 4-piece overlay on the promotion square. It is required for KPK, where a queen can stalemate.
- **CSS classes:** `mark-hint`, `mark-key`, `mark-line`, `mark-escape` (dot), and `.arrow.plan` (dashed, 50 % opacity).
- **`setZone(squares, cls = 'zone')`.**
- Orientation already supports `'b'`.

### 1.7 Explainer interface (`js/explain/index.js`)

```js
// level: 1 idea | 2 piece | 3 move. Always returns true statements or an honest fallback (§5).
export function explainMove({ fen, move, family, ideas = [], pv, lastMove, tb, level = 3 })
  // → { idea: string, text: string[], tags: string[], viz: { zone?: string[], marks?: {[sq]:cls}, arrows?: {from,to,cls}[] } }
export function explainMistake({ fen, userMove, bestMove, family, evalBest, evalUser, pvBest, pvUser, tb })
  // → { severity, text: string[], tags, viz }
export async function pickTeachingMove({ engine, tb, fen, family, ideas, multipv = 3, movetime = 800 })
  // tb families: rankMoves ties (same dist); engine families: MultiPV lines within 15 cp (or the same mate) → highest-scoring explanation
```

Budget: < 50 ms on a mid-range phone, excluding engine calls. Features are memoised per FEN.

### 1.8 Progression store (same key `manuel-echecs-v1`, schema v2)

```jsonc
{
  "v": 2,
  "days": {}, "menace": {}, "puzzles": {}, "stats": {},          // unchanged v1 data
  "finales": { "krk": { "tries": 9, "wins": 7, "perfect": 3 } },  // v1, frozen after migration (kept for rollback)
  "drills": {
    "mat-tour": {
      "n": 14, "ok": 11, "clean": 7,
      "level": 3, "up": 0, "fast": false,          // staircase: current level index, clean count at this level, fast track
      "streak": 2, "var": 1, "need": null,         // var bitmask 1 = White, 2 = Black; need null = spec default, 2 after a lapse
      "hist": "FSCCHSCC",                          // last 20 result codes, newest last
      "st": "acq",                                 // new | learn | acq | mast | rusty
      "acqAt": 0, "mastAt": 0,
      "box": 0, "due": 0, "chk": "2026-10-06", "lastChk": 0, "lapses": 0,
      "err": [ { "fen": "…", "level": 3, "sub": null } ],   // ≤10 positions before key mistakes (canonical form)
      "placed": false, "best": 13, "last": 0
    }
  },
  "log": [[1759700000000, "mat-tour", "C", 3, 13, 12, 0, 74, "w"]],  // ts, id, code, level, moves, ref, hints, secs, colour; ring of 300
  "seance": { "date": "2026-10-06", "items": [], "i": 0 },
  "prefs": {}
}
```

**Migration** (`progress.js`, idempotent; called by `util.load()` and by `importProgress()`):

```js
const MAP = { krrk: 'mat-deux-tours', kqk: 'mat-dame', krk: 'mat-tour' };
export function migrate(s) {
  if (s.v >= 2) return s;
  s.drills ||= {}; s.log ||= []; s.prefs ||= {};
  for (const [old, id] of Object.entries(MAP)) {
    const r = s.finales?.[old]; if (!r?.tries) continue;
    const top = DRILLS[id].levels.length - 1, d = s.drills[id] = { ...fresh(), n: r.tries, ok: r.wins, clean: r.perfect || 0, last: Date.now() };
    if ((r.perfect || 0) >= 3) Object.assign(d, { st: 'acq', level: top, fast: false, acqAt: Date.now() - DAY, lastChk: Date.now() - DAY, due: Date.now() });
    else Object.assign(d, { st: 'learn', level: r.wins ? Math.max(0, top - 1) : 0, fast: true });
  }
  s.v = 2; return s;
}
```

- The current player's mates with 3 or more « perfect » games become **due checks in the first session**. One clean game then makes them Maîtrisé.
- `util.load()` keeps creating the v1 buckets. The home page reads `drills` from v2 on.

### 1.9 Routes and home page

**`main.js` routing.** Split the hash into segments: `const [key, arg] = location.hash.replace(/^#\/?/, '').split('/')`.

| Route | View |
|---|---|
| `#/` | home |
| `#/seance` | session runner (« Séance · 3/9 »), resumable the same day |
| `#/parcours` | tracks with drill cards: state symbol, level, « Tu es ici » |
| `#/drill/<id>` | runner |
| `#/finales` | **kept**: the runner in tabs mode over `mat-deux-tours`, `mat-dame`, `mat-tour` (same UI as v1) |
| `#/menace`, `#/puzzles` | unchanged |

**Home page changes.**
1. A new top card « Séance du jour · environ 15 min » lists the `planSeance()` items:
   - « ↺ Contrôle — Mat avec la dame »
   - « ▶ En cours — Prendre l’opposition · palier 1/2 · série ●●○ »
   - « ✦ Nouveau — Les cases clés »

   Buttons: « Commencer la séance » and « Ou choisir moi-même : Parcours › ». When nothing is due: « Tout est à jour. Prochain contrôle : jeudi (2 exercices). »
2. The checklist stays. Question 1 gets a small link « S’entraîner » to `#/drill/parer-couloir` and `#/menace`.
3. The modules list: the « Finales de base » card becomes « Parcours d’exercices », with the stat « {a} acquis, {e} en cours, {r} à revoir ». Menace and Puzzles are unchanged.
4. A collapsible « Comment ça marche ? » holds four lines:
   - « **Propre** = sans indice et dans la limite de coups. »
   - « **Acquis** = 3 parties propres d’affilée au dernier palier, dont une avec les Noirs. »
   - « **Maîtrisé** = encore propre après une nuit. »
   - « Ensuite, un contrôle de temps en temps, de plus en plus espacé. »

---

## 2. Goals, success and failure detection

### 2.1 Conventions
- **Point of view.** `analyse()` scores are from the **side to move**. After the user's move the opponent is to move, so the user's value is **`v = −line.cp`**. When the user is to move (start verification), `v = line.cp`.
- **Mates.** A mate is `cp = ±(10000 − 10·|n|)`. `isMateForUser(v) ⇔ v ≥ 9000`; `isMateAgainstUser(v) ⇔ v ≤ −9000`. If after the user's move the opponent's search reports `mate −M`, the user needs **M** more moves, so the projected total is `userMoves + M`.
- **Free verdict.** The search that picks the opponent's reply *is* the verdict. Only a suspected failure pays for an extra search.

### 2.2 Thresholds (`drill/verdict.js`, user POV, centipawns)

| Band | Used by | OK if v ≥ | LOST if v ≤ (then confirm) | Confirm |
|---|---|---|---|---|
| `win` | mate (engine oracle), promote, capture | +300 | +100 | 1200 ms, must still be ≤ +100 |
| `draw` | hold (engine oracle) | −100 | −300 | 1200 ms |
| `keep` | hold `band:'keep'` (defence twins) | E0 − 120 | E0 − 250 | 1200 ms |
| `material` | material | E0 − max(200, (E0−Ealt)/2) + 50 | E0 − max(200, (E0−Ealt)/2) | 1200 ms |
| `mateN` | mate with `n` | 9000 | 8999 (no forced mate) | 1200 ms |
| `tb` | every tb drill | exact: `probe().win` matches the goal | exact | none |

- Between OK and LOST is the **grey zone**: no verdict, play continues, and `greyMoves++` is logged.
- **Phase B overrides**, recorded here so the band machinery supports them: wrong bishop, KRKB and KRKN use OK ≥ −200 and LOST ≤ −400; multi-pawn pawn endings confirm at 2000 ms; KBNK/KBBK never judge by eval.

### 2.3 Per-move algorithm: the « ton coup laisse filer » rule

```js
async userMove(uci) {
  stopBg();                                                  // engine.stop('bg')
  const before = this.chess.fen();
  const mv = this.chess.move(toMove(uci));                   // chess.js v1 throws on illegal: let it (UI only offers legal dests)
  this.userMoves++; this.history.push({ fen: before, uci, san: mv.san, by: 'user' });
  // 1. Rules and goal milestones after the user's move (no engine)
  let o = goals[g.kind].afterUser(this, mv) ?? spec.afterUser?.(ctx, this);
  if (o) return this.end(o);
  // 2. Verdict on the position after the user's move (opponent to move)
  const j = await judge(this);                               // {cls:'ok'|'grey'|'lost', v, reply, pv, dist?}
  this.history.at(-1).v = j.v; this.history.at(-1).cls = j.cls;
  if (j.cls === 'lost') return this.end(fail(lostText(g, j)), { refutation: j.pv, keyFen: before });
  o = goals[g.kind].afterVerdict(this, j);
  if (o) return this.end(o);
  // 3. Opponent reply (tb policy or the same engine search)
  const r = this.chess.move(toMove(j.reply));
  this.history.push({ fen: this.chess.fen(), uci: j.reply, san: r.san, by: 'opp' });
  o = goals[g.kind].afterOpponent(this, r) ?? spec.afterOpponent?.(ctx, this);
  return o ? this.end(o) : { status: 'continue', reply: j.reply };
}

async function judge(st) {
  const fen = st.chess.fen();
  if (st.spec.oracle === 'tb') {
    const p = tb.probe(fen);
    const userStrong = p.strong === st.userColor;
    const ok = userStrong ? p.win : !p.win;
    return { cls: ok ? 'ok' : 'lost', v: null, dist: p.dist, reply: tbPolicy(st, fen), pv: tbLine(fen, 6) };
  }
  const T = thresholds(st);                                  // §2.2, spec.thresholds overrides
  const [l] = await ctx.engine.analyse(fen, { movetime: 300 });
  let v = -l.cp, reply = l.move, pv = l.pv;
  if (v <= T.lost) {
    const [c] = await ctx.engine.analyse(fen, { movetime: T.confirmMs ?? 1200 });
    v = -c.cp; reply = c.move; pv = c.pv;                    // a false alarm uses the deeper result
    if (v <= T.lost) return { cls: 'lost', v, reply, pv };
  }
  return { cls: v >= T.ok ? 'ok' : 'grey', v, reply, pv };
}
```

**Failure texts** (`lostText`):

| Goal | Text |
|---|---|
| win band | « Ce coup laisse filer le gain. » |
| tb, win band | « Ce coup laisse filer le gain : la position est maintenant nulle. » |
| draw band | « Ce coup perd : la nulle n’est plus là. » |
| keep | « La menace passe : ce coup ne la pare pas. » |
| material | « L’avantage a disparu. » |
| mateN | « Le mat s’est envolé. » |

Each text is followed by `explainMistake` (§5.5) when the user clicks « Pourquoi ? ».

### 2.4 Goal kinds (`drill/goals.js`)

Sentence shown in `.verdict` at the start:

| Kind | Sentence |
|---|---|
| `mate` | « Mate le roi {noir/blanc}. » |
| `mate` with `n` | « Mat en {n}. » |
| `promote` | « Va à dame en sécurité. » |
| `capture` | « Gagne le pion sans perdre ta pièce. » |
| `hold` (draw) | « Tiens la nulle pendant {n} coups. » |
| `hold` (keep) | « Que menace l’adversaire ? Pare la menace et garde ton avantage ({n} coups). » |
| `material` | « Gagne du matériel. » |

| Kind (params) | Success | Failure (in addition to the verdict in §2.3) | Clean (`C`) | Yardstick shown |
|---|---|---|---|---|
| **`mate`** `{n?, guard?:'pieces'}` | `chess.isCheckmate()` after a user move. | Stalemate. Draw by rule (threefold « Tu tournes en rond », 50 moves, insufficient material). Guard `'pieces'`: a user non-pawn piece captured, « Ta {pièce} a été prise ». Move cap `2·ref + 10` (or 40 with no ref), « Trop long ». **With `n`:** verdict band `mateN`; if `userMoves + M > n` play continues but the attempt can only be `S`; `userMoves > n + 2` → fail. | No hint; `moves ≤ ref + max(2, ⌈ref/4⌉)`. With `n`: `moves ≤ n`. | tb: « Mat en {ref} au mieux » (exact). Engine: « Mat possible en {ref} » (upper bound; a faster mate prints « Plus court que la référence : la défense n’était pas parfaite. »). Tactics: « Mat en {n} ». |
| **`promote`** | The user promotes **and** the result is won. tb: KQK/KRK probe win. Engine: `v ≥ +500` in the reply search of that move. Also success: a **won signature** after any move (no pawns, user has K+Q or K+R or more, opponent has a bare king, tb or trivially won), e.g. the defender gives up its rook. | Promotion that stalemates or hangs: verdict `lost` (exact for tb). Threefold, 50 moves, move cap. | No hint; with ref: `moves ≤ ref + max(3, ⌈ref/3⌉)`. | tb: « Promotion sûre possible en {ref} coups » (exact). Engine: none in Phase A (par values are Phase B). |
| **`capture`** | The opponent has no pawns left, the user keeps its piece, and the pawnless position is a tb win. Or mate. | As `promote`. | No hint, within the cap. | none (Phase B `par`) |
| **`hold`** `{n, band:'draw'\|'keep'}` | `userMoves ≥ n` with no `lost` verdict. **Early success:** a stalemate where the user is the side without moves; threefold; 50 moves; insufficient material; a pawnless position with identical piece sets (KRKR, KQKQ, …); a KPK the table rates a draw; plus `spec.afterUser`/`afterOpponent` (e.g. the king reaches the corner). | Mated (`isCheckmate` with the user to move). | No hint. | « Tiens {n} coups » plus the counter |
| **`material`** `{gain, within}` | After the opponent's reply: `d = balance(user) − M0 ≥ gain` **and** `v ≥ Ealt + 150`, where the second condition blocks a gain that is about to be lost back. Any checkmate by the user is a success. | `userMoves ≥ within` and not yet success: if `v ≥ Ealt + 250 && d ≥ 1` the attempt ends as `S` « autre chemin », otherwise as a fail « Trop lent ». Mated → fail. | No hint, `moves ≤ k + 1`. | « Gain optimal : +{G} en {k} coup(s) » (k = first user move of the verification PV where Δ ≥ G) |

### 2.5 Generic end conditions (checked in this order after every half-move)
1. **`isCheckmate()`.** The user delivered mate: success for every goal. The user is mated: fail.
2. **`isStalemate()`.** Fail for `mate`/`promote`/`capture`/`material`; success for `hold`.
3. **`isInsufficientMaterial()`.** In `mate`, the user's last piece is gone: fail « Ta pièce a été prise ». In `hold`: success.
4. **`isThreefoldRepetition()`.** Attacking goals fail « Tu tournes en rond ». `hold` succeeds.
5. **`isDrawByFiftyMoves()`.** Attacking goals fail; `hold` succeeds.
6. Goal-specific milestones (§2.4), then the verdict, then the move cap.

### 2.6 Opponent policy
- **tb drills:** `tb-stubborn` when the user attacks, `tb-trap` when the user defends (§1.3).
- **Engine drills:** the reply from the verdict search (300 ms), or the confirm search if one ran.
- The opponent never resigns. A « spite » capture can only *increase* `d` in material drills, and the `v ≥ Ealt + 150` clause prevents a false success.

---

## 3. Catalogue

### 3.0 Shared rules

**3.0.1 Notation.**
- Squares are (file a–h, rank 1–8) from White's side.
- `d(x,y)` is the king distance (Chebyshev).
- Where a rule says "canonical", the user plays `userSide`. Mirror always applies at random, and the colour swap applies per §4.2.

**3.0.2 S0 sanity filter** (`drill/s0.js`, for every candidate):
- `new Chess(fen)` succeeds.
- The side not to move is not in check: `new Chess(nullMoveFen(fen)).isCheck() === false`.
- Not game over.
- The side to move is not in check, unless `s0.allowCheck`.
- No capture is available to the side to move, unless `s0.allowCaptures`. Tactics drills set `allowCaptures: true`, since their key move is often a capture.
- No pawns on ranks 1 or 8.
- Castling `-`, en passant `-`, halfmove 0.

**3.0.3 Inert noise** (`drill/noise.js`, tactical levels L2–L3). This is the tactics researcher's measured rule.
- **A unit** is either:
  - a **ram**: a white pawn on (f, r) and a black pawn on (f, r+1), r ∈ 2…6; or
  - a **pair**: one N, B or R per side, of the same type, on free squares.
- **Footprint:** the generator returns it (motif pieces, key path, lines between motif pieces, the 3×3 box around the target king, the mating squares). Units never land on it.
- **A unit is kept only if,** after placement, the position is legal and every new piece:
  - is not attacked by the other side;
  - does not attack any enemy piece;
  - does not attack any footprint square.
- At most 200 placement trials. Material stays balanced.

**3.0.4 Variety.**
- `strata(level)` lists sub-cases (target type, pawn file, side, direction). The runner draws them from a shuffled bag, refilled when empty.
- After a failure, « Position équivalente » reuses the same `sub` with a new symmetry.
- The anti-repeat memory holds the last 30 canonical placements per drill, in memory for the page session.

**3.0.5 Verification library** (`drill/verify.js`). Each entry returns `Verified` or `null`.
- **`V.attackWin({min=300})`.** `analyse(fen,{movetime:300}).cp ≥ min` **and** `analyse(fen,{movetime:1000}).cp ≥ min`. Sets `E0`.
- **`V.holdDraw({a=50, b=100})`.** `|cp| ≤ a` at 300 ms **and** `|cp| ≤ b` at 1000 ms.
- **`V.engineMate({min=1, max})`.** `movetime 1500`. Requires `mate` in [min, max]. Sets `ref = mate`.
- **`V.tb(pred)`.** `pred({probe, rank, fen, level, sub})` must be true. Sets `ref = probe.dist` (win) or `null` (hold).
- **`V.mat({gap=250, floor=-50})`** (tactics).
  1. `analyse(fen,{depth: L<1?10:12, movetime:1500, multipv:2})`.
  2. Require `best.move === key` (or ∈ `keySet`), `best.mate == null || best.mate <= 0` (no mate for the user), `best.cp ≥ floor` and `best.cp − (second?.cp ?? −10000) ≥ gap`.
  3. Stability: the same best move at depth D−2.
  4. Sets `E0 = best.cp`, `Ealt = second.cp ?? −10000`, `pv`, and `k` for the yardstick: walk the PV with chess.js to the first user move after which Δ ≥ gain.
- **`V.mate({n})`.** `depth 10` (n = 1) or `12` (n ≥ 2), `multipv 2`. Requires `best.mate === n`, `best.move === key`, and the second line not a mate in ≤ n (a unique first move).
- **`V.def({tol=80, maxShare=0.5})`** (defence twins).
  1. Null-move position `nullMoveFen(fen)`, depth 10: the best line must be `mate === 1` (the threat is real). Store `roles.threat = line.move`.
  2. `analyse(fen,{depth:10, multipv: min(legal,30)})`: require `best.cp ≥ −100` and `best.mate` not > 0 (the user has no mate of their own).
  3. Acceptable set A = lines with `cp ≥ best.cp − tol`; require `|A| ≤ maxShare · legal`.
  4. `E0 = best.cp`.

**3.0.6 Seeds.**
- `tools/build_drills.mjs` writes `data/drills/<id>.json` by running the drill's own `generate`/`verify` in Node with long budgets.
- **Phase A ships no seed file by default.** A seed pool is created for a drill or level only when the Node harness (§6) measures runtime acceptance below 2 % for it. The rare KPK only-move levels are the likely candidates.

### 3.1 Track `mats` « Mats de base » (5 drills, Phase A)

**M1 · `mat-deux-tours` « Deux tours »** · A
- **Setup:** user W · oracle engine · goal `mate {guard:'pieces'}` · `flip:true` · need 3 · prereq none.
- **Levels:** a single level, « Position au hasard ». Generation is the existing `randomPosition(['R','R'])`: Black king not on the edge, kings not adjacent, no white piece offered to the king.
- **Verify:** `V.engineMate({max: 10})`. The mate was found in 10/10 samples, identical at 1.5 s and 8 s.
- **Yardstick:** engine mate. **Verdict band:** `win` (backstop).
- **Tip:** the current one.
- **Ideas:** `ladder`, `rook-far`, `box-shrink`.

**M2 · `mat-dame` « Dame »** · A
- **Setup:** user W · oracle tb · goal `mate` · `flip:true` · need 3 · prereq none.
- **Levels by exact mate distance** (backward chaining):

  | Level | Label | Mate distance | Placement |
  |---|---|---|---|
  | L1 | « Le filet final » | 1–3 | Black king may stand on the edge |
  | L2 | « Le dernier carré » | 4–6 | Black king may stand on the edge |
  | L3 | « Partie complète » | any | existing `randomPosition(['Q'])` |

- **Generate:** random K, Q, k satisfying S0 (the queen not adjacent to the Black king unless defended).
- **Verify:** `V.tb(p => p.win && inBand(p.dist))`.
- **End:** exact. A hanging queen is caught at once because the tb probe says draw. The opponent captures and the reason shown is « Ta dame est en prise ».
- **Tip:** the current one.
- **Ideas:** `knight-jump`, `box-shrink`, `kqk-edge`, `stalemate-danger`, `mate-every-reply`.

**M3 · `mat-tour` « Tour »** · A
- **Setup:** user W · oracle tb · goal `mate` · `flip:true` · need 3 · prereq none.
- **Levels:** mate distance 1–3 / 4–7 / 8–11 / L4 « Partie complète » = existing `randomPosition(['R'])`.
- **Verify, end:** as M2. This fixes the « Calcul du mat optimal… » hang.
- **Tip:** the current one.
- **Ideas:** `cut`, `opposition-check`, `waiting`, `approach-opp`, `rescue`, `preemptive-flee`, `box-shrink`.

**O1 · `mat-dame-pions` « Mat à la dame, pions bloqués »** · A
- **Setup:** user W · oracle engine · goal `mate {guard:'pieces'}` · `flip:true` · prereq `mat-dame` · covers `mat-dame`.
- **Generate:** K+Q against K plus k locked pairs, k = 1 / 2 / 3 at L1 / L2 / L3.
  - A pair is a white pawn on (f, r) and a black pawn on (f, r+1), r ∈ 2…6.
  - No diagonal contact between enemy pawns, so no pawn capture is possible.
  - d(Black king, every white pawn) ≥ 3; d(kings) ≥ 2.
  - Queen not adjacent to the Black king; Black king not in check; White to move.
- **Verify:** `V.engineMate({min:3, max:15})`. About 90 % accepted (7/8).
- **End:**
  - Stalemate is the main lesson.
  - If the Black king captures a white pawn, play continues with the event text « Le pion noir est libéré. ».
  - Verdict band `win` as a backstop.
- **Yardstick:** engine mate.
- **Tip:** « Les pions bloqués volent des cases au roi… et des coups : le pat arrive plus vite, vérifie-le avant chaque coup calme. »
- **Ideas:** `stalemate-danger`, `box-shrink` (black pawns count as walls), `knight-jump`.

**O2 · `mat-tour-pions` « Mat à la tour, pions bloqués »** · A
- As O1 with a rook. Prereq `mat-tour`, `mat-dame-pions` · covers `mat-tour`.
- **Verify:** `V.engineMate({min:3, max:20})`, about 75 % accepted.
- **Tip:** « Un pion peut couper ta tour : choisis des colonnes et rangées libres pour enfermer le roi. »
- **Ideas:** `cut` (the line must be free of pawns), `box-shrink`, `opposition-check`.

### 3.2 Track `pions` « Finales de pions » (6 drills, Phase A, oracle tb, no engine)

**Shared rules.**
- Generation is random constrained placement plus a predicate on `probe`/`rankMoves`; budget 3000 tries.
- **Ideal family:** every winning (or drawing) first move in the predicate is counted with `rankMoves`.
- **Opponent:** `tb-stubborn` for P2/P3/P4; `tb-trap` for P1/P5/P6.
- **Yardstick:** distance to safe promotion (attack) or the hold counter (defence).
- **Promotion** goes through the picker; the table rates a queen that stalemates as a draw.

**P1 · `pion-carre` « La règle du carré »** · A
- **Setup:** user B · goal `hold {n:8, band:'draw'}`, with early success when the pawn is captured · `flip:true` · prereq none.
- **Generate:** Black to move, table = draw.
  - d(White king, pawn) ≥ 4 and d(White king, promotion square) ≥ 3, so the white king cannot help.
  - d(Black king, pawn) ≥ 3.
  - At least one legal Black move loses, which keeps the drill non-trivial.
- **Levels:**
  - L1: pawn ranks 3–6.
  - L2: ≤ 2 drawing moves; pawn ranks 2–6 (includes the double step). 3,956 such positions exist.
- **Tip:** « Trace le carré du pion jusqu’à la promotion : si ton roi peut y entrer, il le rattrape (pion sur sa case de départ : compte depuis la 3e rangée). »
- **Ideas:** `enter-square`, `diagonal-walk`.

**P2 · `pion-roi-devant` « Le roi devant le pion »** · A
- **Setup:** user W · goal `promote` · `flip:true` · prereq none.
- **Generate:** White to move, win.
  - Pawn on files b–g.
  - rank(White king) > rank(pawn) and |file difference| ≤ 1.
  - d(Black king, promotion square) ≤ 3.
  - Distance to safe promotion 4–9.
- **Levels:** L1 ≥ 2 winning first moves; L2 exactly 1.
- **Tip:** « Le roi devant, le pion derrière : ton roi ouvre la route, le pion ne monte que lorsque la case devant lui est à toi. »
- **Ideas:** `king-in-front`, `opposition`, `stalemate-danger` (promotion).

**P3 · `pion-opposition` « Prendre l’opposition »** · A
- **Setup:** user W · goal `promote` · `flip:true` · prereq `pion-roi-devant`.
- **Generate:** pawn on files b–g, ranks 2–5; d(White king, pawn) ≤ 2; d(Black king, White king) ≤ 3. White to move, win.
- **Levels:**
  - L1: **exactly one winning move**, a king move after which `opposition(WK', BK) === 'direct'` with Black to move. 1,178 such positions exist.
  - L2: exactly one winning move, any king move (includes outflanking). 3,182 such positions exist.
- **Tip:** « Rois face à face, une case entre eux : celui qui n’a PAS le trait a l’opposition ; prends-la, puis déborde. »
- **Ideas:** `opposition`, `outflank`, `waiting` (pawn tempo).

**P4 · `pion-cases-cles` « Les cases clés »** · A
- **Setup:** user W · goal `promote` · `flip:true` · prereq `pion-opposition`.
- **Generate:** White to move, win.
  - Pawn on ranks 2–4, files b–g.
  - White king not on a key square, and d(White king, nearest key square) ≥ 2.
  - Distance to safe promotion ≥ 6.
- **Levels:** L1 ≥ 2 winning moves; L2 exactly 1.
- **Overlay with hint L1:** the key squares (`mark-key`).
- **Tip:** « Pion sur la 2e, 3e ou 4e rangée : vise les trois cases deux rangées devant lui ; ton roi dessus = gagné. »
- **Ideas:** `key-square`, `king-first`, `opposition`.

**P5 · `pion-defense` « Tenir la nulle »** · A
- **Setup:** user B · goal `hold {n:10, band:'draw'}`, with early success on pawn captured, stalemate or threefold · `flip:true` · prereq `pion-opposition`.
- **Generate:** Black to move, draw; files b–g; d(White king, pawn) ≤ 2; d(Black king, pawn) ≤ 3.
- **Levels:** L1 ≥ 2 drawing moves; L2 exactly 1 (2,584 positions).
- **Tip:** « Reste devant le pion ; repoussé, recule tout droit sur sa colonne pour reprendre l’opposition. »
- **Ideas:** `def-front`, `def-straight`, `opposition`.
- **Contrast:** `pion-roi-devant`.

**P6 · `pion-tour` « Le pion de la tour »** · A, defender version only
- **Setup:** user B · goal `hold {n:8, band:'draw'}` · `flip:true` · prereq `pion-defense`.
- **Generate:** a- or h-pawn; Black to move, draw; d(Black king, promotion corner) ≤ 3, not already in the corner zone.
- **Levels:** L1 ≤ 3 drawing moves and ≥ 1 losing move; L2 exactly 1 drawing move (1,548 positions).
- **`afterUser`:** success when the Black king stands in {promotion square and its 3 neighbours on the last two ranks} and the table says draw.
- **Mirror only;** never translated.
- **Tip:** « Pion de la tour : si le roi adverse atteint le coin, c’est nulle ; pour gagner, ton roi doit l’enfermer hors du coin. »
- **Ideas:** `rook-pawn-corner`.

### 3.3 Track `pieces` « Pièce contre pion » (3 drills, Phase A, oracle engine)

**Q1 · `dame-contre-pion` « Dame contre pion en 7e »** · A
- **Setup:** user W · goal `capture` (or mate) · move cap 40 · `flip:true` · prereq `mat-dame`, `pion-roi-devant` · contrast `dame-contre-pion-nulle`.
- **Generate:**
  - Black pawn on rank 2, file ∈ {b, d, e, g} (the stratum).
  - Black king adjacent to the pawn, on ranks 1–3.
  - Queen not adjacent to the Black king, no check, White to move.
- **Levels:** d(White king, pawn) ∈ 4–5 (L1) / 6–7 (L2).
- **Verify:** `V.attackWin()`. 24/24 samples were wins.
- **Tip:** « Échecs et clouages pour forcer le roi devant son pion ; chaque fois, ton roi gagne un pas. »
- **Ideas:** `in-front` (queen check or pin forces the king onto the queening square), `approach`.

**Q2 · `dame-contre-pion-nulle` « Dame contre pion fou ou tour : la défense par le pat »** · A
- **Setup:** user B · goal `hold {n:12, band:'draw'}` · `s0.allowCheck:true` · `flip:true` · prereq `dame-contre-pion`.
- **Generate:** pawn on rank 2; Black king adjacent to it on ranks 1–3; d(White king, pawn) ≥ 5; Black to move.
- **Levels:** pawn file a/h (L1, « le coin ») / c/f (L2, « abandonne le pion : le prendre serait pat »).
- **Verify:** `V.holdDraw()`. About 63 % accepted; draws measured 0.00…+0.70, wins ≥ +7.9.
- **Early success also:** a pawnless position with identical piece sets (e.g. KQKQ after promotion).
- **Tip:** « Pion fou ou tour sur la 7e : file dans le coin, prendre ton pion serait pat. »
- **Ideas:** `stalemate-defence`, `rook-pawn-corner`.

**R1 · `tour-contre-pion` « Tour contre pion : gagner »** · A
- **Setup:** user W · goal `capture` · move cap 40 · `flip:true` · prereq `mat-tour`, `pion-carre`.
- **Generate:**
  - Black pawn on ranks 3–5, any file; d(Black king, pawn) ≤ 2.
  - Rook not attacked by the king or the pawn; no capture available (S0); White to move.
- **Levels:**
  - L1: pawn on ranks 4–5, d(White king, pawn) 3–4.
  - L2: pawn on ranks 3–5, d(White king, pawn) 3–6.
- **Verify:** `V.attackWin()`. About 50 % accepted; draws read 0.00, wins ≥ +4.1.
- **Tip:** « Coupe le roi adverse avec ta tour, puis ramène ton roi devant le pion. »
- **Ideas:** `cut`, `king-in-front`, `rook-behind`.

### 3.4 Track `tours` « Finales de tours » (2 drills, Phase A, oracle engine)

**R3 · `lucena` « La position de Lucena »** · A
- **Setup:** user W · goal `promote` · move cap 30 · `flip:true` · prereq `tour-contre-pion` · contrast `philidor`.
- **Generate:**
  - Pawn file p ∈ b…g; pawn on (p, 7); White king on (p, 8). Side s = ±1 (the stratum).
  - White rook on file p + s, ranks 1–5.
  - Black rook on file p − k·s with k = 1–3, ranks 1–6.
  - White not in check; no captures; White to move.
- **Levels:** Black king on file p + 3s (L1, cut off by 2 files) / p + 2s (L2, cut off by 1 file), ranks 6–8.
- **Verify:** `V.attackWin()`. 30/30 samples were wins, measured +4.09…mate.
- **Success also:** when the defender gives up its rook for the pawn (KRK, won signature).
- **Tip:** « Construis le pont : tour sur la 4e rangée, le roi sort, la tour s’interpose contre les échecs. »
- **Ideas:** `lucena-cut`, `lucena-bridge`, `lucena-out`, `lucena-block`.

**R4 · `philidor` « La défense Philidor »** · A
- **Setup:** user B · goal `hold {n:15, band:'draw'}` · `flip:true` · prereq `lucena` · contrast `lucena`.
- **Generate:**
  - White pawn on (p, 5), p ∈ b…g.
  - White king on ranks 4–5, within 1 file of the pawn.
  - Black king on files p−1…p+1, ranks 7–8.
  - White rook anywhere.
  - No captures for either side (also checked on the null-move position); Black not in check; Black to move.
- **Levels:** Black rook on rank 6 (L1) / ranks 7, 8, 1 or 2 (L2; the user must set up the defence).
- **Verify:** `V.holdDraw()`. Measured: correct setups read 0.00…0.04, lost ones −4.4…mate.
- **Early success also:** a KPK the table rates a draw; KRKR.
- **Tip:** « Tour sur ta 3e rangée tant que le pion n’y est pas ; s’il y avance, tour au fond et échecs par derrière. »
- **Ideas:** `philidor-third`, `philidor-behind`, `def-front`.

### 3.5 Track `tactique` « Motifs tactiques » (4 drills, Phase A)

**Shared rules.**
- Oracle engine; user W canonical; `s0.allowCaptures:true`; `flip:true` (top level); need 5.
- **Levels:** L1 template only; L2 plus 3–5 inert noise units; L3 plus 5–8 units.
- **Verify:** `V.mat` (depth 10 at L1, 12 at L2–L3).
- **Hint stage texts** come from `roles` (§5.4).

**T1 · `piece-en-prise` « Pièce en prise »** · A
- **Setup:** goal `material {gain: V(X), within: 2}` · prereq none.
- **Generate** (prototyped):
  - White king on ranks 1–2, Black king on ranks 7–8, d(kings) ≥ 2.
  - Target X ∈ {n, b, r, q} (the stratum) on ranks 3–6, **not attacked by Black**.
  - Attacker Y ∈ {N, B, R, Q} on a square attacking X with a clear path.
  - **Decoys** (0 at L1, 1 at L2, 1–2 at L3): a black minor piece on files b–g, ranks 3–6, defended by a black pawn diagonally behind it and attacked by a white Q or R. Taking it loses material.
  - No white piece is attacked at the start; Black not in check.
- **Verify:** `V.mat({gap: 200})`. Measured acceptance: 21 % with no decoy, 25 % with 1 decoy, 6 % with 2 decoys; median 11–20 ms per check in Node.
- **Ideas:** `hanging-take`.

**T2 · `fourchette-cavalier` « Fourchette royale du cavalier »** · A
- **Setup:** goal `material {gain: V(T) − 3, within: 3}` (queen → 6, rook → 2) · prereq `piece-en-prise`.
- **Generate** (prototyped):
  - Black king on files b–g, ranks 2–7.
  - Fork square f = king + a knight vector.
  - Target T ∈ {q, r} on f + another knight vector (≠ king).
  - White knight on f + a third knight vector.
  - White king at d ≥ 2 from the Black king.
  - **f not attacked by Black.**
- **Strata:** T × {centre, edge}.
- **Measured acceptance:** 60 % at L1, 68 % with inert noise. Material was banked at user move 2 in 12/12 play-outs.
- **Ideas:** `fork`.

**T3 · `enfilade` « Enfilade »** · A
- **Setup:** goal `material {gain: 4, within: 3}` · prereq `piece-en-prise`.
- **Generate** (prototyped):
  - Black king and queen on one rank or file, line index 2–7, gap 1–3.
  - Checking square cs on the other side of the king, at distance 2–4.
  - White rook on the perpendicular through cs, at ≥ 2 from cs, path clear; the path cs→king is clear.
  - **cs not attacked by Black.**
  - White king at d ≥ 2.
- **Strata:** horizontal/vertical × gap 1 / ≥ 2.
- **Measured acceptance:** 32 % at L1, 65 % with inert noise; banked at move 2 in 12/12.
- **Ideas:** `skewer`.

**T4 · `clouage` « Exploiter le clouage »** · A
- **Setup:** goal `material {gain: 2, within: 3}` · prereq `piece-en-prise`.
- **Generate** (prototyped):
  - Black king on files c–f, ranks 6–8.
  - Pinned piece P ∈ {n, r} at distance 1–2 from the king along a down-diagonal; a white bishop 1–3 squares further along it. **Never a pinned queen.**
  - A white pawn on (file(P) ± 1, rank(P) − 2), on rank ≥ 2, pushing to (file(P) ± 1, rank(P) − 1). The push square is not attacked by Black, or is defended by White.
  - White king at d ≥ 2.
- **Measured acceptance:** 17 % at L1, 15 % with inert noise. The eval-confirmed `within` fallback in §2.4 is needed (1 in 12 play-outs took another route).
- **Ideas:** `pin`.

### 3.6 Track `images` « Images de mat » (3 drills, Phase A)

**Shared rules.**
- Oracle engine; user W canonical; `flip:true`; goal `mate {n}`.
- **Generation recipe:** take the final picture, remove the mating piece, put it back on a random origin with a clear path that does not already give check.
- **Verify:** `V.mate({n})`.
- **Levels:** L1 isolated picture; L2 plus 3–5 inert noise units.

**I1 · `mat-couloir` « Mat du couloir »** · A
- **Setup:** need 3 (the top level is a mate in 2) · prereq none · contrast `parer-couloir`.
- **L1/L2, mate in 1:**
  - Black king on rank 8, with black pawns on its file and the adjacent files of rank 7.
  - White R (70 %) or Q on a file at least 2 files away from the Black king's file, ranks 2–5, clear path to rank 8.
  - White king on rank 1, each shell pawn on rank 2 present with probability 0.7.
  - Measured: 88 % at L1, 88 % with noise.
- **L3, mate in 2** (constructive, prototyped at 19 % raw, about 0.14 s per accepted position):
  - A black defender (r 2/3, q 1/3) on rank 8, not on the king's file.
  - Attack file at least 2 files from the king's file and different from the defender's file.
  - 60 % of the time doubled heavy pieces on that file; otherwise two files.
  - The second line must not be a mate in ≤ 2.
- **Tip:** « Roi enfermé derrière ses pions sur la dernière rangée : une tour ou une dame qui y arrive mate. »
- **Ideas:** `mate`, `deflection` (L3).

**I2 · `mat-etouffe` « Mat à l’étouffée »** · A
- **Setup:** need 3 · prereq `mat-couloir`.
- **L1/L2, mate in 1:**
  - Black king h8; a black piece on g8 ∈ {r, r, b, n}; black pawns g7 and h7.
  - The white knight's origin is a random empty knight-neighbour of f7.
  - White king on ranks 1–3; f7 not attacked by Black.
  - 100 % accepted at L1 and with noise.
- **L3, « Le legs de Philidor », mate in 2** (constructive, my prototype 30 accepted out of 32 checks, about 94 %):
  - Black king h8, pawns g7 h7, White knight h6.
  - Black rook on a8–f8 with a clear path to g8.
  - White queen on {a2, b3, c4, d5, e6}, with a clear diagonal to g8 and not attacked.
  - White king plus shell; 0–2 black ballast pawns on ranks 5–6.
  - Key Qg8+ (forced Rxg8), then Nf7#.
- **Tip:** « Un roi bloqué par ses propres pièces : un échec de cavalier suffit. »
- **Ideas:** `mate`, `attraction` (L3).

**I3 · `mat-dame-fou` « Batterie dame-fou sur h7 »** · A
- **Setup:** need 5 (every level is a mate in 1) · prereq `mat-couloir`.
- **Picture:**
  - Black king g8, rook f8, pawns f7 g7; a black pawn on h7 with probability 0.5 (then the key is Qxh7#).
  - White bishop on the b1–h7 diagonal (b1…f5) with a clear path to h7.
  - White queen origin on any line to h7 with a clear path, not on the bishop's path.
  - White king g1 with shell pawns.
- **Verify:** 8/8 accepted in the tactics researcher's test. The key must be unique.
- **Level L3:** L2 noise plus 5–8 units.
- **Tip:** « Dame et fou sur la même diagonale visent h7 : la dame mate, protégée par le fou. »
- **Ideas:** `mate`, `battery`.

### 3.7 Track `vigilance` « Vigilance » (1 drill, Phase A): checklist question 1 as a play-out

**V1 · `parer-couloir` « Pare le mat du couloir »** · A
- **Setup:** user W · goal `hold {n:3, band:'keep'}` · need 3 · `flip:true` · prereq `mat-couloir` · contrast `mat-couloir`.
- **Generate** (prototyped):
  - White king on rank 1, file b–g, with 3 unmoved shell pawns on rank 2.
  - Black king on rank 8 with 0–3 shell pawns.
  - A black heavy piece (r, r, q) on a file at least 2 files from the white king's file, ranks 3–7, with a clear path to rank 1.
  - A white rook on ranks 3–7, not attacked; the black heavy piece is not attacked by White.
- **Levels:** L1 isolated; L2 plus 2–4 inert noise units (the footprint includes rank 1, the threat file and the white king box); L3 plus 4–6 units.
- **Verify:** `V.def()`. Measured 63 % acceptance before the « user has no mate of their own » filter, which is now mandatory. The acceptable sets were 1–10 moves out of 18–22.
- **Event text at the start:** « Que menace son dernier coup ? » (checklist question 1). The threat is stored in `roles.threat` for the hint and the explanation.
- **Tip:** « Avant de jouer ton plan, regarde si sa tour ou sa dame peut arriver sur ta première rangée. »
- **Ideas:** `parry-threat`, `luft`.

**Phase A total: 24 drills.**
- 5 mates
- 6 pawn endings (tables)
- 3 piece-against-pawn
- 2 rook endings
- 4 tactical motifs
- 3 mating pictures
- 1 vigilance

### 3.8 Phase B (specified enough to schedule; not built now)

| Drill (endgame research id) | What is needed |
|---|---|
| `pion-opposition-lointaine` (P7, 98 table positions) | Only a variety concern: add colour flip and locked-pawn variants verified offline |
| `pion-tour-gain` (rook pawn, attacker) | Same generator as P6 with White to move |
| `pions-lies` (P14) | Engine, v ≥ +500; low risk |
| `tour-contre-pion-nulle` (R2), `pion-a7` / `a7-defense` (R6/R6b), `fou-mauvais-coin` (B1/B1b), `tour-fou` (B2), `tour-cavalier` (B3), `cavalier-pion` (B4) | Runtime engine, low risk. B1–B3 need the −200/−400 override |
| `couper-roi` (R7), `cote-court` (R5) | Long games; R5 needs a multipv « non-trivial » filter offline |
| `trebuchet` (P8), `percee` (P10, 13 % acceptance), `echanger-pour-gagner` (C3) | Offline seed banks |
| `pion-eloigne` (P9), `pion-protege` (P11) | 2000 ms confirmation; 13 % grey-zone moves |
| `convertir-tour` / `convertir-mineure` (C1/C2) | Engine, low risk; yardstick `par` |
| `kbbk`, `kbnk-*` | Verdict by material, stalemate and the 50-move rule only. KBNK yardstick via an offline 4-piece solver |
| `vancura` (R8) | Engine, medium risk |
| `par` yardsticks for Q1/R1/Lucena | `tools/build_drills.mjs` engine self-play bank |
| Tactics: fork without check, pawn fork, queen fork, relative skewer, pin to win, discovered attack/check, double check, x-ray, remove the defender, deflection, attraction, overload, trapped piece, pawn breakthrough | Same machinery; most need constructive N3 or offline pools |
| The other 20 mating pictures (Anastasia, Arabian, Boden, …) | Same retro recipe; 8/8 accepted for most |
| Vigilance: `case-sure` (Q2), `ce-que-protegeait` (Q3), `huit-coups-sans-gaffe`, plus the blunder classifier Q1/Q2/Q3 shown on the home checklist | `searchmoves` labelling, SEE |
| Rung « En partie » | Lichess puzzles 400–1800 by theme with `first`/`pic` features (extend `build_puzzles.py`) |
| Chrono rung; Démo/Défilé (optimal lines with captions); trap-setting engine attacker in hold drills; « Identifie d’abord » in Mélange; per-move debrief strip; contrast « fake motif » positions (V-TRAP) | — |

---

## 4. Progression

### 4.1 Result codes and the attempt record

`summary()` returns:

```js
{ id, level, color, reached, moves, ref, hints, hintMax, secs, retry, abandoned, keyFen, fromErr }
```

- `keyFen` is the FEN before the losing move (F), or before the worst move (S).
- `fromErr` is set when the position came from `r.err`.

```js
export function outcome(spec, a) {
  if (a.retry) return 'R';                               // « Recommencer », « Reprendre avant l’erreur », « Rejouer depuis le moment clé »
  if (a.abandoned) return a.moves ? 'A' : null;          // left before the first move: not recorded
  if (!a.reached) return 'F';
  if (a.hints) return 'H';
  return isClean(spec.goal, a) ? 'C' : 'S';              // clean rules: §2.4 table
}
const slackMate = r => Math.max(2, Math.ceil(r / 4)), slackPromo = r => Math.max(3, Math.ceil(r / 3));
```

Only `C` counts toward mastery. `S`, `H`, `F` and `A` reset the clean streak. `R` is logged and nothing else.

### 4.2 Levels (staircase) and colour
- **Moving between levels:**
  - up one level after **3 consecutive `C` at the current level**;
  - while `fast` (until the first `F`/`A` on this drill), **1 `C`** is enough;
  - down one level after an `F` or `A`;
  - `S`/`H` reset the up-counter only.
- **Acquired drills** (`acq`, `mast`, `rusty`) always play the top level, and the staircase is frozen.
- **Colour:** below the top level the user plays `userSide`. At the top level of a `flip` drill the colour is 50/50. When `streak === need − 1` and `var !== 3`, the missing colour is forced.

```js
function stepLevel(spec, r, o, played) {
  const top = spec.levels.length - 1;
  if (!(r.st === 'new' || r.st === 'learn') || played !== r.level) return;
  if (o === 'C') { if (++r.up >= (r.fast ? 1 : 3) && r.level < top) { r.level++; r.up = 0; r.streak = 0; r.var = 0; } }
  else if (o === 'F' || o === 'A') { r.fast = false; r.up = 0; r.level = Math.max(0, r.level - 1); }
  else r.up = 0;
}
```

### 4.3 Mastery state machine

```
new ─1st attempt─▶ learn ─(top level, streak ≥ need, colours covered if flip)─▶ acq
acq ─first attempt on a later day, ≥12 h after acqAt, C─▶ mast
acq ─that check gives F/A/H─▶ learn (need = 2)
mast ─scheduled check: C → box+1 ; S → box unchanged ; F/A/H → rusty (box −2, need = 2)
rusty ─2 consecutive C─▶ mast (keeps the reduced box)
```

```js
const I = [1, 3, 7, 14, 30, 60, 120], DAY = 864e5, H12 = 12 * 36e5, jitter = () => 0.9 + Math.random() * 0.2;

export function record(s, spec, a, now = Date.now()) {
  const r = (s.drills[spec.id] ||= fresh()), o = outcome(spec, a); if (!o) return null;
  r.n++; r.last = now; pushLog(s, [now, spec.id, o, a.level, a.moves ?? null, a.ref ?? null, a.hints || 0, Math.round(a.secs || 0), a.color]);
  if (o === 'R') return o;
  if ('CSH'.includes(o)) r.ok++;
  r.hist = (r.hist + o).slice(-20);
  const top = spec.levels.length - 1;
  if (o === 'C') { r.clean++; r.streak++; r.var |= a.color === 'b' ? 2 : 1;
                   if (a.level === top && a.moves && (r.best == null || a.moves < r.best)) r.best = a.moves; }
  else { r.streak = 0; r.var = 0; }
  if ((o === 'F' || o === 'S') && a.keyFen) r.err = dedupe([...r.err, { fen: a.keyFen, level: a.level, sub: a.sub }]).slice(-10);
  if (o === 'C' && a.fromErr) r.err = r.err.filter(e => e.fen !== a.fromErr);
  stepLevel(spec, r, o, a.level);
  if (r.st === 'new') r.st = 'learn';
  if (r.st === 'learn' || r.st === 'rusty') promote(s, spec, r, now); else check(r, o, now);
  if (o === 'C') for (const x of spec.covers || []) refresh(s.drills[x], now);
  return o;
}
function promote(s, spec, r, now) {
  const top = spec.levels.length - 1, need = r.need ?? spec.need ?? 3;
  if (r.level !== top || r.streak < need || (spec.flip && r.var !== 3)) return;
  if (r.st === 'rusty') r.st = 'mast'; else { r.st = 'acq'; r.acqAt = now; r.box = 0; }
  r.need = null; r.chk = dayStr(now); r.lastChk = now; r.due = now + I[r.box] * DAY * jitter();
  for (const x of spec.covers || []) place(s, x, now);           // covered drill → acq, placed: true, level top
}
function check(r, o, now) {
  if (r.chk === dayStr(now)) return;                             // only the first attempt of the day is a check
  const elapsed = now - r.lastChk; r.chk = dayStr(now); r.lastChk = now;
  if (o === 'C') {
    if (r.st === 'acq' && now - r.acqAt >= H12) { r.st = 'mast'; r.mastAt = now; }
    if (elapsed >= 0.5 * I[r.box] * DAY) r.box = Math.min(r.box + 1, I.length - 1);
  } else if (o !== 'S') {
    r.lapses++; r.box = Math.max(0, r.box - 2); r.streak = 0; r.var = 0; r.need = 2;
    r.st = r.st === 'acq' ? 'learn' : 'rusty';
  }
  r.due = now + I[r.box] * DAY * jitter();
}
const refresh = (x, now) => { if (x && (x.st === 'acq' || x.st === 'mast')) { x.lastChk = now; x.due = Math.max(x.due, now + I[x.box] * DAY); } };
```

**Expected effort.** With a true clean rate p = 0.8, reaching Acquis takes about 4.8 attempts for need 3 and about 10.2 for need 5, plus the level climb. This matches the user's « une dizaine de parties ».

### 4.4 Review scheduling
- **Intervals:** `DRILL_INTERVALS` 1, 3, 7, 14, 30, 60, 120 days, ±10 % jitter.
- **A check** is a freshly generated top-level position, so it cannot be memorised.
- **Implicit review:** a clean game of a drill pushes back the due date of each drill in its `covers` (e.g. `mat-dame-pions` covers `mat-dame`).
- **Never schedule a drill** whose acquired coverer exists.
- **At most 3 checks per séance;** the rest roll over.
- **A Mélange item** that is the first attempt of the day on its drill is a check and goes through `check()`.

### 4.5 Gating (soft)
- **Everything is playable.**
- **Recommended:** a drill is « recommandé » when every `prereq` is `acq`, `mast` or `rusty`.
- **Not yet recommended:** the drill is shown dimmed. Clicking it asks « Il te manque : {titres}. Essayer quand même ? » with the buttons « Oui » and « Retour au parcours ».
- **Placement:** Acquis on a drill credits the drills it `covers` (`placed: true`), so a strong player tests out of earlier steps.
- **Only hard gate:** « Mélange » needs ≥ 3 drills `acq` or better.
- **Concurrency:** the planner introduces a new drill only while fewer than 2 drills are `learn`.

### 4.6 Recommendation: Parcours and Séance

```js
export const PARCOURS = [
  'mat-deux-tours', 'mat-dame', 'piece-en-prise', 'mat-tour', 'mat-couloir', 'pion-carre',
  'pion-roi-devant', 'fourchette-cavalier', 'pion-opposition', 'parer-couloir', 'pion-cases-cles', 'mat-dame-pions',
  'enfilade', 'pion-defense', 'mat-etouffe', 'mat-tour-pions', 'clouage', 'pion-tour',
  'dame-contre-pion', 'mat-dame-fou', 'tour-contre-pion', 'dame-contre-pion-nulle', 'lucena', 'philidor',
];  // about 1 step in 3 is tactics/vigilance: blunders decide most games at 400–1300
```

- **« Tu es ici »** (Parcours page) is the first `PARCOURS` id whose state is `new` or `learn` and whose prerequisites are met.
- **Next step after an attempt:**
  - default « Position suivante » (same drill);
  - if the drill just became Acquis: « **Acquis** : 3 parties propres d’affilée. On revérifie demain. Prochaine étape : {titre} » with « Passer à {titre} » and « Continuer ici »;
  - inside a séance: « Suite de la séance ».

```js
export function planSeance(s, now = Date.now(), budget = 15 * 60) {
  const R = id => s.drills[id] || fresh(), items = [], known = st => ['acq', 'mast', 'rusty'].includes(st);
  const coveredByKnown = id => (coveredBy[id] || []).some(y => known(R(y).st));
  // 1. Reviews: rusty first, then due checks by overdue ratio; at most 3; never two of the same track in a row
  const rev = DRILL_LIST.filter(d => d.phase === 'A' && !coveredByKnown(d.id)).map(d => ({ d, r: R(d.id) }))
    .filter(({ r }) => r.st === 'rusty' || ((r.st === 'acq' || r.st === 'mast') && r.chk !== dayStr(now) && now >= r.due))
    .map(x => ({ ...x, p: x.r.st === 'rusty' ? 99 : (now - x.r.lastChk) / (I[x.r.box] * DAY) }))
    .sort((a, b) => b.p - a.p).slice(0, 3);
  interleaveByTrack(rev).forEach(({ d, r }) => items.push(r.st === 'rusty'
    ? { kind: 'reprise', id: d.id, n: 4, until: 'mast' } : { kind: 'controle', id: d.id, n: 2 }));
  // 2. Focus: the earliest drill in progress, played as a block
  const learning = PARCOURS.filter(id => R(id).st === 'learn');
  if (learning[0]) items.push({ kind: 'focus', id: learning[0], n: 6, until: 'acq' });
  // 3. New: only when fewer than 2 drills are in progress
  if (learning.length < 2) { const nx = PARCOURS.find(id => R(id).st === 'new' && prereqOk(s, id)); if (nx) items.push({ kind: 'nouveau', id: nx, n: 3 }); }
  // 4. Mix
  if (DRILL_LIST.filter(d => known(R(d.id).st)).length >= 3) items.push({ kind: 'melange', n: Math.max(2, 5 - rev.length) });
  return trimToBudget(items, budget, s.log);   // durations: per-drill median of logged secs, else 120 s (play-out) / 45 s (need-5 drills)
}
```

**Focus block rules.**
- After 3 consecutive `F`, the block stops. It drops one extra level and shows « On reprend plus tard : trois échecs de suite, c’est le signal de changer d’air. ».
- One attempt in four starts from `r.err`.

**Persistence.** `s.seance = {date, items, i}` lets a reload resume the same day.

### 4.7 Mélange (Phase A, last milestone)
- **Pool:** drills that are `acq` or `mast`, excluding those covered by another known drill.
- **Weight:** `clamp(overdueRatio, 0.3, 3)`.
- **Draw rules:**
  - never the same track twice in a row;
  - with probability 0.5 the next item is a `contrast` of the previous one (Q1↔Q2, P2↔P5, Lucena↔Philidor, `mat-couloir`↔`parer-couloir`).
- **Label hidden:** the header shows « Mélange · 2/5 » and only the goal sentence. The title is revealed at the end: « C’était : Défense Philidor ».

### 4.8 Result texts (debrief, first line)

| Case | Text |
|---|---|
| Clean | « Mat en 13 coups (référence 12). **Propre.** Série : 2 sur 3. » |
| Too long | « Mat en 19 (référence 12, limite 15). Réussi, pas encore propre. » |
| Acquis | « **Acquis** : 3 parties propres d’affilée. On revérifie demain. » |
| Maîtrisé | « **Maîtrisé** : toujours propre après une nuit. Prochain contrôle dans 3 jours. » |
| À reprendre | « **À reprendre** : 2 parties propres d’affilée suffiront. » |
| Hint used | « Réussi avec indice. L’indice ne coûte que la série, pas le palier. » |

**Not shown anywhere:** XP, badges, streak flames, confetti, percentages, or a live eval bar.

---

## 5. Explainer (Phase A)

### 5.1 Hint ladder
The button reads « Indice (1/3) », then « (2/3) », then « (3/3) ». Any step marks the attempt `H`.

| Step | Shown | Source |
|---|---|---|
| 1 · Idée | `idea` text of the top fact for the teaching move, plus its overlay (box zone, key squares, square of the pawn). The move is not revealed. | `explainMove(level 1)` |
| 2 · Pièce | `mark-hint` on the from-square, plus « Joue {ta tour}. » | — |
| 3 · Coup | `hint` arrow plus 1–2 sentences of *pourquoi*. tb drills add « {n} coup(s) gagne(nt) ici. » | `explainMove(level 3)` |

**Teaching move:**
- **tb drills:** `rankMoves` best-distance ties go through `pickTeachingMove`. No engine call; instant.
- **Engine drills:** the background `analyse(fen,{movetime:600, multipv:3, tag:'bg'})` started on the user's turn. If it is not finished, wait for it.
- **Tactic drills, first move:** `start.key` with `roles`. Later moves use the engine's best.

### 5.2 Phase A features (`explain/features.js`, memoised per FEN)

The F-numbers refer to the explainer research document.

| Id | Definition (summary) | Families |
|---|---|---|
| `cage` (F1) | Flood fill of the defending king through squares not attacked by us, attacks computed **through** its own square (ghost). Our undefended pieces count as walls and are flagged `hanging` if adjacent, otherwise `leaks`. | mates, stalemate |
| `box` (F2) | Same fill, ignoring **our king** as attacker and as blocker. Used for every « la boîte passe de X à Y » claim. | kqk, krk, krrk, O1/O2 |
| `cuts` (F3) | A rook or queen line strictly between the king region and the rest of the board, with the piece attacking every border square of the line. Records the width left. | krk, krrk, R1, Lucena |
| `check` (F5) | Kind (direct/discovered/double), `worstBox` over the replies, `driving` / `useless` | all |
| `rescue` (F6) | Pieces capturable in the null-move position, none capturable after the move, via legal moves | mates |
| `preemptive` (F7, 2-ply) | The null-move position allows a threat next move; after the move it does not. Run only if no cheaper fact won. | krk, krrk |
| `approach` (F8) | King move that reduces Chebyshev distance, Manhattan as tie-break | mates, R1, Q1 |
| `opposition` (F9) | `analysis.opposition()`. **The holder is the side not to move.** « Diagonale » only in pawn endings. | krk, kpk |
| `knightJump` / `shadow` (F10) | Queen a knight's jump from the king and the box shrinks; or the queen copies the king's last displacement. Suppressed when the king is on the edge. | kqk |
| `stalemateDanger` (F11) | Not in check, defender mobility ≤ 2, lone king (or blocked pawns). Also flags an under-promotion that avoids stalemate. | all |
| `mateEveryReply` (F12, 2-ply) | Every defender reply allows a mate in 1 | mates |
| `waiting` (F13, 2-ply) | Quiet move, box and cut unchanged, good replies before (null) > 0 and after = 0. Same budget rule as F7. | krk, kpk (pawn tempo) |
| `lookahead` (F14) | Play `pv[0..2]`; report box/cage/mobility gains. Always « par exemple ». | fallback |
| `ladder` / `rookFar` (F15) | Check on line L while the other rook holds L±1; a rook ≤ 2 from the king moves to the far end of its line | krrk |
| `keySquares` (F17) | Squares per §3.2 P4. **Claim « gagné » only if the tb says win.** | kpk |
| `inSquare` (F18) | `analysis.inSquare()` | P1 |
| `kingInFront`, `defFront`, `defStraight`, `rookPawnCorner` (F21) | Geometric tests | kpk, kpk-def, Q2 |
| `shoulder` (F20) | King BFS detour length grows | kpk, R1 |
| `lucenaStep`, `philidorStep` (F22) | cut / bridge (rook to rank 4 with the king on 8) / out / interpose; third rank / behind | lucena, philidor |
| `inFront` | After a queen check or pin, the defender's only legal king move is onto the queening square | Q1 |
| `see` (F23) | Legal-move SEE, least valuable attacker first | tactics |
| `fork`, `pin`, `skewer`, `hangingTake`, `mateThreat`, `parryThreat` (F24) | Ray walks and attack sets. **A material claim must be confirmed** by the PV: Δ ≥ 2 within 5 plies, or mate. | tactics, images, vigilance |

**Implementation notes.**
- `board64.js` provides a native `attackSet(grid, color, {ghost, skip})`. It must agree with `chess.isAttacked` on 10,000 random positions.
- 2-ply detectors use `moves({square})` and the native sets, not `moves({verbose:true})` in loops. The latter cost 15–175 ms in the prototype.
- Fix `analysis.kingZone`: split adjacent `hanging` from reachable `leaks`.

### 5.3 Fact priority per family (first match takes the primary sentence; a warning takes the second slot)

| Family | Priority order |
|---|---|
| kqk | mate › rescue › mate-every-reply › **stalemate-danger (warning)** › knight-jump › shadow › box-shrink › kqk-edge › driving-check › approach › lookahead |
| krk | mate › rescue › preemptive-flee › mate-every-reply › opposition-check › box-shrink + cut › waiting › approach-opp › approach › driving-check › lookahead |
| krrk | mate › rescue › ladder › rook-far › box-shrink › lookahead |
| kpk | promotion (with under-promotion warning) › key-square › opposition › shoulder › king-in-front › waiting › lookahead |
| kpk-def | opposition › def-front › def-straight › rook-pawn-corner › enter-square |
| kqkp | in-front › approach › box/check › lookahead |
| kqkp-def | stalemate-defence (« la prise serait pat ») › rook-pawn-corner › stay-near-pawn |
| krkp | cut › king-in-front › shoulder › rook-behind › lookahead |
| lucena / philidor | the steps in order |
| tactic:*, mate-pic, parry | mate › double-check › fork › skewer › pin › hanging-take › mate-threat › parry-threat |

- The drill's own `ideas` get +10 priority.
- Never write « le seul coup » unless the second-best move is worse by at least one mate move, 100 cp, or a tb class.
- **Fallbacks:**
  1. lookahead;
  2. the family sentence, e.g. krk: « Plusieurs coups se valent ici. L’essentiel : garder la coupure et rapprocher ton roi. »;
  3. the drill `tip`.

### 5.4 Templates (`explain/fr.js`)

**French rules.**
- Use `frSan` for moves, in bold.
- Pass every string through `fr()`.
- Agreement helpers: ta tour / ton fou; protégée / protégé.
- « aucune case », « qu’une », « 1re rangée ».
- At most 2 sentences and about 180 characters.

| Id | L1 (idée) | L3 (pourquoi) |
|---|---|---|
| mate | Il y a mat en un coup. | **{san}** est mat : {le roi noir} est en échec et n’a plus aucune case. |
| mate-every-reply | Cherche un coup qui ne lui laisse que des coups perdants. | Quoi que joue {le roi noir}, tu mates au coup suivant. / Il n’a plus qu’un coup, **{r}**, et **{m}** sera mat. |
| rescue-defend / rescue-flee | {Ta tour} est attaquée. | {Le roi noir} attaquait {ta tour} : ton roi vient la protéger. / {Ta tour} s’éloigne à l’autre bout de {la 5e rangée} et garde la coupure. |
| preemptive-flee | Que menacerait le roi noir si tu passais ? | Le roi noir menaçait d’attaquer ta tour (**{r}**) : elle s’éloigne tout de suite, en gardant la coupure. |
| box-shrink | Cherche à resserrer la boîte avec {ta tour}. | {Ta tour} resserre la boîte : le roi noir passe de {a} à {b} cases. |
| cut | Coupe le roi avec ta tour. | Ta tour coupe le roi noir sur {la colonne e} : il ne peut plus la franchir. Il ne lui reste que {w} colonnes. |
| knight-jump | Place ta dame à un saut de cavalier du roi noir. | Ta dame se place à un saut de cavalier du roi noir : sa boîte passe de {a} à {b} cases. |
| kqk-edge | Le roi noir est au bord : à ton roi de jouer. | Le roi noir est collé au bord : la dame a fini de le pousser. Amène maintenant ton roi. |
| opposition-check | Les rois se font face : profites-en. | Les rois se font face : l’échec de ta tour oblige le roi noir à reculer d’une rangée. |
| waiting | Ne change rien à la boîte : cherche un coup d’attente. | Coup d’attente : ta tour garde la même coupure et c’est au roi noir de jouer. Chacun de ses coups te permet de resserrer la boîte. |
| approach / approach-opp | Ton roi doit participer. | Ton roi se rapproche (distance {a} → {b}) : sans lui, {la tour seule} ne peut pas mater. / Ton roi se place face au roi noir : l’échec de la tour le fera reculer. |
| stalemate-danger (warning) | Attention au pat ! | Attention au pat : le roi noir n’a plus que {n} cases ({sqs}). |
| ladder / rook-far | Escalier : une tour coupe, l’autre donne échec. | Escalier : ta tour en {sq} garde {L1} pendant que l’autre donne échec sur {L2}. / Ta tour part à l’autre bout de {L} : le roi ne peut plus l’attaquer. |
| key-square | Vise les cases clés du pion (en couleur). | Ton roi atteint la case clé **{sq}** : le pion ira à dame, même si c’est au roi noir de jouer. |
| opposition | Prends l’opposition. | Tu prends l’opposition{ à distance} : c’est au roi noir de céder le passage. |
| king-in-front | Le roi passe devant le pion. | Ton roi passe devant son pion : il ouvre la route, le pion suivra. |
| underpromo | Attention : une dame ferait pat. | Promotion en tour : une dame ferait pat. |
| enter-square | Le roi peut-il entrer dans le carré du pion ? | Ton roi entre dans le carré du pion : il le rattrapera. |
| def-front / def-straight | Reste devant le pion. / Recule tout droit. | Ton roi bloque sa route vers la promotion. / Recule tout droit : tu reprendras l’opposition quand le roi blanc avancera. |
| rook-pawn-corner | Va vers le coin. | Pion de la tour : ton roi dans le coin, c’est nulle. |
| in-front (Q1) | Force le roi devant son pion. | Après **{san}**, le roi noir doit aller en {sq}, devant son pion : ton roi gagne un temps pour approcher. |
| stalemate-defence (Q2) | Le coin peut te sauver. | Va dans le coin : si la dame prend ton pion, c’est pat. |
| lucena-bridge / -out / -block | Prépare un abri contre les échecs. / Ton roi doit sortir. / Interpose ta tour. | Tu construis le pont : ta tour monte sur la 4e rangée pour s’interposer plus tard. / Ton roi sort du côté opposé au roi noir. / Ta tour s’interpose : les échecs sont finis et le pion va à dame. |
| philidor-third / -behind | Garde la 6e rangée. / Le pion a avancé : change de plan. | Ta tour garde la 6e rangée (ta 3e) : le roi blanc ne peut pas s’y abriter. / Ta tour passe tout en bas et donnera des échecs par derrière. |
| hanging-take | Une pièce adverse n’a aucun défenseur. | {La dame adverse} n’était pas protégée : tu la prends gratuitement. |
| fork | Cherche une case d’où ton cavalier attaque deux pièces — avec échec, c’est imparable. | Fourchette : **{san}** attaque à la fois le roi en {k} et {la dame} en {t}. |
| skewer | Le roi et une pièce derrière lui sont alignés. | Enfilade : échec sur la ligne, le roi s’écarte et {la dame} derrière lui tombe. |
| pin | Une pièce clouée ne peut pas fuir : attaque-la avec moins cher qu’elle. | Clouage : {le cavalier} ne peut pas bouger (son roi serait en échec) ; **{san}** l’attaque. |
| parry-threat | Que menace son dernier coup ? | Il menaçait **{t}** mat : {tu donnes de l’air à ton roi / tu bloques la ligne / tu protèges ta première rangée}. |
| lookahead | — | Prépare la suite : par exemple après **{r}** **{m}**, la boîte tombe de {a} à {b} cases. |

**Tactic hints, step 2.** Mark the targets in red (`mark-ko`) and the moving piece (`mark-hint`) from `roles`.

### 5.5 « Pourquoi mon coup était mauvais ? » (`explainMistake`)

**Severity** uses the §2.2 classifier on the before/after values:

| Severity | Condition | Shown |
|---|---|---|
| `same` | Same class and the same distance, or within 15 cp | Only if asked: « Ton coup est aussi bon. » |
| `slow` | Win kept, distance +2 or more (exact for tb; engine mates only if both numbers come from the same budget) | Debrief only: « Ça gagne toujours, mais plus lentement : mat en {mu} au lieu de {mb}. » |
| terminal | `win→draw`, `draw→loss`, stalemate, piece lost | At once, plus « Reprendre avant l’erreur » |

**Reasons** (only differences between the user's move U and the best move B are reported):
- stalemate;
- missed-mate;
- piece-lost (« {Ta tour} n’est plus protégée : {le roi noir} la prend en {sq}. »);
- box-grow;
- cut-lost;
- useless-check;
- king-away;
- stalemate-risk;
- opposition-given;
- push-too-early;
- entered-square (from the defender's side);
- allows-tactic (the F24 detectors run from the opponent's side on U);
- generic « Ce coup laisse échapper le gain. »

Sentence 2 is always « Mieux : **{B}**. {L3 explanation of B} ». Truncate to 180 characters.

**Inputs:**
- tb drills: `rankMoves`, which is exact.
- Engine drills: `evalUser` from the verdict/confirm search. `evalBest` from the background analysis, or from `analyse(before,{movetime:800, multipv:3})` started when the failure screen opens.

### 5.6 Debrief « moment clé » (Phase A)
- **When:** for F the key moment is the failing move; for S, the worst move:
  - tb drills: the largest distance increase ≥ 2;
  - engine mates: the largest rise in the reply-search mate count ≥ 2;
  - other engine drills: the largest v drop.
- **Shown:** « Moment clé, coup {k} : » followed by `explainMistake`, and the button « Rejouer depuis le moment clé (hors série) ».
- **The position goes to `r.err`.** These are the user's own errors coming back mirrored later, which is the short loop around the critical moment that makes patterns emerge.

---

## 6. Test plan (Node, no dependencies, `node --test tools/test/`)

### 6.1 Harness
- `tools/test/node-engine.mjs` keeps spawning `vendor/stockfish/stockfish-18-lite-single.js` through `child_process` and drives the **same** `Engine` class. Add a `quit()` on teardown.
- `tools/test/harness.mjs` exports:
  - `makeCtx({ seed })`, which returns `{ engine: nodeEngine(), tb: await loadTBFromFs(), rng: mulberry32(seed) }`;
  - `simulate(spec, start, player)`, which runs `Attempt` with a scripted user.
- **Modes:**
  - `QUICK=1` (CI): 20 samples per drill level.
  - Default: 100.
  - `FULL=1` (manual, before release): 300.
  - Also `ONLY=<id>`.
- **Report:** one table per run (drill, level, tries, accepted, acceptance %, median/p90 time per position, distinct %, strata covered, re-verify agreement %).

### 6.2 Tests and pass criteria

1. **`engine.test`.**
   - Bound lines are skipped.
   - `pv` is present.
   - `go depth 40 movetime 400` returns within 400 ms + 150 ms.
   - `searchmoves` is honoured when last.
   - Mate encoding: `8/8/8/8/8/2RK4/8/3k4 w` gives `mate 2` → cp 9980.
   - `stop('bg')` resolves early; `newGame()` works.
2. **`tb.test`.**
   - Rebuild with `js/tb/build.js`; the result must be **byte-identical** to `data/tb/*.bin`.
   - Maxima: KQK 10, KRK 16, distance to promotion 19. White-to-move KPK win share 76.5 % ± 0.1.
   - Symmetry: `probe(f) == probe(mirrorFiles(f)) == probe(swapColors(f))` on 10,000 random legal positions per table.
   - Defender-to-move consistency: for every sampled White-to-move win with distance v, the best move gives distance v − 1, and the defender's best reply returns to v − 1.
   - **Engine cross-check:** 300 random KPK positions. Table win ⇒ engine ≥ +300 at 300 ms; table draw ⇒ engine ≤ +100. Same for 200 KQK/KRK starts (engine mate distance ≥ table distance).
3. **`generators.test`.** For every Phase A drill × level, `produce()` N times. Assert:
   - **(a) Legality:** every FEN loads in chess.js, passes S0, and the user is to move with the right colour.
   - **(b) Family membership** by an *independent longer* check:

     | Family type | Long check |
     |---|---|
     | attack | engine ≥ +300 at 3000 ms |
     | hold | \|v\| ≤ 100 at 3000 ms |
     | tb | predicate re-evaluated |
     | V-MAT | key still best at depth + 4, gap ≥ 150 |
     | V-MATE | mate n at depth 16, unique |
     | V-DEF | null-move mate in 1 and acceptable share ≤ 50 % at depth 14 |

     Agreement required: ≥ 98 % for engine families, 100 % for tb families.
   - **(c) Acceptance:** fail if < 5 % for runtime engine families, or < 1 % for tb families. Below 2 %, the report says « needs seeds » and `tools/build_drills.mjs` must produce `data/drills/<id>.json`.
   - **(d) Time per position (Node):** median ≤ 1.5 s for engine endgame families, ≤ 300 ms for tactics/images/vigilance, ≤ 100 ms for tb.
   - **(e) Diversity:** ≥ 90 % distinct canonical placements; every `strata` value seen at least once in N ≥ 20.
   - **(f) Symmetry:** `finalize` with mirror and flip preserves the probe or engine class (spot check on 10 per drill).
4. **`goals.test`** (success and failure detection, through `Attempt`, the same code path as the browser):

   | Simulated user | Expected outcome |
   |---|---|
   | **Oracle** (tb best move; engine best at 1000 ms) | Success in 100 % of tb attempts and ≥ 95 % of engine attempts; clean (within slack) ≥ 90 % where a ref exists |
   | **Injected blunder** at a random user move (tb: a move `rankMoves` marks as losing the class; engine: a move whose 3000 ms eval is ≤ the LOST threshold − 200) | Ends **at that move** with `fail`: 100 % tb, ≥ 95 % engine |
   | **Random-legal** (30 % random moves, otherwise oracle) | No exception; ends within the cap; **every `fail` is confirmed** by a 3000 ms search agreeing with the LOST threshold; false-fail rate ≤ 1 % |

   Fixtures:
   - KQK stalemate → fail « Pat » (`k7/8/1Q6/8/8/8/8/7K w`, user plays Qb6-c7?? or any stalemating move from a prepared FEN).
   - KQK hanging queen → fail with the reason piece-lost.
   - KPK queen promotion that stalemates → `promote` not reached and verdict lost; promotion to a rook in the same position → success.
   - Threefold in KRK → fail « Tu tournes en rond ».
   - Philidor trade into a drawn KPK → hold success.
   - Lucena defender gives up the rook → success via won signature.
   - Royal fork banked at user move 2.
   - A spite sacrifice gives no false success.
   - Mate-in-2 dual accepted (C), and a slower mate gives S.
   - `parer-couloir`: playing h3 succeeds after 3 moves; ignoring the threat fails at once.
5. **`progress.test`** (pure functions, simulated clock):
   - outcome codes;
   - fast track then 3-up/1-down;
   - Acquis needs the top level and both colours when `flip`;
   - Maîtrisé only on a later day ≥ 12 h;
   - the first attempt of the day is the only check;
   - lapse → rusty → mast with need 2;
   - `covers` refresh and placement;
   - migration of 3 v1 profiles (perfect ≥ 3 / some wins / none) and import of a v1 export file;
   - `planSeance` on 6 scenario stores (fresh, mid-path, 5 due, rusty, ≥ 3 acquired, budget trimming).
6. **`explain.test`.**
   - Fixtures:

     | FEN | Move | Expected |
     |---|---|---|
     | `8/8/8/2R5/k7/8/8/5K2 w` | c5h5 | preemptive-flee, not box-shrink |
     | `8/8/8/8/8/2RK4/8/3k4 w` | d3e3 | mate-every-reply |
     | `8/8/8/8/8/R7/3k1K2/8 w` | f2f3 | no box-grow |
     | `8/8/8/6Q1/3K4/8/5k2/8 w` | g5g4 | box-shrink, 20 → 15 |

     Plus a Lucena bridge, Philidor third rank, a KPK key square, a fork and a back-rank parry.
   - **Properties** over 300 generated positions × teaching move per family:
     - no box-shrink when the box does not shrink;
     - no rescue while a capture is available;
     - mate/stalemate claims equal the chess.js status;
     - identical tags under `mirrorFiles` and `swapColors`;
     - ≤ 2 sentences ending with « . » or « ! »;
     - no `undefined`, `NaN`, `1 cases`, `0 case` or double spaces.
   - **Mistakes:** random user moves in KRK/KQK where the class flips from win to draw give a non-generic reason in ≥ 80 % of cases; `same` never produces a reproach.
   - **Metrics:** fallback rate < 15 % per family; median explainer time < 20 ms in Node, as a proxy for 50 ms on a phone.
7. **`attackset.test`.** `attackSet` equals `chess.isAttacked` on 10,000 random positions.

**CI:** `.github/workflows/tests.yml` runs `QUICK=1 node --test tools/test/` on push. A full run takes about 20 min locally and is required before each release.

---

## 7. Build order (each step ships something usable)

1. **A1 — Engine and board.** `engine.js` changes, Node harness and `engine.test`. Promotion picker and mark classes in `board.js`.
2. **A2 — Tables.** `tb/build.js`, `tools/build_tb.mjs`, the `.bin` files, `tb/probe.js` and `tb.test`.
3. **A3 — Runner and the 3 mates.** `drill/*` (s0, produce, verify, verdict, goals, attempt) and `modules/drill.js`. The 3 mates move into the runner (`mat-dame`/`mat-tour` on exact tables with mate-distance levels). `#/finales` wrapper. `goals.test`. *The KRK hang is fixed here.*
4. **A4 — Explainer for mates.** `explain/*` for kqk/krk/krrk, the hint ladder, `explainMistake` with « Pourquoi ? » / « Reprendre avant l’erreur », the key moment. *This answers « sans explication » for the module the user already likes.*
5. **A5 — Progression and pages.** `progress.js` with migration, record wiring, staircase and states, `#/parcours`, the home card (planner without Mélange), `progress.test`.
6. **A6 — Endgame tracks.** Pawn track (P1–P6) and its explainer facts; O1/O2; Q1/Q2/R1; Lucena/Philidor and their facts; `generators.test` for these.
7. **A7 — Tactics.** Tactics (T1–T4), images (I1–I3), vigilance (V1) with inert noise and tactic facts.
8. **A8 — Séance and Mélange.** `#/seance` focus blocks, the `err` queue, Mélange, and the « Comment ça marche ? » panel.
9. **Phase B,** in this order: `par` banks and per-move strip; Démo/Défilé; Phase B endgame drills (R2, B1–B4, P7, P14, C1/C2); the blunder classifier and checklist counters; more tactics and mating pictures; the « En partie » Lichess rung; Chrono; offline banks (P8, P10, C3, KBNK).

Prototype scripts the implementer can start from, in `/tmp/claude-0/-home-user-chess/0f7ae9ab-cdb4-5553-a217-1156c31fdb50/scratchpad/`:
- `endcat/tb3.mjs`: exact tables;
- `gen.mjs`: fork, skewer, pin, back-rank and smothered generators, plus inert noise;
- `retro.mjs`: 24 mating pictures;
- `combo2.mjs`: back-rank mate in 2;
- `spec/hang.mjs`: hanging piece and the back-rank defence twin;
- `spec/smo2.mjs`: smothered mate in 2;
- `sf.mjs`: Node UCI wrapper with `pv`.

No repository file was modified while writing this spec.