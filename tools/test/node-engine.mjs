// Stockfish dans Node pour les tests : même pilote que le navigateur, transport par processus.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Engine } from '../../js/engine.js';

const SF = fileURLToPath(new URL('../../vendor/stockfish/stockfish-18-lite-single.js', import.meta.url));

// nodeEngine() → Engine ; appeler engine.close() (ou quit()) en fin de test.
// Option : log(dir, line) reçoit chaque commande envoyée ('>') et chaque ligne reçue ('<').
export function nodeEngine({ log = null } = {}) {
  const proc = spawn(process.execPath, [SF], { stdio: ['pipe', 'pipe', 'inherit'] });
  let rest = '', listener = () => {}, onError = () => {}, closing = false;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', d => {
    const lines = (rest + d).split('\n');
    rest = lines.pop();
    lines.forEach(l => { l = l.trim(); if (log) log('<', l); listener(l); });
  });
  proc.on('error', e => onError(e));
  proc.on('exit', code => { if (!closing) onError(new Error(`Stockfish s’est arrêté (code ${code})`)); });
  proc.stdin.on('error', () => {}); // écriture après la fin du processus : ignorée
  const engine = new Engine({
    send: cmd => { if (log) log('>', cmd); if (!closing) proc.stdin.write(cmd + '\n'); },
    listen: (fn, err) => { listener = fn; onError = err || onError; },
    close: () => { closing = true; proc.stdin.end(); setTimeout(() => proc.kill(), 200).unref(); },
  });
  engine.proc = proc;
  engine.close = () => engine.quit();
  return engine;
}
