// Échiquier interactif minimal : toucher-toucher ou glisser-déposer, surlignages, flèches,
// zones et repères pédagogiques, sélecteur de promotion.
//
// Options : orientation 'w'|'b' ; onMove(from, to, promo?) ; onSquare(sq) (mode « touche une case ») ;
//   onPromote(from, to, color) : si présent, un pion amené sur la dernière rangée ouvre le sélecteur
//   (4 pièces sur la case de promotion) puis le plateau appelle onMove(from, to, 'q'|'r'|'b'|'n').
//   onPromote peut renvoyer (directement ou par une promesse) une pièce : elle est jouée sans attendre
//   le choix. Toute autre valeur (undefined…) laisse le choix au sélecteur ; onPromote: true suffit donc.
//   Échap, un clic hors des pièces, setPosition() ou setOrientation() annulent : rien n’est joué.
//   Sans onPromote : onMove(from, to), l’appelant promeut en dame comme avant.
// Méthodes : setPosition(fen), setOrientation(c), setDests(Map), setLastMove(from, to),
//   setArrows([{from, to, cls}]) avec cls 'good'|'threat'|'hint'|'plan' (pointillés, 50 %),
//   mark(sq, cls|null), clearMarks(), setMarks({sq: cls} | null) (remplace tous les repères),
//   classes de repère : 'mark-ok', 'mark-ko', 'mark-hint', 'mark-key', 'mark-line', 'mark-escape' (point),
//   plusieurs classes possibles séparées par une espace,
//   setZone(squares Set|Array|null, cls = 'zone') : une zone à la fois ('zone' rouge, 'zone-ok', 'zone-key', 'zone-hint'),
//   setViz({zone, zoneCls, marks, arrows} | null) : tout le visuel d’une explication en un appel,
//   pickPromotion(to, color) → Promise<'q'|'r'|'b'|'n'|null>, cancelPromotion().
import { fr } from './util.js';

const FILES = 'abcdefgh';
const PROMOS = ['q', 'n', 'r', 'b'];
const PROMO_NAMES = { q: 'Dame', n: 'Cavalier', r: 'Tour', b: 'Fou' };
let uid = 0;

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.orientation = opts.orientation || 'w';
    this.onMove = opts.onMove || null;      // (from, to, promo?) => void
    this.onSquare = opts.onSquare || null;  // mode "touche une case"
    this.onPromote = opts.onPromote || null;
    this.dests = null;                       // Map from -> [to]
    this.pieces = {};                        // 'e4' -> 'wP'
    this.selected = null;
    this.lastMove = null;
    this.marks = {};                         // square -> class(es)
    this.zone = null;                        // Set de cases teintées (ex. la cage du roi)
    this.zoneCls = 'zone';
    this.arrows = [];
    this.promo = null;                       // sélecteur de promotion ouvert
    this.uid = ++uid;
    el.classList.add('board');
    el.innerHTML = '';
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.classList.add('board-arrows');
    el.append(this.grid, this.svg);
    this._bindPointer();
    this.render();
  }

  setPosition(fen) {
    this.cancelPromotion();
    this.pieces = {};
    const rows = fen.split(' ')[0].split('/');
    rows.forEach((row, r) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += +ch; continue; }
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        this.pieces[FILES[f] + (8 - r)] = color + ch.toUpperCase();
        f++;
      }
    });
    this.selected = null;
    this.render();
  }
  setOrientation(c) { this.cancelPromotion(); this.orientation = c; this.render(); }
  setDests(map) { this.dests = map; this.selected = null; this.render(); }
  setLastMove(from, to) { this.lastMove = from ? [from, to] : null; this.render(); }
  mark(square, cls) { if (cls) this.marks[square] = cls; else delete this.marks[square]; this.render(); }
  clearMarks() { this.marks = {}; this.render(); }
  setMarks(map) { this.marks = map ? (map instanceof Map ? Object.fromEntries(map) : { ...map }) : {}; this.render(); }
  setZone(squares, cls = 'zone') { this._zone(squares, cls); this.render(); }
  setArrows(list) { this.arrows = list || []; this._drawArrows(); }
  setViz(viz) {
    const v = viz || {};
    this._zone(v.zone, v.zoneCls || 'zone');
    this.marks = v.marks ? { ...v.marks } : {};
    this.arrows = v.arrows || [];
    this.render();
  }
  _zone(squares, cls) {
    const s = squares instanceof Set ? squares : new Set(squares || []);
    this.zone = s.size ? s : null;
    this.zoneCls = cls || 'zone';
  }

  _squares() {
    const out = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const file = this.orientation === 'w' ? f : 7 - f;
      const rank = this.orientation === 'w' ? 7 - r : r;
      out.push(FILES[file] + (rank + 1));
    }
    return out;
  }

  render() {
    const frag = document.createDocumentFragment();
    const sqs = this._squares();
    const targets = this.selected && this.dests ? (this.dests.get(this.selected) || []) : [];
    // Pendant le choix de la promotion, le pion est montré sur sa case d’arrivée.
    let pieces = this.pieces;
    const pv = this.promo && this.promo.from;
    if (pv && pieces[pv]) { pieces = { ...pieces, [this.promo.to]: pieces[pv] }; delete pieces[pv]; }
    sqs.forEach((sq, i) => {
      const d = document.createElement('div');
      const fi = FILES.indexOf(sq[0]), ra = +sq[1] - 1;
      d.className = 'sq ' + ((fi + ra) % 2 ? 'light' : 'dark');
      d.dataset.sq = sq;
      if (this.lastMove && this.lastMove.includes(sq)) d.classList.add('last');
      if (this.selected === sq) d.classList.add('selected');
      if (this.marks[sq]) d.classList.add(...String(this.marks[sq]).split(/\s+/).filter(Boolean));
      if (this.zone && this.zone.has(sq)) d.classList.add(this.zoneCls);
      if (targets.includes(sq)) d.classList.add(pieces[sq] ? 'target-capture' : 'target');
      const p = pieces[sq];
      if (p) {
        const img = document.createElement('img');
        img.src = `assets/pieces/${p}.svg`;
        img.alt = '';
        img.draggable = false;
        img.className = 'piece';
        d.append(img);
      }
      // coordonnées sur les bords
      if (i % 8 === 0) d.insertAdjacentHTML('beforeend', `<span class="coord rank">${sq[1]}</span>`);
      if (i >= 56) d.insertAdjacentHTML('beforeend', `<span class="coord file">${sq[0]}</span>`);
      frag.append(d);
    });
    this.grid.replaceChildren(frag);
    this._drawArrows();
  }

  // Position à l’écran : [colonne, rangée] de 0 à 7, rangée 0 en haut.
  _cell(sq) {
    let x = FILES.indexOf(sq[0]), y = 8 - +sq[1];
    if (this.orientation === 'b') { x = 7 - x; y = 7 - y; }
    return [x, y];
  }
  _center(sq) { const [x, y] = this._cell(sq); return [x + 0.5, y + 0.5]; }
  _drawArrows() {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg.replaceChildren();
    const defs = document.createElementNS(ns, 'defs');
    this.svg.append(defs);
    this.arrows.forEach(({ from, to, cls = 'good' }, i) => {
      if (!from || !to || from === to) return;
      const id = `ah${this.uid}-${cls}-${i}`;
      const m = document.createElementNS(ns, 'marker');
      m.setAttribute('id', id); m.setAttribute('viewBox', '0 0 10 10');
      m.setAttribute('refX', '5'); m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '3'); m.setAttribute('markerHeight', '3');
      m.setAttribute('orient', 'auto');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M0,0 L10,5 L0,10 z');
      path.setAttribute('class', 'arrow-head ' + cls);
      m.append(path); defs.append(m);
      const [x1, y1] = this._center(from), [x2, y2] = this._center(to);
      const len = Math.hypot(x2 - x1, y2 - y1), k = (len - 0.35) / len;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', x1 + (x2 - x1) * k); line.setAttribute('y2', y1 + (y2 - y1) * k);
      line.setAttribute('class', 'arrow ' + cls);
      line.setAttribute('marker-end', `url(#${id})`);
      this.svg.append(line);
    });
  }

  _sqAt(x, y) {
    const r = this.grid.getBoundingClientRect();
    if (x < r.left || y < r.top || x >= r.right || y >= r.bottom) return null;
    const c = Math.floor((x - r.left) / (r.width / 8)), row = Math.floor((y - r.top) / (r.height / 8));
    return this._squares()[row * 8 + c];
  }

  _tap(sq) {
    if (this.onSquare) { this.onSquare(sq); return; }
    if (!this.dests) return;
    if (this.selected && (this.dests.get(this.selected) || []).includes(sq)) {
      this._move(this.selected, sq);
      return;
    }
    this.selected = this.dests.has(sq) ? (this.selected === sq ? null : sq) : null;
    this.render();
  }

  // Coup de l’utilisateur (déjà validé par dests) : promotion éventuelle, puis onMove.
  _move(from, to) {
    this.selected = null;
    const p = this.pieces[from];
    if (this.onPromote && p && p[1] === 'P' && to[1] === (p[0] === 'w' ? '8' : '1')) {
      this._promote(from, to, p[0]);
      return;
    }
    this.render();
    this.onMove && this.onMove(from, to);
  }

  async _promote(from, to, color) {
    let hook;
    try { hook = typeof this.onPromote === 'function' ? this.onPromote(from, to, color) : undefined; }
    catch (e) { console.error(e); }
    let piece = PROMOS.includes(hook) ? hook : null;
    if (!piece) {
      const pick = this.pickPromotion(to, color, from);
      const box = this.promo;
      if (hook && typeof hook.then === 'function') {
        hook.then(v => { if (PROMOS.includes(v) && this.promo === box) this._closePromo(v); }, e => console.error(e));
      }
      piece = await pick;
    }
    if (!piece) return;
    this.render();
    this.onMove && this.onMove(from, to, piece);
  }

  // Sélecteur de promotion : 4 boutons en colonne depuis la case `to`, vers le centre de l’échiquier.
  // Résout la pièce choisie, ou null si l’utilisateur annule.
  pickPromotion(to, color = 'w', from = null) {
    this.cancelPromotion();
    const [col, row] = this._cell(to);
    const down = row < 4;
    const ov = document.createElement('div');
    ov.className = 'promo';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', fr('Promotion : choisis une pièce'));
    const colEl = document.createElement('div');
    colEl.className = 'promo-col ' + (down ? 'down' : 'up');
    colEl.style.left = `${col * 12.5}%`;
    colEl.style[down ? 'top' : 'bottom'] = `${(down ? row : 7 - row) * 12.5}%`;
    const buttons = PROMOS.map(p => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'promo-btn';
      b.dataset.piece = p;
      b.setAttribute('aria-label', PROMO_NAMES[p]);
      b.title = PROMO_NAMES[p];
      b.innerHTML = `<img src="assets/pieces/${color}${p.toUpperCase()}.svg" alt="" draggable="false">`;
      return b;
    });
    colEl.append(...buttons);
    ov.append(colEl);

    let armed = false;
    const box = { from, to, color, el: ov, prevFocus: document.activeElement, resolve: null };
    const promise = new Promise(res => { box.resolve = res; });
    // Un clic n’est pris en compte que si le geste a commencé dans le sélecteur
    // (sinon le « clic » du toucher qui l’a ouvert choisirait la dame tout seul) ; clavier : detail = 0.
    ov.addEventListener('pointerdown', e => {
      if (e.target.closest('.promo-btn')) { armed = true; return; }
      e.preventDefault();
      this._closePromo(null);
    });
    ov.addEventListener('click', e => {
      const b = e.target.closest('.promo-btn');
      if (b && (armed || e.detail === 0)) this._closePromo(b.dataset.piece);
    });
    ov.addEventListener('keydown', e => {
      const i = buttons.indexOf(document.activeElement);
      let j = null;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') j = i + ((e.key === 'ArrowDown') === down ? 1 : -1);
      else if (e.key === 'Tab') j = i + (e.shiftKey ? -1 : 1);
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = 3;
      if (j === null) return;
      e.preventDefault();
      buttons[(j + 4) % 4].focus();
    });
    box.onKey = e => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      this._closePromo(null);
    };
    // Clic ailleurs dans la page (hors de l’échiquier) : annule aussi.
    box.onDown = e => { if (!ov.contains(e.target)) this._closePromo(null); };
    document.addEventListener('keydown', box.onKey, true);
    document.addEventListener('pointerdown', box.onDown, true);

    this.promo = box;
    this.selected = null;
    this.el.append(ov);
    this.render();
    // Après la fin du geste en cours (sinon le mousedown qui suit reprendrait le focus).
    setTimeout(() => { if (this.promo === box) buttons[0].focus({ preventScroll: true }); });
    return promise;
  }
  cancelPromotion() { if (this.promo) this._closePromo(null); }
  _closePromo(piece) {
    const box = this.promo;
    if (!box) return;
    this.promo = null;
    document.removeEventListener('keydown', box.onKey, true);
    document.removeEventListener('pointerdown', box.onDown, true);
    const hadFocus = box.el.contains(document.activeElement);
    box.el.remove();
    if (hadFocus && box.prevFocus && box.prevFocus.isConnected && box.prevFocus.focus) box.prevFocus.focus({ preventScroll: true });
    this.render();                            // pièces remises en place
    box.resolve(piece || null);
  }

  _bindPointer() {
    let drag = null;
    this.grid.addEventListener('pointerdown', e => {
      if (this.promo) return;
      const sq = this._sqAt(e.clientX, e.clientY);
      if (!sq) return;
      if (this.onSquare || !this.dests || !this.dests.has(sq)) { this._tap(sq); return; }
      e.preventDefault();
      const img = this.grid.querySelector(`[data-sq="${sq}"] .piece`);
      drag = { sq, x: e.clientX, y: e.clientY, moved: false, img, wasSelected: this.selected === sq };
      if (!drag.wasSelected) { this.selected = sq; this.render(); drag.img = this.grid.querySelector(`[data-sq="${sq}"] .piece`); }
      this.grid.setPointerCapture(e.pointerId);
    });
    this.grid.addEventListener('pointermove', e => {
      if (!drag || !drag.img) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      drag.img.classList.add('dragging');
      drag.img.style.transform = `translate(${dx}px, ${dy}px) scale(1.15)`;
    });
    const end = e => {
      if (!drag) return;
      const d = drag; drag = null;
      if (d.img) { d.img.style.transform = ''; d.img.classList.remove('dragging'); }
      const sq = this._sqAt(e.clientX, e.clientY);
      if (d.moved) {
        if (sq && sq !== d.sq && this.dests && (this.dests.get(d.sq) || []).includes(sq)) this._move(d.sq, sq);
        else this.render();
      } else if (d.wasSelected) { this.selected = null; this.render(); }
    };
    this.grid.addEventListener('pointerup', end);
    this.grid.addEventListener('pointercancel', end);
  }
}
