// Filtre de base appliqué à toute position candidate (spec §3.0.2).
import { Chess } from '../../vendor/chess.js';
import { nullMoveFen } from '../util.js';

export function s0(fen, opts = {}) {
  const f = fen.split(' ');
  if (f.length !== 6 || f[2] !== '-' || f[3] !== '-') return false;
  if (/[pP]/.test(f[0].split('/')[0]) || /[pP]/.test(f[0].split('/')[7])) return false; // pions sur la 1re ou 8e rangée
  let c;
  try { c = new Chess(fen); } catch { return false; }
  if (c.isGameOver()) return false;
  if (!opts.allowCheck && c.isCheck()) return false;
  // le camp qui n'a pas le trait ne doit pas être en échec
  try { if (new Chess(nullMoveFen(fen)).isCheck()) return false; } catch { return false; }
  if (!opts.allowCaptures && c.moves({ verbose: true }).some(m => m.captured)) return false;
  return true;
}
