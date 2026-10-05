// Stockfish dans Node pour les tests : même pilote que le navigateur, transport par processus.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Engine } from '../../js/engine.js';

const SF = fileURLToPath(new URL('../../vendor/stockfish/stockfish-18-lite-single.js', import.meta.url));

export function nodeEngine() {
  const proc = spawn(process.execPath, [SF], { stdio: ['pipe', 'pipe', 'inherit'] });
  let rest = '';
  let listener = () => {};
  proc.stdout.on('data', d => {
    const lines = (rest + d).split('\n');
    rest = lines.pop();
    lines.forEach(l => listener(l.trim()));
  });
  const engine = new Engine({ send: cmd => proc.stdin.write(cmd + '\n'), listen: fn => { listener = fn; } });
  engine.close = () => { proc.stdin.end('quit\n'); proc.kill(); };
  return engine;
}
