// Petit pilote UCI pour Stockfish (WebAssembly, dans un Web Worker ; processus fils dans Node).
//
// API :
//   analyse(fen, { depth, movetime, nodes, multipv = 1, searchmoves, tag })
//     → Promise<[{ move, cp, mate, pv: string[], depth }]>, une ligne par multipv (triées par rang).
//     cp est du point de vue du camp au trait ; mat en n → cp = 10000 − 10n (n > 0) ou −10000 − 10n (n < 0).
//     Sans depth ni movetime (ni nodes) : movetime 500. depth + movetime : s’arrête à la première limite.
//     searchmoves (tableau ou chaîne) est toujours placé en dernier sur la commande go.
//     Les lignes « lowerbound »/« upperbound » sont ignorées. « bestmove (none) » (mat, pat) → [].
//     Une recherche qui ne rend rien sur une position non terminale est relancée une fois en depth 1.
//   bestMove(fen, opts) → première ligne ou null.
//   stop(tag) : arrête la recherche en cours si elle porte ce tag (elle rend les lignes déjà trouvées)
//     et retire de la file les travaux portant ce tag (ils rendent []). Renvoie une promesse résolue
//     quand la recherche arrêtée a rendu la main.
//   stopAll() : idem pour toutes les recherches, quel que soit leur tag (newGame reste dans la file).
//   newGame() → Promise : « ucinewgame » puis « isready », dans la file.
//   quit() : arrête le moteur ; les travaux en attente rendent [].
// Les travaux passent un par un, dans l’ordre d’arrivée. Si le moteur meurt (worker en erreur,
// processus terminé), les travaux en attente et les suivants sont rejetés avec une Error.
//
// Transport : { send(cmd), listen(onLine, onError?), close?() }.
const ENGINE_PATH = 'vendor/stockfish/stockfish-18-lite-single.js';

let instance = null;
export function getEngine() {
  // Un moteur tombé en panne (ou arrêté) est remplacé au prochain appel.
  if (!instance || instance.dead || instance.closed) instance = new Engine();
  return instance;
}

// Transport par défaut : un Web Worker. Les tests Node passent leur propre transport.
function workerTransport() {
  const worker = new Worker(ENGINE_PATH);
  return {
    send: cmd => worker.postMessage(cmd),
    listen: (fn, onError) => {
      worker.onmessage = e => fn(typeof e.data === 'string' ? e.data : String(e.data));
      worker.onerror = e => onError && onError(new Error('Stockfish : ' + (e.message || 'erreur du worker')));
    },
    close: () => worker.terminate(),
  };
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

// Analyse une ligne « info … score … pv … » ; null si elle n’apporte pas de ligne exploitable.
export function parseInfo(l) {
  if (!l.startsWith('info ') || !l.includes(' pv ') || !l.includes(' score ')) return null;
  if (l.includes(' lowerbound ') || l.includes(' upperbound ')) return null;
  const t = l.trim().split(/\s+/);
  const i = t.indexOf('score'), kind = t[i + 1], v = +t[i + 2];
  if (kind !== 'cp' && kind !== 'mate' || !Number.isFinite(v)) return null;
  const pv = [];
  for (let j = t.indexOf('pv') + 1; j < t.length && UCI_MOVE.test(t[j]); j++) pv.push(t[j]);
  if (!pv.length) return null;
  const k = t.indexOf('multipv'), d = t.indexOf('depth');
  return {
    k: k >= 0 ? +t[k + 1] : 1,
    line: {
      move: pv[0],
      cp: kind === 'cp' ? v : (v > 0 ? 10000 - 10 * v : -10000 - 10 * v),
      mate: kind === 'mate' ? v : null,
      pv,
      depth: d >= 0 ? +t[d + 1] : null,
    },
  };
}

// Commande go : limites d’abord, searchmoves toujours en dernier (Stockfish avale tout ce qui suit).
export function goCommand({ depth = null, movetime = null, nodes = null, searchmoves = null } = {}) {
  let cmd = 'go';
  if (depth) cmd += ` depth ${depth}`;
  if (movetime) cmd += ` movetime ${movetime}`;
  if (nodes) cmd += ` nodes ${nodes}`;
  if (!depth && !movetime && !nodes) cmd += ' movetime 500';
  const sm = typeof searchmoves === 'string' ? searchmoves.trim().split(/\s+/) : searchmoves;
  if (sm && sm.length && sm[0]) cmd += ' searchmoves ' + sm.join(' ');
  return cmd;
}

export class Engine {
  constructor(transport = workerTransport()) {
    this.transport = transport;
    this.jobs = [];       // travaux en attente
    this.cur = null;      // travail en cours
    this.dead = null;     // Error si le moteur est tombé en panne
    this.closed = false;  // true après quit()
    this.multipv = 1;     // valeur MultiPV déjà envoyée
    transport.listen(
      data => String(data).split('\n').forEach(l => { if (l && this.cur) this.cur.onLine(l.trim()); }),
      err => this._end(err || new Error('Stockfish s’est arrêté')),
    );
    // Initialisation : premier travail de la file.
    this.ready = this._enqueue({
      start: () => this.send('uci'),
      onLine(l) {
        if (l.startsWith('uciok')) { this.engine.send('setoption name Hash value 16'); this.engine.send('isready'); }
        else if (l.startsWith('readyok')) this.done();
      },
    });
    this.ready.catch(() => {});
  }
  send(cmd) { this.transport.send(cmd); }

  analyse(fen, { depth = null, movetime = null, nodes = null, multipv = 1, searchmoves = null, tag = null } = {}) {
    const lines = {};
    const go = goCommand({ depth, movetime, nodes, searchmoves });
    return this._enqueue({
      search: true, tag, stopped: false, retried: false,
      start: () => {
        if (multipv !== this.multipv) { this.send(`setoption name MultiPV value ${multipv}`); this.multipv = multipv; }
        this.send(`position fen ${fen}`);
        this.send(go);
      },
      onLine(l) {
        if (l.startsWith('info')) {
          const r = parseInfo(l);
          if (r) lines[r.k] = r.line;
        } else if (l.startsWith('bestmove')) {
          const best = l.split(/\s+/)[1];
          const out = Object.keys(lines).sort((a, b) => a - b).map(k => lines[k]);
          // Rien trouvé sur une position non terminale (cas rare) : une seconde chance en depth 1.
          if (!out.length && best && best !== '(none)' && !this.stopped && !this.retried) {
            this.retried = true;
            this.engine.send(goCommand({ depth: 1, searchmoves }));
            return;
          }
          this.done(out);
        }
      },
    });
  }

  async bestMove(fen, opts) {
    const lines = await this.analyse(fen, opts);
    return lines[0] || null;
  }

  newGame() {
    return this._enqueue({
      start: () => { this.send('ucinewgame'); this.send('isready'); },
      onLine(l) { if (l.startsWith('readyok')) this.done(); },
    });
  }

  stop(tag) {
    if (tag == null) return Promise.resolve();
    return this._cancel(j => j.search && j.tag === tag);
  }
  stopAll() { return this._cancel(j => j.search); }

  quit() {
    if (this.dead || this.closed) return;
    this._end(null);
    try { this.send('quit'); } catch { /* transport déjà fermé */ }
    if (this.transport.close) this.transport.close();
  }

  // Arrête la recherche en cours et retire de la file les travaux qui vérifient pred (ils rendent []).
  _cancel(pred) {
    this.jobs = this.jobs.filter(j => !(pred(j) && (j.resolve([]), true)));
    const c = this.cur;
    if (!c || !pred(c)) return Promise.resolve();
    if (!c.stopped) { c.stopped = true; this.send('stop'); }
    return c.promise.then(() => {}, () => {});
  }

  _enqueue(job) {
    job.engine = this;
    job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    job.done = value => {
      if (this.cur !== job) return;
      this.cur = null;
      job.resolve(value);
      this._pump();
    };
    if (this.dead) job.reject(this.dead);
    else if (this.closed) job.resolve(job.search ? [] : undefined);
    else { this.jobs.push(job); this._pump(); }
    return job.promise;
  }
  _pump() {
    if (this.cur || this.dead || this.closed) return;
    const job = this.jobs.shift();
    if (!job) return;
    this.cur = job;
    try { job.start(); } catch (e) { this._end(e); }
  }
  // err = null : arrêt volontaire (les travaux rendent []) ; sinon panne (ils sont rejetés).
  _end(err) {
    if (this.dead || this.closed) return;
    if (err) this.dead = err; else this.closed = true;
    const all = (this.cur ? [this.cur] : []).concat(this.jobs);
    this.cur = null; this.jobs = [];
    all.forEach(j => (err ? j.reject(err) : j.resolve(j.search ? [] : undefined)));
  }
}
