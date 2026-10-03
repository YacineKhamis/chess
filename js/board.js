// Échiquier interactif minimal : toucher-toucher ou glisser-déposer, surlignages, flèches.
const FILES = 'abcdefgh';

export class Board {
  constructor(el, opts = {}) {
    this.el = el;
    this.orientation = opts.orientation || 'w';
    this.onMove = opts.onMove || null;      // (from, to) => void
    this.onSquare = opts.onSquare || null;  // mode "touche une case"
    this.dests = null;                       // Map from -> [to]
    this.pieces = {};                        // 'e4' -> 'wP'
    this.selected = null;
    this.lastMove = null;
    this.marks = {};                         // square -> class
    this.arrows = [];
    el.classList.add('board');
    el.innerHTML = '';
    this.grid = document.createElement('div');
    this.grid.className = 'board-grid';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', '0 0 8 8');
    this.svg.classList.add('board-arrows');
    el.append(this.grid, this.svg);
    this._bindPointer();
    this.render();
  }

  setPosition(fen) {
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
  setOrientation(c) { this.orientation = c; this.render(); }
  setDests(map) { this.dests = map; this.selected = null; this.render(); }
  setLastMove(from, to) { this.lastMove = from ? [from, to] : null; this.render(); }
  mark(square, cls) { this.marks[square] = cls; this.render(); }
  clearMarks() { this.marks = {}; this.render(); }
  setArrows(list) { this.arrows = list || []; this._drawArrows(); }

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
    sqs.forEach((sq, i) => {
      const d = document.createElement('div');
      const fi = FILES.indexOf(sq[0]), ra = +sq[1] - 1;
      d.className = 'sq ' + ((fi + ra) % 2 ? 'light' : 'dark');
      d.dataset.sq = sq;
      if (this.lastMove && this.lastMove.includes(sq)) d.classList.add('last');
      if (this.selected === sq) d.classList.add('selected');
      if (this.marks[sq]) d.classList.add(this.marks[sq]);
      if (targets.includes(sq)) d.classList.add(this.pieces[sq] ? 'target-capture' : 'target');
      const p = this.pieces[sq];
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

  _center(sq) {
    let x = FILES.indexOf(sq[0]), y = 8 - +sq[1];
    if (this.orientation === 'b') { x = 7 - x; y = 7 - y; }
    return [x + 0.5, y + 0.5];
  }
  _drawArrows() {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg.replaceChildren();
    const defs = document.createElementNS(ns, 'defs');
    this.svg.append(defs);
    this.arrows.forEach(({ from, to, cls = 'good' }, i) => {
      const id = `ah-${cls}-${i}`;
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
      const from = this.selected; this.selected = null; this.render();
      this.onMove && this.onMove(from, sq);
      return;
    }
    this.selected = this.dests.has(sq) ? (this.selected === sq ? null : sq) : null;
    this.render();
  }

  _bindPointer() {
    let drag = null;
    this.grid.addEventListener('pointerdown', e => {
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
        if (sq && sq !== d.sq && (this.dests.get(d.sq) || []).includes(sq)) {
          this.selected = null; this.render();
          this.onMove && this.onMove(d.sq, sq);
        } else { this.render(); }
      } else if (d.wasSelected) { this.selected = null; this.render(); }
    };
    this.grid.addEventListener('pointerup', end);
    this.grid.addEventListener('pointercancel', end);
  }
}
