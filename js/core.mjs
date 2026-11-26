// 数量拾いの中核（ブラウザ・Node 共通）。poc/takeoff_extract.py・takeoff_rules.py・takeoff_checks.py の移植。
// 入力は ezjww の readDocument() が返す図面データ。図面はどこにも送らず、この中だけで処理する。

// ---------------------------------------------------------------- 共通

export const nfkc = (s) => (s ?? "").normalize("NFKC");
const nows = (s) => nfkc(s).replace(/\s+/g, "");
const r2 = (v) => Math.round(v * 100) / 100;

export function loadTexts(doc) {
  return doc.entities.filter((e) => e.type === "TEXT").map((t) => ({
    raw: t.content, text: nfkc(t.content).trim(),
    x: r2(t.start_x), y: r2(t.start_y), end_x: r2(t.end_x), end_y: r2(t.end_y),
    rot: Math.round(t.angle * 10) / 10, layer: t.base.layer, size: t.size_y,
  }));
}

export function loadLines(doc) {
  return doc.entities.filter((e) => e.type === "LINE").map((l) => [l.start_x, l.start_y, l.end_x, l.end_y]);
}

const ev = (t) => ({ text: t.raw, x: t.x, y: t.y, rot: t.rot });

// ---------------------------------------------------------------- 規則（入力シート）

// 管種 → 外径 (m)。土被り = 地盤高 − 管底高 − 外径（説明会で投影された縦断図で確認済み）
export const PIPE_OD = { "VUφ150": 0.165, "VUφ200": 0.216, "VUφ250": 0.267 };
// 入力シートのコード（仮。説明会の投影画面から読んだもの）
export const PIPE_CODE = { "VUφ150": 1, "VUφ200": 2, "VUφ250": 3 };
export const MH_CODE = { "管止め": 1, "組立1号": 2, "点検孔": 3 };

export const PIPE_COLUMNS = [
  "路線番号", "測点番号(下流側)", "人孔種別(下流側)", "人孔コード(下流側)",
  "測点番号(上流側)", "人孔種別(上流側)", "人孔コード(上流側)",
  "管種・管径", "管種コード", "区間距離", "土被り(下流側)", "土被り(上流側)", "国費/単独",
  "基礎材", "外副管", "舗装幅員", "表層+プライム", "上層(瀝安)", "路盤上層(粒調)", "路盤下層(RC-40)",
  "舗装切断", "仮舗装", "バックホウ規格",
];
export const PIPE_FILLED = PIPE_COLUMNS.slice(0, 13);
export const MH_COLUMNS = ["人孔No.", "人孔種別", "人孔深",
  "接続管種(東)", "接続管種(西)", "接続管種(南)", "接続管種(北)", "荷重", "底部工", "調整", "基礎工"];
export const MH_FILLED = MH_COLUMNS.slice(0, 3);

export const pipeOd = (pipe) => PIPE_OD[nows(pipe)];

export function mhKind(typeText) {
  const s = nows(typeText ?? "");
  if (!s) return null;
  for (const [pat, kind] of [[/組立1号|1号組立/, "組立1号"], [/組立2号|2号組立/, "組立2号"], [/組立3号|3号組立/, "組立3号"],
    [/楕円/, "組立楕円"], [/小型/, "小型"], [/点検/, "点検孔"], [/管止/, "管止め"]]) {
    if (pat.test(s)) return kind;
  }
  return s;
}

/** 管路全体の流れ。+1 = 左が上流、-1 = 左が下流。区間ごとの向きの多数決（1か所の誤記でひっくり返らない）。 */
export function flowDirection(work) {
  const mh = work.mh;
  let votes = 0;
  for (let k = 0; k < mh.length - 1; k++) {
    const a = mh[k].invR, b = mh[k + 1].invL;
    if (a != null && b != null && a !== b) votes += a > b ? 1 : -1;
  }
  if (votes) return votes > 0 ? 1 : -1;
  const first = mh[0].invR, last = mh[mh.length - 1].invL;
  return first != null && last != null && first < last ? -1 : 1;
}

function spanEnds(work, k, dir) {
  const a = work.mh[k], b = work.mh[k + 1];
  return dir > 0
    ? { up: a, dn: b, coverUp: a.coverR, coverDn: b.coverL, upIdx: k, dnIdx: k + 1 }
    : { up: b, dn: a, coverUp: b.coverL, coverDn: a.coverR, upIdx: k + 1, dnIdx: k };
}

const fmt = (v, dec) => (v == null ? "" : v.toFixed(dec));

/** 入力シート（管きょ・人孔）の行。値は図面から読んだものをそのまま使う。src は各セルの根拠（図面上の文字）。 */
export function buildInputSheet(work) {
  const dir = flowDirection(work);
  const pipeRows = work.spans.map((sp, k) => {
    const e = spanEnds(work, k, dir);
    const kd = mhKind(e.dn.type), ku = mhKind(e.up.type);
    const row = Object.fromEntries(PIPE_COLUMNS.map((c) => [c, ""]));
    Object.assign(row, {
      "路線番号": sp.route ?? "",
      "測点番号(下流側)": e.dn.name, "人孔種別(下流側)": kd ?? "", "人孔コード(下流側)": MH_CODE[kd] ?? "",
      "測点番号(上流側)": e.up.name, "人孔種別(上流側)": ku ?? "", "人孔コード(上流側)": MH_CODE[ku] ?? "",
      "管種・管径": sp.pipe, "管種コード": PIPE_CODE[nows(sp.pipe)] ?? "",
      "区間距離": fmt(sp.length, 2),
      "土被り(下流側)": fmt(e.coverDn, 2), "土被り(上流側)": fmt(e.coverUp, 2),
      "国費/単独": sp.fund ?? "",
    });
    const dnSide = dir > 0 ? "coverL" : "coverR", upSide = dir > 0 ? "coverR" : "coverL";
    row._src = {
      "路線番号": sp.evidence?.route, "管種・管径": sp.evidence?.pipe, "区間距離": sp.evidence?.length ?? e.dn.evidence?.dist ?? e.up.evidence?.dist,
      "測点番号(下流側)": e.dn.evidence?.station, "測点番号(上流側)": e.up.evidence?.station,
      "人孔種別(下流側)": e.dn.evidence?.type, "人孔種別(上流側)": e.up.evidence?.type,
      "土被り(下流側)": e.dn.evidence?.[dnSide], "土被り(上流側)": e.up.evidence?.[upSide], "国費/単独": sp.evidence?.fund,
    };
    row._span = k;
    return row;
  });
  const mhRows = work.mh.map((m, k) => {
    const row = Object.fromEntries(MH_COLUMNS.map((c) => [c, ""]));
    Object.assign(row, { "人孔No.": m.name, "人孔種別": mhKind(m.type) ?? "", "人孔深": fmt(m.depth, 3) });
    row._src = { "人孔No.": m.evidence?.station, "人孔種別": m.evidence?.type, "人孔深": m.evidence?.depth ?? m.evidence?.type };
    row._mh = k;
    return row;
  });
  return { "管きょ": pipeRows, "人孔": mhRows, direction: dir };
}

// ---------------------------------------------------------------- 縦断図の抽出

const SYNONYMS = {
  route: ["管路番号", "路線番号", "管渠番号"],
  pipe: ["管種・管径", "管種管径", "管径", "管種"],
  slope: ["勾配(‰)", "勾配", "管渠勾配"],
  length: ["延長(m)", "延長", "区間延長", "管渠延長"],
  depth: ["人孔深", "マンホール深", "MH深", "人孔深さ"],
  cover: ["土被り", "土かぶり"],
  invert: ["計画管底高", "管底高"],
  ground: ["計画地盤高", "地盤高"],
  cum: ["追加距離", "累加距離", "累計距離"],
  dist: ["単距離", "区間距離"],
  station: ["測点", "マンホール番号", "人孔番号"],
};
export const ROW_LABELS = { route: "管路番号", pipe: "管径", slope: "勾配", length: "延長", depth: "人孔深", cover: "土被り",
  invert: "管底高", ground: "地盤高", cum: "追加距離", dist: "区間距離", station: "測点" };
const LABEL_TO_KEY = Object.fromEntries(Object.entries(SYNONYMS).flatMap(([k, ns]) => ns.map((n) => [nows(n), k])));

const MH_NAME = String.raw`(?:No\.\d+|M\d+)`;
const RE_NUM = /^\(?(-?\d+(?:\.\d+)?)\)?$/;
const RE_PIPE = /^(?:VU|VP|HP|K1|PRP)φ\d+$/;
const RE_PIPE_LABEL = /((?:VU|VP|HP|K1|PRP)φ\d+)\s*L=(\d+(?:\.\d+)?)m\s*i=(\d+(?:\.\d+)?)‰/;
const RE_LAT_LABEL = /^((?:VU|VP)φ\d+)\s*L=(\d+(?:\.\d+)?)m$/;
const RE_MH_NAME = new RegExp(`^${MH_NAME}$`);
const RE_PROFILE_MH = new RegExp(String.raw`^(${MH_NAME})\s+(.+?)\s+H\s*=\s*(\d+(?:\.\d+)?)\s*m?$`);
const RE_ROUTE_NO = /^\d{3,5}(?:-\d+)?$/;
const RE_SUMMARY_L = /(?:管路|管渠|管きょ)\S*工\s*L\s*=\s*(\d+(?:\.\d+)?)\s*m/;
const RE_SUMMARY_N = /(\S+?)工\s*N\s*=\s*(\d+)\s*箇所/;
const FUND_WORDS = { "国費": "国費", "単独": "単独", "単独費": "単独", "市単": "単独", "市単独": "単独" };

export function extractProfile(doc, name = "縦断図") {
  const texts = loadTexts(doc), lines = loadLines(doc), warnings = [];
  const labels = {};
  for (const t of texts) {
    const key = LABEL_TO_KEY[nows(t.text)];
    if (key && t.rot === 0) labels[key] = t;
  }
  if (!labels.station) throw new Error("縦断図の帯に『測点』行が見つかりません。縦断図のファイルか確認してください。");
  const labelX = Math.max(...Object.values(labels).map((t) => t.x));
  const ys = [...new Set(lines.filter(([x1, y1, x2, y2]) => Math.abs(y1 - y2) < 1e-6 && Math.abs(x2 - x1) > 100 && Math.min(x1, x2) <= labelX)
    .map(([, y1]) => r2(y1)))].sort((a, b) => a - b);
  const rowOf = (y) => { for (let i = 0; i < ys.length - 1; i++) if (ys[i] - 0.01 <= y && y <= ys[i + 1] + 0.01) return [ys[i], ys[i + 1]]; return null; };
  const rowRanges = Object.fromEntries(Object.entries(labels).map(([k, t]) => [k, rowOf(t.y)]));
  const bandTop = Math.max(...Object.values(rowRanges).filter(Boolean).map((r) => r[1]));
  const bandBottom = Math.min(...Object.values(rowRanges).filter(Boolean).map((r) => r[0]));
  const textsInRow = (key) => {
    const rng = rowRanges[key];
    if (!rng) return [];
    return texts.filter((t) => t !== labels[key] && rng[0] <= t.y && t.y <= rng[1] && t.x > labelX + 10);
  };

  const st = textsInRow("station").sort((a, b) => a.x - b.x);
  const colX = st.map((t) => t.x);
  const nearestCol = (x, tol = 6) => {
    let k = 0;
    for (let i = 1; i < colX.length; i++) if (Math.abs(colX[i] - x) < Math.abs(colX[k] - x)) k = i;
    return Math.abs(colX[k] - x) < tol ? k : null;
  };
  const mh = st.map((t) => ({ name: t.text, type: null, ground: null, depth: null, depth_label: null, invL: null, invR: null,
    coverL: null, coverR: null, cum: null, dist: null, conns: [], evidence: { station: ev(t) } }));

  for (const key of ["ground", "depth", "cover", "invert", "cum", "dist"]) {
    const perCol = new Map();
    for (const t of textsInRow(key)) {
      const m = RE_NUM.exec(t.text.replace(/ /g, ""));
      const k = nearestCol(t.x);
      if (!m || k == null) { warnings.push(`縦断図 ${ROW_LABELS[key]} 行で解釈できない文字: 「${t.raw}」`); continue; }
      if (!perCol.has(k)) perCol.set(k, []);
      perCol.get(k).push([t, parseFloat(m[1])]);
    }
    for (const [k, vals] of perCol) {
      vals.sort((a, b) => a[0].x - b[0].x);                 // 左の値 = 左側の区間の管
      if (key === "invert" || key === "cover") {
        const f = key === "invert" ? "inv" : "cover";
        if (vals.length > 2) warnings.push(`縦断図 ${mh[k].name} の ${ROW_LABELS[key]} に値が${vals.length}つあります`);
        const [tl, vl] = vals[0], [tr, vr] = vals[vals.length - 1];
        mh[k][f + "L"] = vl; mh[k][f + "R"] = vr;
        mh[k].evidence[f + "L"] = ev(tl); mh[k].evidence[f + "R"] = ev(tr);
      } else {
        if (vals.length > 1) warnings.push(`縦断図 ${mh[k].name} の ${ROW_LABELS[key]} に値が2つあります`);
        const [t, v] = vals[vals.length - 1];
        mh[k][key] = v; mh[k].evidence[key] = ev(t);
      }
    }
  }

  const spans = [];
  for (let k = 0; k < mh.length - 1; k++) spans.push({ from_: mh[k].name, to: mh[k + 1].name, route: null, pipe: null, slope: null,
    length: null, length_from: null, fund: null, evidence: {} });
  const spanOf = (x) => { for (let i = 0; i < colX.length - 1; i++) if (colX[i] < x && x < colX[i + 1]) return i; return null; };
  for (const key of ["route", "pipe", "slope", "length"]) {
    for (const t of textsInRow(key)) {
      const k = spanOf((t.x + t.end_x) / 2);
      if (k == null) { warnings.push(`縦断図 ${ROW_LABELS[key]} 行の文字が区間に当てはまりません: 「${t.raw}」`); continue; }
      let val;
      if (key === "pipe" || key === "route") val = t.text.replace(/ /g, "");
      else {
        const m = /^(\d+(?:\.\d+)?)/.exec(t.text.replace(/ /g, ""));
        if (!m) { warnings.push(`縦断図 ${ROW_LABELS[key]} 行で数値が読めません: 「${t.raw}」`); continue; }
        val = parseFloat(m[1]);
      }
      spans[k][key] = val; spans[k].evidence[key] = ev(t);
    }
  }
  // 同じ値が続く区間はまとめて1回だけ書く図面がある（豊川市の実図面）→ 隣の区間から補う
  for (const key of ["route", "pipe", "slope"]) {
    const have = spans.map((s, i) => (s[key] != null ? i : -1)).filter((i) => i >= 0);
    if (!have.length || have.length === spans.length) continue;
    spans.forEach((s, k) => {
      if (s[key] != null) return;
      const src = have.reduce((b, j) => (Math.abs(j - k) < Math.abs(b - k) ? j : b), have[0]);
      s[key] = spans[src][key];
      s.evidence[key] = { ...spans[src].evidence[key], filled_from: `${spans[src].from_}→${spans[src].to}` };
    });
  }
  spans.forEach((s, k) => {                // 延長の行がない図面は、右側の測点の区間距離を使う
    if (s.length != null) s.length_from = "延長行";
    else if (mh[k + 1].dist != null) { s.length = mh[k + 1].dist; s.length_from = "区間距離行"; s.evidence.length = mh[k + 1].evidence.dist; }
  });

  const above = texts.filter((t) => t.y > bandTop);
  for (const t of above) {                 // 人孔の注記「M3 組立1号マンホール H=2.219 m」
    const m = RE_PROFILE_MH.exec(t.text);
    if (!m) continue;
    for (const x of mh) if (x.name === m[1]) { x.type = m[2]; x.depth_label = parseFloat(m[3]); x.evidence.type = ev(t); }
  }
  for (const x of mh) if (x.depth == null && x.depth_label != null) { x.depth = x.depth_label; x.evidence.depth = x.evidence.type; }

  for (const t of above) {                 // 接続管（管路番号・管径・管底高の引出し）
    if (!RE_ROUTE_NO.test(t.text)) continue;
    const near = above.filter((u) => u !== t && Math.abs(u.x - t.x) < 14 && Math.abs(u.y - t.y) < 8);
    const pipe = near.find((u) => RE_PIPE.test(u.text)), inv = near.find((u) => /^\d+\.\d{3}$/.test(u.text));
    const k = nearestCol(t.x, 25);
    if (pipe && inv && k != null) mh[k].conns.push({ route: t.text, pipe: pipe.text, invert: parseFloat(inv.text), evidence: [ev(t), ev(pipe), ev(inv)] });
  }

  const hlines = lines.filter(([, y1, , y2]) => Math.abs(y1 - y2) < 1e-6).map(([x1, y1, x2]) => [Math.min(x1, x2), Math.max(x1, x2), y1]);
  for (const t of above) {                 // 国費・単独の範囲
    const fund = FUND_WORDS[nows(t.text)];
    if (!fund) continue;
    const cx = (t.x + t.end_x) / 2;
    const cand = hlines.filter((l) => l[0] <= cx && cx <= l[1] && t.y - l[2] > 0 && t.y - l[2] < 3);
    if (!cand.length) { warnings.push(`縦断図『${t.raw}』の範囲線が見つかりません`); continue; }
    const [x0, x1] = cand.reduce((b, l) => (l[2] > b[2] ? l : b));
    spans.forEach((s, k) => {
      const mid = (colX[k] + colX[k + 1]) / 2;
      if (x0 - 1 <= mid && mid <= x1 + 1) { s.fund = fund; s.evidence.fund = ev(t); }
    });
  }

  const found = Object.keys(SYNONYMS).filter((k) => labels[k]);
  return { sheet: "縦断図", name, rows_found: found, mh, spans, warnings, band: { top: bandTop, bottom: bandBottom } };
}

// ---------------------------------------------------------------- 平面図の抽出

function squares(lines, lo = 1.0, hi = 4.0) {   // 端点を共有する短い線4本で閉じた正方形（汚水ます記号）
  const small = lines.filter(([x1, y1, x2, y2]) => { const d = Math.hypot(x2 - x1, y2 - y1); return lo <= d && d <= hi; });
  const pk = (x, y) => `${r2(x)},${r2(y)}`;
  const parent = small.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const adj = new Map();
  small.forEach(([x1, y1, x2, y2], i) => { for (const p of [pk(x1, y1), pk(x2, y2)]) { if (!adj.has(p)) adj.set(p, []); adj.get(p).push(i); } });
  for (const ids of adj.values()) for (const j of ids.slice(1)) parent[find(j)] = find(ids[0]);
  const groups = new Map();
  small.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const centers = [];
  for (const ids of groups.values()) {
    if (ids.length !== 4) continue;
    const pts = ids.flatMap((i) => [pk(small[i][0], small[i][1]), pk(small[i][2], small[i][3])]);
    const cnt = {}; pts.forEach((p) => (cnt[p] = (cnt[p] || 0) + 1));
    if (Object.values(cnt).every((c) => c === 2)) {
      const xy = Object.keys(cnt).map((p) => p.split(",").map(Number));
      const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
      centers.push([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
    }
  }
  return centers;
}

export function extractPlan(doc, name = "平面図") {
  const texts = loadTexts(doc), lines = loadLines(doc), warnings = [];
  const legend = texts.find((t) => nows(t.text) === "凡例");
  const inLegend = (x, y) => legend && legend.x - 10 <= x && x <= legend.x + 90 && legend.y - 40 <= y && y <= legend.y + 5;
  const spans = [], laterals = [], names = [], types = [], summary = {};
  for (const t of texts) {
    if (inLegend(t.x, t.y)) continue;
    const s = t.text;
    let m;
    if ((m = RE_PIPE_LABEL.exec(s))) spans.push({ pipe: m[1], length: parseFloat(m[2]), slope: parseFloat(m[3]), evidence: ev(t) });
    else if ((m = RE_LAT_LABEL.exec(s))) laterals.push({ pipe: m[1], length: parseFloat(m[2]), evidence: ev(t) });
    else if (RE_MH_NAME.test(s)) names.push(t);
    else if (RE_SUMMARY_L.test(s) || RE_SUMMARY_N.test(s)) {
      if ((m = RE_SUMMARY_L.exec(s))) { summary.L = parseFloat(m[1]); summary.evidence = ev(t); }
      if ((m = RE_SUMMARY_N.exec(s))) { summary.kind = m[1]; summary.N = parseInt(m[2], 10); summary.evidence = ev(t); }
    } else if (s.includes("MH") || s.includes("マンホール")) types.push(t);
  }
  const mh = names.map((n) => {
    const cand = types.filter((t) => Math.abs(t.x - n.x) < 3 && n.y - t.y > 0 && n.y - t.y < 10);
    const tt = cand.length ? cand.reduce((b, t) => (n.y - t.y < n.y - b.y ? t : b)) : null;
    if (!tt) warnings.push(`平面図 ${n.raw} の種類注記が見つかりません`);
    return { name: n.text, type: tt ? tt.text : null, evidence: { name: ev(n), type: tt ? ev(tt) : null } };
  });
  const masu = squares(lines).filter(([x, y]) => !inLegend(x, y));
  return { sheet: "平面図", name, mh, spans, laterals, summary, masu_count: masu.length, masu_centers: masu, warnings };
}

export function toWork(profile, plan) {
  const planTypes = Object.fromEntries((plan?.mh ?? []).map((m) => [m.name, m.type]));
  const mh = profile.mh.map((m) => ({ ...m, type: m.type ?? planTypes[m.name] ?? null }));
  return { mh, spans: profile.spans };
}

// ---------------------------------------------------------------- 検算

const TOL_LEVEL = 0.006, TOL_DIST = 0.02;
const f = (level, check, target, message, extra = {}) => ({ level, check, target, message, ...extra });
const label = (key) => ({ ground: "地盤高", invL: "管底高", coverL: "土被り", depth: "人孔深", cum: "追加距離", dist: "区間距離",
  pipe: "管径", slope: "勾配", length: "延長" }[key] ?? key);

/** 図面の中で本来そろう値を突き合わせ、誤記・読み取りミスの疑いを出す。evidence は図面上の該当文字（強調表示に使う）。 */
export function runChecks(profile, plan) {
  const out = [];
  const { mh, spans } = profile, n = mh.length;
  for (const m of mh) for (const key of ["ground", "invL", "coverL", "depth", "cum", "dist"])
    if (m[key] == null) out.push(f("error", "missing", `縦断図 ${m.name}`, `${label(key)} が読み取れていません`, { sheet: "縦断図", evidence: [m.evidence.station] }));
  spans.forEach((s) => { for (const key of ["pipe", "slope", "length"])
    if (s[key] == null) out.push(f("error", "missing", `縦断図 ${s.from_}→${s.to}`, `${label(key)} が読み取れていません`, { sheet: "縦断図", evidence: [] })); });
  if (out.some((x) => x.check === "missing")) return out;

  const dir = flowDirection(profile);
  spans.forEach((s, k) => {
    const a = mh[k], b = mh[k + 1], tgt = `${a.name}→${b.name}`, ia = a.invR, ib = b.invL;
    const evs = [a.evidence.invR, b.evidence.invL, s.evidence.slope, s.evidence.length].filter(Boolean);
    const drop = Math.abs(ia - ib), exp = s.length * s.slope / 1000;
    if (Math.abs(drop - exp) > TOL_LEVEL)
      out.push(f("error", "invert_vs_slope", tgt, `管底高の差 ${drop.toFixed(3)}m が 区間距離×勾配 ${exp.toFixed(3)}m と合いません（${a.name} ${ia.toFixed(3)} / ${b.name} ${ib.toFixed(3)}）`,
        { sheet: "縦断図", evidence: evs, expected: +exp.toFixed(3), actual: +drop.toFixed(3) }));
    if ((ia - ib) * dir <= 0)
      out.push(f("error", "reverse_slope", tgt, `下流側の管底高が上流側以上です（逆勾配。管路全体は${dir > 0 ? "左が上流" : "左が下流"}）`, { sheet: "縦断図", evidence: evs }));
    if (s.length_from === "延長行" && Math.abs(b.dist - s.length) > TOL_DIST)
      out.push(f("error", "dist_vs_length", tgt, `区間距離 ${b.dist} と延長 ${s.length} が違います`, { sheet: "縦断図", evidence: [b.evidence.dist, s.evidence.length] }));
    if (Math.abs((b.cum - a.cum) - b.dist) > TOL_DIST)
      out.push(f("error", "cum_distance", b.name, `追加距離の差 ${(b.cum - a.cum).toFixed(2)} が区間距離 ${b.dist} と合いません`,
        { sheet: "縦断図", evidence: [a.evidence.cum, b.evidence.cum, b.evidence.dist] }));
  });
  for (let k = 1; k < n - 1; k++) {
    const m = mh[k], drop = (m.invL - m.invR) * dir;
    if (drop < -TOL_LEVEL || drop > 0.6)
      out.push(f("warn", "mh_drop", m.name, `人孔内の落差 ${drop.toFixed(3)}m が通常の範囲外です（0〜0.6m 想定。0.6m 以上は副管）`,
        { sheet: "縦断図", evidence: [m.evidence.invL, m.evidence.invR] }));
  }
  mh.forEach((m, k) => {
    const invs = [m.invL, m.invR], all = invs.concat(m.conns.map((c) => c.invert)), low = Math.min(...all);
    const via = invs.includes(low) ? "" : "（接続管を含む）";
    if (Math.abs((m.ground - low) - m.depth) > TOL_LEVEL)
      out.push(f("error", "depth", m.name, `人孔深 ${m.depth} が 地盤高 ${m.ground} − 最低管底高 ${low.toFixed(3)}${via} = ${(m.ground - low).toFixed(3)} と合いません`,
        { sheet: "縦断図", evidence: [m.evidence.depth, m.evidence.ground, m.evidence.invL, m.evidence.invR].filter(Boolean), expected: +(m.ground - low).toFixed(3), actual: m.depth }));
    if (m.depth_label != null && Math.abs(m.depth_label - m.depth) > TOL_LEVEL)
      out.push(f("error", "depth_label", m.name, `帯の人孔深 ${m.depth} と注記の H=${m.depth_label} が違います`, { sheet: "縦断図", evidence: [m.evidence.depth, m.evidence.type] }));
    const sides = [];
    if (k > 0) sides.push(["L", m.invL, spans[k - 1].pipe]);
    if (k < n - 1) sides.push(["R", m.invR, spans[k].pipe]);
    const single = m.coverL === m.coverR;
    const calc = Object.fromEntries(sides.map(([s, inv, p]) => [s, m.ground - inv - (pipeOd(p) ?? NaN)]));
    for (const [side] of sides) {
      const got = m["cover" + side];
      if (single) {
        if (Object.values(calc).every((c) => Math.abs(c - got) > TOL_LEVEL)) {
          const e = Object.values(calc).reduce((b, c) => (Math.abs(c - got) < Math.abs(b - got) ? c : b));
          out.push(f("error", "cover", m.name, `土被り ${got} が 地盤高 − 管底高 − 外径 = ${e.toFixed(3)} と合いません`,
            { sheet: "縦断図", evidence: [m.evidence.coverL, m.evidence.ground, m.evidence.invR].filter(Boolean), expected: r2(e), actual: got }));
        }
        break;
      }
      if (Math.abs(calc[side] - got) > TOL_LEVEL)
        out.push(f("error", "cover", `${m.name}（${side === "L" ? "左" : "右"}側の管）`, `土被り ${got} が 地盤高 − 管底高 − 外径 = ${calc[side].toFixed(3)} と合いません`,
          { sheet: "縦断図", evidence: [m.evidence["cover" + side], m.evidence.ground, m.evidence["inv" + side]].filter(Boolean), expected: r2(calc[side]), actual: got }));
    }
    if (Math.min(m.coverL, m.coverR) < 1.0)
      out.push(f("warn", "min_cover", m.name, `土被り ${Math.min(m.coverL, m.coverR)}m が 1.0m 未満です`, { sheet: "縦断図", evidence: [m.evidence.coverL] }));
  });

  if (plan) {
    const pNames = plan.mh.map((m) => m.name), vNames = mh.map((m) => m.name);
    if ([...pNames].sort().join() !== [...vNames].sort().join())
      out.push(f("error", "mh_names", "平面図/縦断図", `人孔番号が一致しません 平面図=${pNames.join("・")} 縦断図=${vNames.join("・")}`, { sheet: "平面図", evidence: plan.mh.map((m) => m.evidence.name) }));
    const pTypes = Object.fromEntries(plan.mh.map((m) => [m.name, m]));
    for (const m of mh) {
      const p = pTypes[m.name];
      if (m.type && p?.type && mhKind(m.type) !== mhKind(p.type))
        out.push(f("error", "mh_type", m.name, `人孔の種類が違います 平面図=${p.type} 縦断図=${m.type}`, { sheet: "平面図", evidence: [p.evidence.type] }));
    }
    const unmatched = [...plan.spans];
    for (const s of spans) {
      const idx = unmatched.findIndex((p) => Math.abs(p.length - s.length) <= TOL_DIST && Math.abs(p.slope - s.slope) < 0.05 && p.pipe === s.pipe);
      if (idx >= 0) { unmatched.splice(idx, 1); continue; }
      const near = unmatched.reduce((b, p) => (!b || Math.abs(p.length - s.length) < Math.abs(b.length - s.length) ? p : b), null);
      out.push(f("error", "plan_vs_profile", `${s.from_}→${s.to}`,
        `縦断図の区間（${s.pipe} L=${s.length}m i=${s.slope}‰）と一致する平面図の管路注記がありません` + (near ? `。最も近いのは『${near.evidence.text}』` : ""),
        { sheet: "平面図", evidence: near ? [near.evidence] : [], expected: s.length, actual: near?.length }));
    }
    const sm = plan.summary ?? {};
    if (sm.L != null) {
      const total = r2(spans.reduce((a, s) => a + s.length, 0));
      if (Math.abs(total - sm.L) > TOL_DIST)
        out.push(f("error", "summary_length", "平面図 見出し", `見出しの L=${sm.L}m と縦断図の区間距離の合計 ${total}m が違います`, { sheet: "平面図", evidence: [sm.evidence] }));
    }
    if (sm.N != null) {
      const kind = mhKind(sm.kind), cnt = mh.filter((m) => mhKind(m.type) === kind).length;
      if (cnt !== sm.N)
        out.push(f("warn", "summary_count", "平面図 見出し", `見出しの ${sm.kind}工 N=${sm.N}箇所 と、縦断図で ${kind} と書かれた人孔 ${cnt} 基が違います（既設の人孔を含んでいないか確認）`,
          { sheet: "平面図", evidence: [sm.evidence] }));
    }
    if (plan.laterals.length !== plan.masu_count)
      out.push(f("warn", "lateral_vs_masu", "平面図", `取付管の注記 ${plan.laterals.length} 本と汚水ます記号 ${plan.masu_count} 個の数が違います`, { sheet: "平面図", evidence: [] }));
  }
  for (const w of profile.warnings.concat(plan?.warnings ?? [])) out.push(f("warn", "extract", "抽出", w, { evidence: [] }));
  return out;
}

/** 図面1組（平面図・縦断図）を処理する。 */
export function runTakeoff(profileDoc, planDoc, names = {}) {
  const profile = extractProfile(profileDoc, names.profile);
  const plan = planDoc ? extractPlan(planDoc, names.plan) : null;
  const work = toWork(profile, plan);
  return { profile, plan, work, sheet: buildInputSheet(work), checks: runChecks(profile, plan) };
}

/** 入力シートの CSV（Excel で開ける UTF-8 BOM 付き）。 */
export function sheetCsv(rows, columns) {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- 当初と変更の差分

/** 当初と変更の入力シートを、区間（下流・上流の測点の組）と人孔番号で突き合わせる。 */
export function diffSheets(base, change) {
  const out = { "管きょ": [], "人孔": [] };
  const spec = [["管きょ", PIPE_FILLED, (r) => `${r["測点番号(下流側)"]}→${r["測点番号(上流側)"]}`], ["人孔", MH_FILLED, (r) => r["人孔No."]]];
  for (const [name, cols, keyOf] of spec) {
    const b = new Map(base[name].map((r) => [keyOf(r), r])), c = new Map(change[name].map((r) => [keyOf(r), r]));
    for (const k of new Set([...b.keys(), ...c.keys()])) {
      const rb = b.get(k), rc = c.get(k);
      if (!rb || !rc) { out[name].push({ key: k, status: rb ? "removed" : "added", base: rb, change: rc, cells: [] }); continue; }
      const cells = cols.filter((col) => String(rb[col]) !== String(rc[col])).map((col) => ({ col, from: rb[col], to: rc[col], srcBase: rb._src?.[col], srcChange: rc._src?.[col] }));
      out[name].push({ key: k, status: cells.length ? "changed" : "same", base: rb, change: rc, cells });
    }
  }
  return out;
}
