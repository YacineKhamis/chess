// Échiquier natif à 64 cases pour l'explicateur : FEN ↔ grille, ensembles d'attaque, coups légaux, SAN.
// Fonctions pures et rapides (aucune dépendance) : les détecteurs à 2 demi-coups les appellent des milliers de fois,
// ce que chess.js (moves({ verbose: true }) en O(n²)) ne permet pas dans le budget de 50 ms.
// Cases : entiers 0…63, a1 = 0, h1 = 7, a8 = 56 (comme js/tb/probe.js). Pièces : lettres FEN ('K', 'q'…), '' = vide.

export const FILES = 'abcdefgh';
export const F = i => i & 7, R = i => i >> 3;
export const idx = s => (s.charCodeAt(1) - 49) * 8 + s.charCodeAt(0) - 97;
export const name = i => FILES[i & 7] + ((i >> 3) + 1);
export const colorOf = p => (p ? (p < 'a' ? 'w' : 'b') : null);
export const typeOf = p => (p ? p.toLowerCase() : '');
export const other = c => (c === 'w' ? 'b' : 'w');
export const pc = (t, c) => (c === 'w' ? t.toUpperCase() : t);
export const cheb = (a, b) => Math.max(Math.abs(F(a) - F(b)), Math.abs(R(a) - R(b)));
export const manh = (a, b) => Math.abs(F(a) - F(b)) + Math.abs(R(a) - R(b));
export const edge = i => Math.min(F(i), 7 - F(i), R(i), 7 - R(i));
export const knightJump = (a, b) => Math.abs(F(a) - F(b)) * Math.abs(R(a) - R(b)) === 2;
export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// Directions : 0…3 orthogonales, 4…7 diagonales.
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT_D = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const on = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const table = D => [...Array(64)].map((_, i) => D.map(([df, dr]) => [F(i) + df, R(i) + dr]).filter(([f, r]) => on(f, r)).map(([f, r]) => r * 8 + f));
export const KING_N = table(DIRS), KNIGHT_N = table(KNIGHT_D);
// RAY[i][d] : cases depuis i dans la direction d, de la plus proche à la plus lointaine.
export const RAY = [...Array(64)].map((_, i) => DIRS.map(([df, dr]) => {
  const out = [];
  for (let f = F(i) + df, r = R(i) + dr; on(f, r); f += df, r += dr) out.push(r * 8 + f);
  return out;
}));
export const SLIDE = { r: [0, 1, 2, 3], b: [4, 5, 6, 7], q: [0, 1, 2, 3, 4, 5, 6, 7] };
// Direction de a vers b (indice dans DIRS) ou -1 si les cases ne sont pas alignées.
export function dirOf(a, b) {
  const df = F(b) - F(a), dr = R(b) - R(a);
  if (a === b || (df && dr && Math.abs(df) !== Math.abs(dr))) return -1;
  return DIRS.findIndex(([x, y]) => x === Math.sign(df) && y === Math.sign(dr));
}
// Cases strictement entre a et b (alignées), sinon [].
export function between(a, b) {
  const d = dirOf(a, b);
  if (d < 0) return [];
  const out = [];
  for (const j of RAY[a][d]) { if (j === b) break; out.push(j); }
  return out;
}

// ---------- FEN ----------
export function parse(fen) {
  const [pl, turn = 'w', castle = '-', ep = '-', half = '0', full = '1'] = String(fen).trim().split(/\s+/);
  const g = new Array(64).fill('');
  let r = 7, f = 0;
  for (const c of pl) {
    if (c === '/') { r--; f = 0; } else if (c >= '1' && c <= '8') f += +c;
    else { if (r >= 0 && f < 8) g[r * 8 + f] = c; f++; }
  }
  return { g, turn: turn === 'b' ? 'b' : 'w', castle: castle || '-', ep: /^[a-h][36]$/.test(ep) ? idx(ep) : -1, half: +half || 0, full: +full || 1 };
}
export function placement(g) {
  let s = '';
  for (let r = 7; r >= 0; r--) {
    let n = 0;
    for (let f = 0; f < 8; f++) {
      const p = g[r * 8 + f];
      if (!p) { n++; continue; }
      if (n) { s += n; n = 0; }
      s += p;
    }
    if (n) s += n;
    if (r) s += '/';
  }
  return s;
}
export const fenOf = pos => `${placement(pos.g)} ${pos.turn} ${pos.castle || '-'} ${pos.ep >= 0 ? name(pos.ep) : '-'} ${pos.half} ${pos.full}`;
// Clé de mémo : placement, trait, roques, prise en passant (sans les compteurs).
export const keyOf = fen => String(fen).trim().split(/\s+/).slice(0, 4).join(' ');

// ---------- Attaques ----------
const NONE = new Uint8Array(64);
function mask(list) {
  if (list == null || list === -1) return NONE;
  if (typeof list === 'number') { const m = new Uint8Array(64); m[list] = 1; return m; }
  if (!list.length) return NONE;
  const m = new Uint8Array(64);
  for (const i of list) if (i >= 0) m[i] = 1;
  return m;
}
function addAttacks(g, i, p, A, gm, sm) {
  const t = typeOf(p);
  if (t === 'p') {
    const r = R(i) + (p === 'P' ? 1 : -1), f = F(i);
    if (r >= 0 && r < 8) { if (f > 0) A[r * 8 + f - 1] = 1; if (f < 7) A[r * 8 + f + 1] = 1; }
  } else if (t === 'n') for (const j of KNIGHT_N[i]) A[j] = 1;
  else if (t === 'k') for (const j of KING_N[i]) A[j] = 1;
  else for (const d of SLIDE[t]) for (const j of RAY[i][d]) { A[j] = 1; if (g[j] && !gm[j] && !sm[j]) break; }
}
// Cases attaquées par `color`. ghost : cases traitées comme vides pour les lignes (rayons X, ex. le roi qui se défend) ;
// skip : pièces ignorées comme attaquants ET comme bloqueurs (ex. notre roi pour la « boîte »).
// Sémantique de chess.js : une case occupée par une pièce de `color` est marquée si une AUTRE pièce la défend.
export function attackSet(g, color, { ghost = null, skip = null } = {}) {
  const A = new Uint8Array(64), gm = mask(ghost), sm = mask(skip);
  for (let i = 0; i < 64; i++) {
    const p = g[i];
    if (p && colorOf(p) === color && !sm[i]) addAttacks(g, i, p, A, gm, sm);
  }
  return A;
}
// Attaques d'une seule pièce (fourchettes, responsabilité d'une coupure).
export function pieceAttacks(g, i, { ghost = null, skip = null } = {}) {
  const A = new Uint8Array(64);
  if (g[i]) addAttacks(g, i, g[i], A, mask(ghost), mask(skip));
  return A;
}
// La case s est-elle attaquée par `color` ? (recherche inverse, sans tableau)
export function attacked(g, s, color) {
  const w = color === 'w';
  const P = w ? 'P' : 'p', N = w ? 'N' : 'n', B = w ? 'B' : 'b', Rk = w ? 'R' : 'r', Q = w ? 'Q' : 'q', K = w ? 'K' : 'k';
  const pr = R(s) + (w ? -1 : 1), f = F(s);
  if (pr >= 0 && pr < 8 && ((f > 0 && g[pr * 8 + f - 1] === P) || (f < 7 && g[pr * 8 + f + 1] === P))) return true;
  for (const j of KNIGHT_N[s]) if (g[j] === N) return true;
  for (const j of KING_N[s]) if (g[j] === K) return true;
  for (let d = 0; d < 8; d++) {
    for (const j of RAY[s][d]) {
      const p = g[j];
      if (!p) continue;
      if (p === Q || p === (d < 4 ? Rk : B)) return true;
      break;
    }
  }
  return false;
}
// Pièces de `color` qui attaquent s.
export function attackersOf(g, s, color) {
  const w = color === 'w', out = [];
  const P = w ? 'P' : 'p', N = w ? 'N' : 'n', B = w ? 'B' : 'b', Rk = w ? 'R' : 'r', Q = w ? 'Q' : 'q', K = w ? 'K' : 'k';
  const pr = R(s) + (w ? -1 : 1), f = F(s);
  if (pr >= 0 && pr < 8) { if (f > 0 && g[pr * 8 + f - 1] === P) out.push(pr * 8 + f - 1); if (f < 7 && g[pr * 8 + f + 1] === P) out.push(pr * 8 + f + 1); }
  for (const j of KNIGHT_N[s]) if (g[j] === N) out.push(j);
  for (const j of KING_N[s]) if (g[j] === K) out.push(j);
  for (let d = 0; d < 8; d++) {
    for (const j of RAY[s][d]) {
      const p = g[j];
      if (!p) continue;
      if (p === Q || p === (d < 4 ? Rk : B)) out.push(j);
      break;
    }
  }
  return out;
}
export const kingOf = (g, color) => g.indexOf(color === 'w' ? 'K' : 'k');
export const inCheck = (pos, color = pos.turn) => { const k = kingOf(pos.g, color); return k >= 0 && attacked(pos.g, k, other(color)); };
// Pièces (hors roi) d'une couleur : [{ i, p, t }]
export function units(g, color) {
  const out = [];
  for (let i = 0; i < 64; i++) if (g[i] && colorOf(g[i]) === color) out.push({ i, p: g[i], t: typeOf(g[i]) });
  return out;
}

// ---------- Coups ----------
// Coup : { from, to, p (pièce), cap (pièce prise ou ''), promo ('q'|'r'|'b'|'n'|''), flag ('' | 'ep' | 'K' | 'Q' | '2') }
export const uciOf = m => name(m.from) + name(m.to) + (m.promo || '');

function pseudo(pos) {
  const { g, turn: c } = pos, out = [], them = other(c);
  const add = (from, to, p, flag = '') => {
    const cap = flag === 'ep' ? pc('p', them) : g[to];
    if (typeOf(p) === 'p' && (R(to) === 7 || R(to) === 0)) for (const pr of 'qrbn') out.push({ from, to, p, cap, promo: pr, flag });
    else out.push({ from, to, p, cap, promo: '', flag });
  };
  for (let i = 0; i < 64; i++) {
    const p = g[i];
    if (!p || colorOf(p) !== c) continue;
    const t = typeOf(p);
    if (t === 'p') {
      const d = c === 'w' ? 8 : -8, start = c === 'w' ? 1 : 6, f = F(i);
      const y = i + d;
      if (y >= 0 && y < 64 && !g[y]) {
        add(i, y, p);
        if (R(i) === start && !g[y + d]) add(i, y + d, p, '2');
      }
      for (const df of [-1, 1]) {
        if (f + df < 0 || f + df > 7) continue;
        const x = y + df;
        if (x < 0 || x > 63) continue;
        if (g[x] && colorOf(g[x]) === them) add(i, x, p);
        else if (x === pos.ep && !g[x]) add(i, x, p, 'ep');
      }
    } else if (t === 'n' || t === 'k') {
      for (const j of (t === 'n' ? KNIGHT_N : KING_N)[i]) if (!g[j] || colorOf(g[j]) === them) add(i, j, p);
      if (t === 'k') castles(pos, i, add);
    } else {
      for (const d of SLIDE[t]) for (const j of RAY[i][d]) {
        if (!g[j]) { add(i, j, p); continue; }
        if (colorOf(g[j]) === them) add(i, j, p);
        break;
      }
    }
  }
  return out;
}
function castles(pos, k, add) {
  const { g, turn: c, castle } = pos;
  if (!castle || castle === '-') return;
  const home = c === 'w' ? 4 : 60, them = other(c);
  if (k !== home || attacked(g, k, them)) return;
  const rook = pc('r', c);
  if (castle.includes(c === 'w' ? 'K' : 'k') && g[home + 3] === rook && !g[home + 1] && !g[home + 2]
    && !attacked(g, home + 1, them) && !attacked(g, home + 2, them)) add(k, home + 2, g[k], 'K');
  if (castle.includes(c === 'w' ? 'Q' : 'q') && g[home - 4] === rook && !g[home - 1] && !g[home - 2] && !g[home - 3]
    && !attacked(g, home - 1, them) && !attacked(g, home - 2, them)) add(k, home - 2, g[k], 'Q');
}
// Grille après le coup (sans mise à jour du reste de l'état).
export function gridAfter(g, m) {
  const h = g.slice();
  h[m.to] = m.promo ? pc(m.promo, colorOf(m.p)) : m.p;
  h[m.from] = '';
  if (m.flag === 'ep') h[m.to + (colorOf(m.p) === 'w' ? -8 : 8)] = '';
  else if (m.flag === 'K') { h[m.from + 1] = h[m.from + 3]; h[m.from + 3] = ''; }
  else if (m.flag === 'Q') { h[m.from - 1] = h[m.from - 4]; h[m.from - 4] = ''; }
  return h;
}
const CORNER_RIGHTS = { 0: 'Q', 7: 'K', 56: 'q', 63: 'k' };
export function play(pos, m) {
  const g = gridAfter(pos.g, m), c = pos.turn;
  let castle = pos.castle === '-' ? '' : pos.castle;
  if (castle) {
    if (typeOf(m.p) === 'k') castle = castle.replace(c === 'w' ? /[KQ]/g : /[kq]/g, '');
    for (const s of [m.from, m.to]) if (CORNER_RIGHTS[s]) castle = castle.replace(CORNER_RIGHTS[s], '');
  }
  return {
    g, turn: other(c), castle: castle || '-', ep: m.flag === '2' ? (m.from + m.to) >> 1 : -1,
    half: typeOf(m.p) === 'p' || m.cap ? 0 : pos.half + 1, full: pos.full + (c === 'b' ? 1 : 0),
  };
}
// Coups légaux du camp au trait (option : seulement ceux qui arrivent sur `to`).
export function legalMoves(pos, { to = -1 } = {}) {
  const c = pos.turn, them = other(c), out = [];
  for (const m of pseudo(pos)) {
    if (to >= 0 && m.to !== to) continue;
    const h = gridAfter(pos.g, m);
    const k = typeOf(m.p) === 'k' ? m.to : kingOf(h, c);
    if (k < 0 || !attacked(h, k, them)) out.push(m);
  }
  return out;
}
export const hasLegal = pos => {
  const c = pos.turn, them = other(c);
  for (const m of pseudo(pos)) {
    const h = gridAfter(pos.g, m);
    const k = typeOf(m.p) === 'k' ? m.to : kingOf(h, c);
    if (k < 0 || !attacked(h, k, them)) return true;
  }
  return false;
};
// 'mate' | 'stalemate' | null
export const statusOf = pos => (hasLegal(pos) ? null : inCheck(pos) ? 'mate' : 'stalemate');
// Passer son tour (seulement si le camp au trait n'est pas en échec).
export const nullPos = pos => ({ ...pos, turn: other(pos.turn), ep: -1 });
export function findMove(pos, uci, legal = legalMoves(pos)) {
  if (!uci || uci.length < 4) return null;
  const from = idx(uci.slice(0, 2)), to = idx(uci.slice(2, 4)), pr = (uci[4] || '').toLowerCase();
  const cands = legal.filter(m => m.from === from && m.to === to);
  if (!cands.length) return null;
  return cands.find(m => m.promo === pr) || cands.find(m => m.promo === 'q') || cands[0];
}

// SAN anglaise (comme chess.js) ; à passer dans frSan pour l'affichage.
export function sanOf(pos, m, legal = legalMoves(pos)) {
  let s;
  const t = typeOf(m.p);
  if (m.flag === 'K') s = 'O-O';
  else if (m.flag === 'Q') s = 'O-O-O';
  else if (t === 'p') s = (m.cap ? FILES[F(m.from)] + 'x' : '') + name(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
  else {
    const amb = legal.filter(o => o.p === m.p && o.to === m.to && o.from !== m.from);
    let d = '';
    if (amb.length) {
      if (!amb.some(o => F(o.from) === F(m.from))) d = FILES[F(m.from)];
      else if (!amb.some(o => R(o.from) === R(m.from))) d = String(R(m.from) + 1);
      else d = name(m.from);
    }
    s = t.toUpperCase() + d + (m.cap ? 'x' : '') + name(m.to);
  }
  const after = play(pos, m);
  if (inCheck(after)) s += hasLegal(after) ? '+' : '#';
  return s;
}
