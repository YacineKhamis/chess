import { Chess } from '../vendor/chess.js';
export { Chess };

// ---------- Progression (stockée dans ce navigateur) ----------
const KEY = 'manuel-echecs-v1';
let cache = null;
export function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { cache = {}; }
  cache.finales ||= {}; cache.menace ||= {}; cache.puzzles ||= {}; cache.days ||= {};
  return cache;
}
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* stockage indisponible */ }
}
export function logActivity() {
  const s = load();
  const d = new Date().toISOString().slice(0, 10);
  s.days[d] = (s.days[d] || 0) + 1;
  save();
}
export function exportProgress() { return JSON.stringify(load()); }
export function importProgress(json) { cache = JSON.parse(json); save(); load(); }
export function resetProgress() { cache = {}; save(); load(); }

// Répétition espacée très simple (boîtes de Leitner).
// box 0 = raté récemment ; chaque réussite fait monter d'une boîte.
const INTERVALS = [0, 1, 3, 7, 16, 35]; // en jours
export function recordResult(bucket, id, ok) {
  const s = load();
  const r = s[bucket][id] ||= { n: 0, ok: 0, box: 0, last: 0 };
  r.n++; if (ok) r.ok++;
  r.box = ok ? Math.min(r.box + 1, INTERVALS.length - 1) : 0;
  r.last = Date.now();
  save(); logActivity();
}
export function isDue(rec) {
  if (!rec) return false;
  return Date.now() - rec.last >= INTERVALS[rec.box] * 86400000;
}
// Choisit le prochain exercice : d'abord les ratés à revoir, puis les nouveaux.
export function pickNext(items, bucket, excludeId) {
  const s = load()[bucket];
  const pool = items.filter(x => x.id !== excludeId);
  const due = pool.filter(x => s[x.id] && s[x.id].box === 0 && Date.now() - s[x.id].last > 3 * 60000);
  const fresh = pool.filter(x => !s[x.id]);
  const later = pool.filter(x => s[x.id] && s[x.id].box > 0 && isDue(s[x.id]));
  const r = Math.random();
  const from = (due.length && r < 0.35) ? due : fresh.length ? fresh : later.length ? later : due.length ? due : pool;
  return from[Math.floor(Math.random() * from.length)];
}

// ---------- Notation française ----------
const FR = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
export const frSan = san => san.replace(/[KQRBN]/g, c => FR[c]);
const NAMES = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
export const pieceName = t => NAMES[t];
export const yourPiece = t => (t === 'q' || t === 'r' ? 'ta ' : 'ton ') + NAMES[t];
export const hisPiece = t => (t === 'q' || t === 'r' ? 'sa ' : 'son ') + NAMES[t];

// ---------- Outils échecs ----------
export const uci = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
export function destsOf(chess) {
  const m = new Map();
  for (const mv of chess.moves({ verbose: true })) {
    if (!m.has(mv.from)) m.set(mv.from, []);
    if (!m.get(mv.from).includes(mv.to)) m.get(mv.from).push(mv.to);
  }
  return m;
}
export function nullMoveFen(fen) {
  const f = fen.split(' ');
  f[1] = f[1] === 'w' ? 'b' : 'w'; f[3] = '-';
  return f.join(' ');
}
export const wait = ms => new Promise(r => setTimeout(r, ms));
export const $ = (sel, root = document) => root.querySelector(sel);
// Typographie française : espace insécable avant ? ! : ; et après «
export const fr = s => String(s).replace(/ ([?!:;»])/g, '\u00a0$1').replace(/« /g, '«\u00a0');
export function setText(el, s) { el.textContent = fr(s); }
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = fr(html.trim());
  return t.content.firstElementChild;
}
