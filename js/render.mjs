// 図面（ezjww の読み取り結果）を SVG で描く。拡大・移動と、根拠になった文字の強調表示。
const SVGNS = "http://www.w3.org/2000/svg";
const el = (name, attrs = {}) => {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const key = (x, y) => `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;

export class DrawingView {
  constructor(host) {
    this.host = host;
    this.svg = el("svg", { class: "drawing" });
    this.content = el("g");
    this.marks = el("g", { class: "marks" });
    this.svg.append(this.content, this.marks);
    host.append(this.svg);
    this.texts = new Map();
    this.view = null;
    this.#bindPanZoom();
    new ResizeObserver(() => this.view && this.#apply()).observe(host);
  }

  load(doc) {
    this.content.replaceChildren();
    this.marks.replaceChildren();
    this.texts.clear();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, -y); maxY = Math.max(maxY, -y); };
    const frag = document.createDocumentFragment();
    for (const e of doc.entities) {
      if (e.type === "LINE") {
        frag.append(el("line", { x1: e.start_x, y1: -e.start_y, x2: e.end_x, y2: -e.end_y, class: `pen${e.base.pen_color}` }));
        grow(e.start_x, e.start_y); grow(e.end_x, e.end_y);
      } else if (e.type === "CIRCLE" || e.type === "ARC") {
        const r = e.radius, cx = e.center_x, cy = e.center_y;
        if (e.is_full_circle || Math.abs((e.arc_angle ?? 7) - 2 * Math.PI) < 1e-6 || e.arc_angle == null) {
          frag.append(el("circle", { cx, cy: -cy, r, class: `pen${e.base.pen_color}` }));
        } else {
          const a0 = e.start_angle, a1 = e.start_angle + e.arc_angle;
          const p = (a) => [cx + r * Math.cos(a), -(cy + r * Math.sin(a))];
          const [x0, y0] = p(a0), [x1, y1] = p(a1);
          frag.append(el("path", { d: `M${x0},${y0} A${r},${r} 0 ${e.arc_angle > Math.PI ? 1 : 0} 0 ${x1},${y1}`, class: `pen${e.base.pen_color}` }));
        }
        grow(cx - r, cy - r); grow(cx + r, cy + r);
      } else if (e.type === "TEXT") {
        const len = Math.hypot(e.end_x - e.start_x, e.end_y - e.start_y);
        const h = e.size_y || 2.5;
        const g = el("g", { transform: `translate(${e.start_x},${-e.start_y}) rotate(${-e.angle})` });
        const t = el("text", { x: 0, y: 0, "font-size": h });
        if (len > 0) { t.setAttribute("textLength", len); t.setAttribute("lengthAdjust", "spacingAndGlyphs"); }
        t.textContent = e.content;
        g.append(t);
        frag.append(g);
        this.texts.set(key(e.start_x, e.start_y), { e, len: len || h * e.content.length * 0.6, h });
        grow(e.start_x, e.start_y); grow(e.end_x, e.end_y);
      }
    }
    this.content.append(frag);
    this.bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    this.fit();
  }

  fit() {
    const b = this.bounds, pad = 6;
    this.view = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    this.#apply();
  }

  #apply() {
    const { clientWidth: W, clientHeight: H } = this.host;
    if (!W || !H) return;
    const v = this.view, s = Math.min(W / v.w, H / v.h);
    const w = W / s, h = H / s;
    this.svg.setAttribute("viewBox", `${v.x + (v.w - w) / 2} ${v.y + (v.h - h) / 2} ${w} ${h}`);
    this.scale = s;
  }

  /** 根拠の文字を赤枠で囲み、そこへ寄る。evidences: [{x, y, text}]。tone: "error" | "warn" | "info" */
  highlight(evidences, tone = "error", { zoom = true } = {}) {
    this.marks.replaceChildren();
    const boxes = [];
    for (const ev of (evidences ?? []).filter(Boolean)) {
      const hit = this.texts.get(key(ev.x, ev.y));
      if (!hit) continue;
      const { e, len, h } = hit, m = 0.9;
      const g = el("g", { transform: `translate(${e.start_x},${-e.start_y}) rotate(${-e.angle})` });
      g.append(el("rect", { x: -m, y: -h - m, width: len + 2 * m, height: h + 2 * m, rx: 0.8, class: `mark ${tone}` }));
      this.marks.append(g);
      const a = (-e.angle * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
      for (const [px, py] of [[0, 0], [len, 0], [0, -h], [len, -h]]) boxes.push([e.start_x + px * cs - py * sn, -e.start_y + px * sn + py * cs]);
    }
    if (zoom && boxes.length) {
      const xs = boxes.map((p) => p[0]), ys = boxes.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs), hh = Math.max(...ys) - Math.min(...ys);
      const pad = Math.max(25, w * 0.6, hh * 0.6);
      this.view = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: w + 2 * pad, h: hh + 2 * pad };
      this.#apply();
    }
    return boxes.length;
  }

  clear() { this.marks.replaceChildren(); }

  #bindPanZoom() {
    let drag = null;
    this.svg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      if (!this.view) return;
      const r = this.svg.getBoundingClientRect(), vb = this.svg.viewBox.baseVal;
      const px = vb.x + ((ev.clientX - r.left) / r.width) * vb.width, py = vb.y + ((ev.clientY - r.top) / r.height) * vb.height;
      const k = Math.exp(ev.deltaY * 0.0015);
      const v = this.view;
      this.view = { x: px - (px - v.x) * k, y: py - (py - v.y) * k, w: v.w * k, h: v.h * k };
      this.#apply();
    }, { passive: false });
    this.svg.addEventListener("pointerdown", (ev) => { drag = { x: ev.clientX, y: ev.clientY, v: { ...this.view } }; this.svg.setPointerCapture(ev.pointerId); });
    this.svg.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const r = this.svg.getBoundingClientRect(), vb = this.svg.viewBox.baseVal;
      const dx = ((ev.clientX - drag.x) / r.width) * vb.width, dy = ((ev.clientY - drag.y) / r.height) * vb.height;
      this.view = { ...drag.v, x: drag.v.x - dx, y: drag.v.y - dy };
      this.#apply();
    });
    this.svg.addEventListener("pointerup", () => (drag = null));
  }
}
