// Petit pilote UCI pour Stockfish (WebAssembly, dans un Web Worker).
const ENGINE_PATH = 'vendor/stockfish/stockfish-18-lite-single.js';

let instance = null;
export function getEngine() {
  if (!instance) instance = new Engine();
  return instance;
}

// Transport par défaut : un Web Worker. Les tests Node passent leur propre transport.
function workerTransport() {
  const worker = new Worker(ENGINE_PATH);
  return {
    send: cmd => worker.postMessage(cmd),
    listen: fn => { worker.onmessage = e => fn(typeof e.data === 'string' ? e.data : String(e.data)); },
  };
}

export class Engine {
  constructor(transport = workerTransport()) {
    this.transport = transport;
    this.listeners = [];
    transport.listen(line => this.listeners.slice().forEach(fn => fn(line)));
    this.queue = Promise.resolve();
    this.ready = this._waitFor('uciok', () => this.send('uci'))
      .then(() => { this.send('setoption name Hash value 16'); return this._waitFor('readyok', () => this.send('isready')); });
  }
  send(cmd) { this.transport.send(cmd); }
  _waitFor(token, start) {
    return new Promise(res => {
      const fn = l => { if (l.startsWith(token)) { this.listeners = this.listeners.filter(x => x !== fn); res(); } };
      this.listeners.push(fn);
      start();
    });
  }

  // Renvoie les lignes [{move, cp, mate}] du point de vue du camp au trait.
  analyse(fen, { depth = null, movetime = null, multipv = 1 } = {}) {
    const job = () => new Promise(res => {
      const lines = {};
      const fn = l => {
        if (l.startsWith('info') && l.includes(' pv ') && l.includes(' score ')) {
          const t = l.split(' ');
          const k = t.includes('multipv') ? +t[t.indexOf('multipv') + 1] : 1;
          const i = t.indexOf('score'), kind = t[i + 1], v = +t[i + 2];
          lines[k] = {
            move: t[t.indexOf('pv') + 1],
            cp: kind === 'cp' ? v : (v > 0 ? 10000 - 10 * v : -10000 - 10 * v),
            mate: kind === 'mate' ? v : null,
          };
        } else if (l.startsWith('bestmove')) {
          this.listeners = this.listeners.filter(x => x !== fn);
          res(Object.keys(lines).sort((a, b) => a - b).map(k => lines[k]));
        }
      };
      this.listeners.push(fn);
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      this.send(depth ? `go depth ${depth}` : `go movetime ${movetime || 500}`);
    });
    const prev = this.queue;
    const p = prev.then(() => this.ready).then(job, job);
    this.queue = p.catch(() => {});
    return p;
  }

  async bestMove(fen, opts) {
    const lines = await this.analyse(fen, opts);
    return lines[0] || null;
  }
}
