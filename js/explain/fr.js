// Couche française de l'explicateur (spec §5.4) : lexique, accords, nombres, lignes, finition des phrases.
// Règles : « ta tour / ton fou », « protégée / protégé », « aucune case », « qu’une », « 1re rangée », « colonne e ».
// Les coups sont écrits en SAN française (frSan), en gras (**…**, rendu par l'interface). Chaque phrase passe par fr().
import { fr, frSan } from '../util.js';

export const PIECE = { k: ['roi', 'm'], q: ['dame', 'f'], r: ['tour', 'f'], b: ['fou', 'm'], n: ['cavalier', 'm'], p: ['pion', 'm'] };
const POSS = { m: 'ton', f: 'ta' }, ART = { m: 'le', f: 'la' }, SUBJ = { m: 'il', f: 'elle' };
const COLOR = { w: { m: 'blanc', f: 'blanche' }, b: { m: 'noir', f: 'noire' } };
const PART = { 'protégé': 'protégée', 'attaqué': 'attaquée', 'cloué': 'clouée', 'pris': 'prise', 'défendu': 'défendue' };

export const gender = t => PIECE[t][1];
export const pname = t => PIECE[t][0];
export const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const mine = t => `${POSS[gender(t)]} ${pname(t)}`;                         // ta tour, ton fou
export const theirs = (t, c) => `${ART[gender(t)]} ${pname(t)} ${COLOR[c][gender(t)]}`; // la dame noire, le cavalier blanc
export const king = c => `le roi ${COLOR[c].m}`;                                    // le roi noir
export const side = c => (c === 'w' ? 'les Blancs' : 'les Noirs');
export const subj = t => SUBJ[gender(t)];                                           // il / elle
export const obj = t => ART[gender(t)];                                             // le / la (pronom complément)
// Pronom complément élidé devant une voyelle : « la protéger », « l’attaquer », « le prend ».
export const pron = (t, verb) => (/^[aeiouyéèêh]/i.test(verb) ? `l’${verb}` : `${obj(t)} ${verb}`);
export const du = c => `du roi ${COLOR[c].m}`;                                      // du roi noir
export const au = c => `au roi ${COLOR[c].m}`;                                      // au roi noir
// Nom d'une pièce adverse : « le roi noir », « le fou noir ».
export const who = (t, c) => (t === 'k' ? king(c) : theirs(t, c));
export const agree = (w, t) => (gender(t) === 'f' ? PART[w] || w + 'e' : w);
export const alone = t => `${ART[gender(t)]} ${pname(t)} seul${gender(t) === 'f' ? 'e' : ''}`; // la tour seule

// Nombres
export const cases = n => (n === 0 ? 'aucune case' : n === 1 ? '1 case' : `${n} cases`);
export const coups = n => (n === 1 ? '1 coup' : `${n} coups`);
export const plusQue = n => (n === 0 ? 'plus aucune case' : n === 1 ? 'plus qu’une case' : `plus que ${n} cases`);
export const ord = n => (n === 1 ? '1re' : `${n}e`);
// Lignes (indices 0…7)
export const line = (kind, i) => (kind === 'file' ? `la colonne ${'abcdefgh'[i]}` : `la ${ord(i + 1)} rangée`);
export const lineNoun = kind => (kind === 'file' ? 'colonne' : 'rangée');
export const list = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} et ${xs.at(-1)}`);

// Coup en gras, notation française. `bare` retire + et #.
export const mv = (san, bare = false) => `**${frSan(bare ? san.replace(/[+#]/g, '') : san)}**`;

// Finition d'une phrase : espaces simples, majuscule initiale, ponctuation finale, typographie française.
export function finish(s) {
  let t = String(s).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = cap(t);
  if (!/[.!?…]$/.test(t)) t += '.';
  return fr(t);
}
// Longueur visible (sans les marques de gras).
export const visible = s => String(s).replace(/\*\*/g, '').length;
// Évaluation lisible du point de vue du joueur : « +3,1 », « −0,4 », « mat en 3 », « mat contre toi en 2 ».
export function evalText(v) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v >= 9000) return `mat en ${Math.round((10000 - v) / 10)}`;
  if (v <= -9000) return `mat contre toi en ${Math.round((10000 + v) / 10)}`;
  const x = Math.round(v / 10) / 10;
  return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1).replace('.', ',');
}
