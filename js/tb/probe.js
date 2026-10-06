// Tables exactes à 3 pièces (KQK, KRK, KPK) : lecture, sondage, classement des coups, politiques.
// Fonctionne dans le navigateur et dans Node, sans chess.js : on lit la FEN et on calcule avec des entiers.
//
// Format des fichiers (blanc = camp fort, trait aux blancs) — voir docs/conception-v2.md §1.3 :
//   kqk.bin, krk.bin : idx = (t·64 + bk)·64 + x, t = rang du roi blanc dans TRI après symétrie ; 40 960 octets.
//   kpk.bin          : pion en colonnes a–d, idx = (wk·64 + bk)·24 + (rangée(p)−1)·4 + colonne(p) ; 98 304 octets.
//   Octet : 1…19 = coups blancs jusqu'au mat (KQK/KRK) ou jusqu'à la promotion sûre (KPK), promotion comprise ;
//           0 = nulle ; 255 = illégal (cases confondues, rois au contact, roi noir en échec).
//
// API : loadTB(loader?) → Promise<TB>, tbFromBytes({ kqk, krk, kpk }) → TB.
//   TB.signature(fen) → { sig, strong } | null
//   TB.probe(fen)     → null | { sig, strong, win, dist, mate }
//   TB.rankMoves(fen) → [{ uci, win, dist, capture, promo, sig, mateDist }] (meilleur coup du camp au trait d'abord)
//   TB.stubborn(fen, rng) / TB.trap(fen, rng) → uci | null
// Cases : entiers 0…63, a1 = 0, h1 = 7, a8 = 56.

export const F = s => s & 7, R = s => s >> 3;
export const adj = (a, b) => a !== b && Math.abs(F(a) - F(b)) <= 1 && Math.abs(R(a) - R(b)) <= 1;
export const sqName = s => 'abcdefgh'[F(s)] + (R(s) + 1);

// Voisins de chaque case (déplacements du roi).
export const KING = [...Array(64)].map((_, s) => [...Array(64).keys()].filter(t => adj(s, t)));

// Directions : 1…4 orthogonales, 5…8 diagonales ; DIR[a·64+b] = direction de a vers b (0 si hors ligne).
export const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIR = new Int8Array(4096), CHEB = new Int8Array(4096);
for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++) {
  const df = F(b) - F(a), dr = R(b) - R(a);
  CHEB[a * 64 + b] = Math.max(Math.abs(df), Math.abs(dr));
  if (a === b || (df && dr && Math.abs(df) !== Math.abs(dr))) continue;
  DIR[a * 64 + b] = 1 + STEPS.findIndex(([f, r]) => f === Math.sign(df) && r === Math.sign(dr));
}

// La pièce blanche `p` ('Q', 'R' ou 'P') en x attaque-t-elle t ? Seul bloqueur possible : la case b (le roi blanc).
// Le roi noir ne bloque jamais : il est la cible, ou il vient de quitter la ligne.
export function attacks(p, x, t, b) {
  if (p === 'P') return R(t) === R(x) + 1 && Math.abs(F(t) - F(x)) === 1;
  const d = DIR[x * 64 + t];
  if (!d || (p === 'R' && d > 4)) return false;
  return !(DIR[x * 64 + b] === d && CHEB[x * 64 + b] < CHEB[x * 64 + t]);
}

// Cases atteintes par une pièce glissante depuis x, arrêtées par les cases o1 et o2 (les deux rois).
export function slides(p, x, o1, o2, fn) {
  for (let d = 0; d < (p === 'R' ? 4 : 8); d++) {
    const [df, dr] = STEPS[d];
    for (let f = F(x) + df, r = R(x) + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) {
      const s = r * 8 + f;
      if (s === o1 || s === o2) break;
      fn(s);
    }
  }
}

// Triangle a1–d1–d4 pour le roi blanc des finales sans pion.
export const TRI = [0, 1, 2, 3, 9, 10, 11, 18, 19, 27];
const TRI_IDX = new Int8Array(64).fill(-1);
TRI.forEach((s, i) => { TRI_IDX[s] = i; });
export const SIZES = { kqk: 40960, krk: 40960, kpk: 98304 };
const PIECE = { KQK: 'Q', KRK: 'R', KPK: 'P' };
const ILL = 255;

// Lecture de la FEN → position normalisée (blanc = camp fort) ou null si ce n'est pas une finale à 3 pièces.
function parse(fen) {
  const [pl, turn = 'w'] = String(fen).trim().split(/\s+/);
  let wk = -1, bk = -1, x = -1, pc = '', r = 7, f = 0;
  for (const c of pl) {
    if (c === '/') { r--; f = 0; continue; }
    if (c >= '1' && c <= '8') { f += +c; continue; }
    const s = r * 8 + f++;
    if (f > 8 || r < 0) return null;
    if (c === 'K') { if (wk >= 0) return null; wk = s; }
    else if (c === 'k') { if (bk >= 0) return null; bk = s; }
    else { if (x >= 0) return null; x = s; pc = c; }
  }
  const P = pc.toUpperCase();
  if (wk < 0 || bk < 0 || x < 0 || !'QRP'.includes(P) || !P) return null;
  const strong = pc === P ? 'w' : 'b', swap = strong === 'b';
  // Camp fort noir : on retourne l'échiquier et on échange les couleurs (comme swapColors).
  return swap
    ? { sig: 'K' + P + 'K', p: P, strong, swap, wk: bk ^ 56, bk: wk ^ 56, x: x ^ 56, wtm: turn === 'b' }
    : { sig: 'K' + P + 'K', p: P, strong, swap, wk, bk, x, wtm: turn !== 'b' };
}

export function tbFromBytes({ kqk = null, krk = null, kpk = null } = {}) {
  const bytes = b => (b == null ? null : b instanceof Uint8Array ? b : new Uint8Array(b));
  const T = { KQK: bytes(kqk), KRK: bytes(krk), KPK: bytes(kpk) };
  for (const [k, n] of [['KQK', 'kqk'], ['KRK', 'krk'], ['KPK', 'kpk']])
    if (T[k] && T[k].length !== SIZES[n]) throw new Error(`Table ${n} : ${T[k].length} octets au lieu de ${SIZES[n]}`);

  // Valeur brute, blanc au trait, coordonnées normalisées.
  function lookW(sig, wk, bk, x) {
    const t = T[sig];
    if (!t) return ILL;
    if (sig === 'KPK') {
      if (F(x) > 3) { wk ^= 7; bk ^= 7; x ^= 7; }
      const r = R(x);
      return r < 1 || r > 6 ? ILL : t[(wk * 64 + bk) * 24 + (r - 1) * 4 + F(x)];
    }
    if (F(wk) > 3) { wk ^= 7; bk ^= 7; x ^= 7; }
    if (R(wk) > 3) { wk ^= 56; bk ^= 56; x ^= 56; }
    if (F(wk) < R(wk)) { wk = (F(wk) << 3) | R(wk); bk = (F(bk) << 3) | R(bk); x = (F(x) << 3) | R(x); }
    return t[(TRI_IDX[wk] * 64 + bk) * 64 + x];
  }
  // Noir au trait : un demi-coup du roi noir puis lecture. → { win, dist, n, draws, cap } ou null (illégal).
  function evalB(sig, wk, bk, x) {
    const p = PIECE[sig];
    if (!T[sig] || wk === bk || wk === x || bk === x || adj(wk, bk) || (p === 'P' && (R(x) === 0 || R(x) === 7))) return null;
    let n = 0, draws = 0, cap = false, mx = 0;
    for (const t of KING[bk]) {
      if (t === wk || adj(t, wk)) continue;
      if (t === x) { if (!adj(x, wk)) { n++; draws++; cap = true; } continue; }
      if (attacks(p, x, t, wk)) continue;
      n++;
      const v = lookW(sig, wk, t, x);
      if (v === 0 || v === ILL) draws++; else if (v > mx) mx = v;
    }
    if (!n) return attacks(p, x, bk, wk) ? { win: true, dist: 0, n, draws, cap } : { win: false, dist: null, n, draws, cap };
    return draws ? { win: false, dist: null, n, draws, cap } : { win: true, dist: mx, n, draws, cap };
  }
  const evalW = (sig, wk, bk, x) => {
    const v = lookW(sig, wk, bk, x);
    return v === ILL ? null : { win: v > 0, dist: v || null };
  };
  // Position normalisée légale et table chargée ?
  const legal = q => q && T[q.sig] && (q.wtm ? lookW(q.sig, q.wk, q.bk, q.x) !== ILL : !!evalB(q.sig, q.wk, q.bk, q.x));

  // Coups légaux du camp au trait (coordonnées normalisées), chacun évalué sur la position obtenue.
  function moves(q) {
    const { sig, p, wk, bk, x } = q, out = [];
    if (q.wtm) {
      const add = (from, to, nwk, nx, promo = null) => {
        let r, s = sig, mateDist;
        if (promo === 'b' || promo === 'n') { r = { win: false, dist: null }; s = null; }
        else if (promo) { s = promo === 'q' ? 'KQK' : 'KRK'; r = evalB(s, nwk, bk, nx) || { win: false, dist: null }; mateDist = r.win ? r.dist : null; }
        else r = evalB(sig, nwk, bk, nx);
        const m = { from, to, promo, capture: false, win: r.win, dist: r.dist, sig: s, next: { sig: s, wk: nwk, bk, x: nx, wtm: false } };
        if (promo) { m.dist = r.win ? 0 : null; m.mateDist = mateDist ?? null; } // KPK : promotion sûre = but atteint
        out.push(m);
      };
      for (const t of KING[wk]) if (t !== x && !adj(t, bk)) add(wk, t, t, x);
      if (p === 'P') {
        const y = x + 8;
        if (y !== wk && y !== bk) {
          if (R(y) === 7) for (const pr of 'qrbn') add(x, y, wk, y, pr);
          else {
            add(x, y, wk, y);
            if (R(x) === 1 && y + 8 !== wk && y + 8 !== bk) add(x, y + 8, wk, y + 8);
          }
        }
      } else slides(p, x, wk, bk, y => add(x, y, wk, y));
    } else {
      for (const t of KING[bk]) {
        if (t === wk || adj(t, wk)) continue;
        if (t === x) {
          if (!adj(x, wk)) out.push({ from: bk, to: t, promo: null, capture: true, win: false, dist: null, sig: null, next: null });
          continue;
        }
        if (attacks(p, x, t, wk)) continue;
        const r = evalW(sig, wk, t, x);
        out.push({ from: bk, to: t, promo: null, capture: false, win: r.win, dist: r.dist, sig, next: { sig, wk, bk: t, x, wtm: true } });
      }
    }
    return out;
  }
  const uciOf = (q, m) => {
    const f = q.swap ? m.from ^ 56 : m.from, t = q.swap ? m.to ^ 56 : m.to;
    return sqName(f) + sqName(t) + (m.promo || '');
  };
  // Tri : le meilleur coup du camp au trait d'abord (fort : gain le plus court ; défenseur : nulle, sinon le plus long).
  const order = (q, a, b) => q.wtm
    ? (b.win - a.win) || (a.win ? a.dist - b.dist : 0)
    : (a.win - b.win) || (b.capture - a.capture) || (a.win ? b.dist - a.dist : 0);
  const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  const keepMin = (list, key) => { const k = list.map(key), m = Math.min(...k); return list.filter((_, i) => k[i] === m); };
  const winReplies = pos => moves({ ...pos, p: PIECE[pos.sig], wtm: true }).filter(m => m.win).length;

  function signature(fen) {
    const q = parse(fen);
    return q ? { sig: q.sig, strong: q.strong } : null;
  }

  function probe(fen) {
    const q = parse(fen);
    if (!q || !T[q.sig]) return null;
    const r = q.wtm ? evalW(q.sig, q.wk, q.bk, q.x) : evalB(q.sig, q.wk, q.bk, q.x);
    return r && { sig: q.sig, strong: q.strong, win: r.win, dist: r.dist, mate: q.sig !== 'KPK' };
  }

  function rankMoves(fen) {
    const q = parse(fen);
    if (!legal(q)) return [];
    return moves(q).sort((a, b) => order(q, a, b) || (uciOf(q, a) < uciOf(q, b) ? -1 : 1))
      .map(m => ({ uci: uciOf(q, m), win: m.win, dist: m.dist, capture: m.capture, promo: m.promo, sig: m.sig, mateDist: m.mateDist ?? null }));
  }

  // Défenseur têtu (l'utilisateur attaque) : la nulle si elle existe, sinon le mat/la promotion le plus lointain ;
  // à égalité, le coup qui laisse le moins de coups gagnants à l'attaquant, puis le hasard.
  function stubborn(fen, rng = Math.random) {
    const q = parse(fen);
    if (!legal(q)) return null;
    if (q.wtm) return trap(fen, rng);
    const ms = moves(q);
    if (!ms.length) return null;
    const draws = ms.filter(m => !m.win), caps = draws.filter(m => m.capture);
    let pool;
    if (draws.length) pool = caps.length ? caps : draws;
    else {
      const d = Math.max(...ms.map(m => m.dist));
      pool = ms.filter(m => m.dist === d);
      if (pool.length > 1) pool = keepMin(pool, m => winReplies(m.next));
    }
    return uciOf(q, pick(pool, rng));
  }

  // Attaquant piégeur (l'utilisateur défend) : garde le gain s'il existe (le plus court) ; sinon, parmi les coups
  // qui ne lâchent pas la pièce (ni prise possible, ni pat, ni sous-promotion en fou/cavalier), celui qui laisse
  // le moins de réponses annulantes. Égalités : hasard.
  function trap(fen, rng = Math.random) {
    const q = parse(fen);
    if (!legal(q)) return null;
    if (!q.wtm) return stubborn(fen, rng);
    const ms = moves(q);
    if (!ms.length) return null;
    const wins = ms.filter(m => m.win);
    let pool;
    if (wins.length) pool = keepMin(wins, m => m.dist);
    else {
      const info = m => (m.next && m.next.sig ? evalB(m.next.sig, m.next.wk, m.next.bk, m.next.x) : null);
      const scored = ms.map(m => ({ m, r: info(m) }));
      let safe = scored.filter(({ r }) => r && !r.cap && r.n > 0);
      if (!safe.length) safe = scored;
      pool = keepMin(safe, ({ r }) => (r && r.n ? r.draws : 99)).map(({ m }) => m); // pat ou finale morte : en dernier
    }
    return uciOf(q, pick(pool, rng));
  }

  return { signature, probe, rankMoves, stubborn, trap, tables: T };
}

// Chargement (navigateur : fetch relatif à la page ; Node : passer un loader, cf. tools/test/tb-fs.mjs).
let cached = null;
export async function loadTB(loader = null) {
  const useCache = !loader;
  if (useCache && cached) return cached;
  const load = loader || (async name => {
    const r = await fetch('data/tb/' + name + '.bin');
    if (!r.ok) throw new Error(`Table ${name} introuvable (${r.status})`);
    return r.arrayBuffer();
  });
  const p = Promise.all(['kqk', 'krk', 'kpk'].map(n => load(n)))
    .then(([kqk, krk, kpk]) => tbFromBytes({ kqk, krk, kpk }));
  if (useCache) { cached = p; p.catch(() => { cached = null; }); }
  return p;
}
