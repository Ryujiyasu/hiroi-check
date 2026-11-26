// 画面の制御。図面の読み取り・検算・Excel の計算はすべてこのブラウザの中で行う。
// AI チェックだけは、利用者が押したときに限り、図面の文字データを Claude API に送る。
import * as ez from "../vendor/ezjww/ezjww.mjs";
import { extractProfile, runTakeoff, diffSheets, PIPE_FILLED, MH_FILLED, PIPE_COLUMNS, MH_COLUMNS, sheetCsv } from "./core.mjs";
import { DrawingView } from "./render.mjs";
import { fillWorkbook, recalc, readSummary, readCalc, exportXlsx, summaryCsv } from "./sheet.mjs";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
};

const ezReady = ez.init(new URL("../vendor/ezjww/ezjww_wasm_bg.wasm", import.meta.url));
const views = new Map();          // "当初/縦断図" → DrawingView
let state = null;                 // { sets: { 当初, 変更? }, variant, drawing, calc, ai }

// ---------------------------------------------------------------- 図面の読み込み

async function readSet(files) {
  await ezReady;
  const docs = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!ez.isJwwFile(bytes)) throw new Error(`「${f.name}」は Jw_cad（.jww）の図面ではないようです`);
    docs.push({ name: f.name, doc: ez.readDocument(bytes) });
  }
  let profile = null, plan = null;
  for (const d of docs) {                      // 測点の帯が読めるほうが縦断図
    try { extractProfile(d.doc); if (!profile) { profile = d; continue; } } catch { /* 縦断図ではない */ }
    if (!plan) plan = d;
  }
  if (!profile) throw new Error("縦断図が見つかりません。縦断図（測点・地盤高・管底高の帯がある図面）を含めてください。");
  const t0 = performance.now();
  const r = runTakeoff(profile.doc, plan?.doc, { profile: profile.name, plan: plan?.name });
  return { ...r, files: { profile, plan }, ms: Math.round(performance.now() - t0) };
}

async function openBase(files) {
  const set = await readSet(files);
  state = { sets: { "当初": set }, variant: "当初", drawing: "縦断図", calc: null, ai: null };
  $("#start").hidden = true;
  $("#work").hidden = false;
  $("#viewers").replaceChildren();
  views.clear();
  mountViews("当初", set);
  renderAll();
  computeSheet();
}

async function openChange(files) {
  const set = await readSet(files);
  state.sets["変更"] = set;
  state.calc = null;
  mountViews("変更", set);
  state.variant = "変更";
  renderAll();
  computeSheet();
  selectTab("diff");
}

async function sampleFiles(code) {
  const get = async (n) => new File([await (await fetch(new URL(`../samples/工事${code}_${n}.jww`, import.meta.url))).arrayBuffer()], `工事${code}_${n}.jww`);
  return [await get("02_縦断図"), await get("01_平面図")];
}

async function openSample(code) {
  const [base, change] = code.split("+");
  await openBase(await sampleFiles(base));
  if (change) await openChange(await sampleFiles(change));
}

function mountViews(variant, set) {
  for (const sheet of ["縦断図", "平面図"]) {
    const box = h("div", { class: "viewer", hidden: true });
    $("#viewers").append(box);
    const v = new DrawingView(box);
    const f = sheet === "縦断図" ? set.files.profile : set.files.plan;
    if (f) v.load(f.doc);
    views.set(`${variant}/${sheet}`, { view: v, box, has: !!f });
  }
}

// ---------------------------------------------------------------- 表示

const cur = () => state.sets[state.variant];
const hasChange = () => !!state.sets["変更"];

function renderAll() {
  const fileChip = (label, f) => h("span", {}, h("b", {}, label), f ? f.name : "なし");
  const chips = [];
  for (const [v, set] of Object.entries(state.sets)) {
    const pre = hasChange() ? `${v} ` : "";
    chips.push(fileChip(`${pre}縦断図`, set.files.profile), fileChip(`${pre}平面図`, set.files.plan));
  }
  $("#files").replaceChildren(...chips);
  $("#vtabs").hidden = !hasChange();
  $("#tab-diff").hidden = !hasChange();
  for (const b of $$("#vtabs [data-v]")) b.classList.toggle("on", b.dataset.v === state.variant);
  showDrawing(state.drawing);
  renderSummary();
  renderChecks();
  renderPipe();
  renderMh();
  renderCalc();
  renderDiff();
  renderAi();
}

function allChecks() {
  return Object.entries(state.sets).flatMap(([v, set]) => set.checks.map((c) => ({ ...c, variant: v })));
}

function renderSummary() {
  const set = cur(), checks = allChecks();
  const errs = checks.filter((c) => c.level === "error").length, warns = checks.length - errs;
  const cells = set.sheet["管きょ"].length * PIPE_FILLED.length + set.sheet["人孔"].length * MH_FILLED.length;
  const card = (cls, k, v, small) => h("div", { class: `card ${cls}` }, h("div", { class: "k" }, k), h("div", { class: "v num" }, v, small ? h("small", {}, small) : null));
  $("#summary").replaceChildren(
    card("", `読み取った区間・人孔${hasChange() ? `（${state.variant}）` : ""}`, `${set.work.spans.length} 区間`, `・ ${set.work.mh.length} 基`),
    card("", "入力シートに入れる値", `${cells}`, "セル"),
    card(errs ? "err" : "ok", "誤りの疑い", errs ? `${errs} 件` : "なし", errs ? "要確認" : "検算はすべて一致"),
    card(warns ? "warn" : "ok", "念のため確認", warns ? `${warns} 件` : "なし", `読み取りと検算 ${set.ms} ms`));
  $("#n-check").textContent = checks.length || "";
}

function showDrawing(sheet, variant = state.variant) {
  state.drawing = sheet; state.variant = variant;
  for (const b of $$("#dtabs [data-d]")) b.classList.toggle("on", b.dataset.d === sheet);
  for (const b of $$("#vtabs [data-v]")) b.classList.toggle("on", b.dataset.v === variant);
  for (const [k, v] of views) v.box.hidden = k !== `${variant}/${sheet}`;
  const v = views.get(`${variant}/${sheet}`);
  if (v) requestAnimationFrame(() => v.view.fit());
}

function point(variant, sheet, evidences, tone) {
  const v = views.get(`${variant}/${sheet}`);
  if (!v?.has) return;
  if (state.variant !== variant) { state.variant = variant; renderPipe(); renderMh(); renderSummary(); }
  showDrawing(sheet, variant);
  requestAnimationFrame(() => v.view.highlight(evidences, tone));
}

const CHECK_TITLE = {
  invert_vs_slope: "管底高と勾配が合わない", reverse_slope: "逆勾配", dist_vs_length: "区間距離と延長が違う", cum_distance: "追加距離が合わない",
  mh_drop: "人孔内の落差", depth: "人孔深が合わない", depth_label: "人孔深の書き方が2通り", cover: "土被りが合わない", min_cover: "土被りが浅い",
  mh_names: "人孔番号が違う", mh_type: "人孔の種類が違う", plan_vs_profile: "平面図と縦断図が違う", summary_length: "見出しの延長が合わない",
  summary_count: "見出しの箇所数が合わない", lateral_vs_masu: "取付管とますの数", missing: "読み取れない値", extract: "読み取りの注意",
};

function select(box, item) { box.querySelectorAll(".item, td.sel").forEach((x) => x.classList.remove("sel")); item.classList.add("sel"); }

function renderChecks() {
  const box = $("#s-check"), checks = allChecks();
  box.replaceChildren();
  if (!checks.length) box.append(h("div", { class: "okbox" }, "検算で食い違いは見つかりませんでした。"));
  for (const c of checks) {
    const item = h("div", { class: `item ${c.level}` },
      h("div", {}, hasChange() ? h("span", { class: `tag ${c.variant === "変更" ? "chg" : ""}` }, c.variant) : null,
        h("span", { class: "lvl" }, c.level === "error" ? "誤りの疑い" : "確認"), h("span", { class: "t" }, `${c.target}：${CHECK_TITLE[c.check] ?? c.check}`)),
      h("div", { class: "m" }, c.message));
    item.addEventListener("click", () => { select(box, item); point(c.variant, c.sheet ?? "縦断図", c.evidence, c.level === "error" ? "error" : "warn"); });
    box.append(item);
  }
  box.append(h("div", { class: "done" }, "突き合わせた内容",
    h("ul", {}, ["区間ごとの管底高の差 ＝ 区間距離 × 勾配", "人孔深 ＝ 地盤高 − 最も低い管底高（接続管を含む）", "土被り ＝ 地盤高 − 管底高 − 管の外径",
      "追加距離 ＝ 区間距離の累計", "平面図の管路注記（延長・勾配・管径）と縦断図", "平面図の見出し（L=、N=箇所）と縦断図の合計", "取付管の本数と汚水ますの数"].map((t) => h("li", {}, t)))));
}

function badNames(set) {
  return new Set(set.checks.filter((c) => c.level === "error").flatMap((c) => c.target.split(/[→（ ]/)));
}

function table(rows, cols, onCell, { bad = new Set(), changed = new Map() } = {}) {
  return h("table", { class: "grid" },
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", {}, c)))),
    h("tbody", {}, rows.map((r, i) => h("tr", { class: cols.some((c) => bad.has(String(r[c]))) ? "bad" : "" },
      cols.map((c) => {
        const v = r[c], src = r._src?.[c], chg = changed.get(`${i}/${c}`);
        const td = h("td", { class: `${/^-?\d+(\.\d+)?$/.test(String(v)) ? "n" : ""} ${src ? "src" : ""} ${v === "" ? "empty" : ""} ${chg ? "chg" : ""}`,
          title: chg ? `当初 ${chg}` : null }, v === "" ? "—" : v);
        if (src) td.addEventListener("click", () => { $$("td.sel").forEach((x) => x.classList.remove("sel")); td.classList.add("sel"); onCell(src); });
        return td;
      })))));
}

function changedCells(name) {
  const m = new Map();
  if (!hasChange() || state.variant !== "変更") return m;
  const d = diffSheets(state.sets["当初"].sheet, state.sets["変更"].sheet)[name];
  const rows = state.sets["変更"].sheet[name];
  for (const r of d) for (const c of r.cells) {
    const i = rows.indexOf(r.change);
    if (i >= 0) m.set(`${i}/${c.col}`, c.from);
  }
  return m;
}

function variantNote() {
  return hasChange() ? h("p", { class: "note" }, h("span", { class: `tag ${state.variant === "変更" ? "chg" : ""}` }, state.variant),
    state.variant === "変更" ? "変更図面の値です（数量計算書の下段に入れます）。当初から変わったセルを色付けしています。" : "当初図面の値です（数量計算書の上段に入れます）。図面の上の「当初／変更」で切り替えます。") : null;
}

function renderPipe() {
  const set = cur(), rows = set.sheet["管きょ"];
  $("#s-pipe").replaceChildren(
    variantNote(),
    h("p", { class: "note" }, `数量計算書の入力シートに入れる値です。値を押すと、図面上の根拠の文字を示します。管路は${set.sheet.direction > 0 ? "図面の左が上流" : "図面の左が下流"}と判断しました。`),
    table(rows, PIPE_FILLED, (src) => point(state.variant, "縦断図", [src], "info"), { bad: badNames(set), changed: changedCells("管きょ") }),
    h("p", { class: "note" }, "基礎材・舗装・バックホウ規格などの列（", PIPE_COLUMNS.slice(13).join("・"), "）は、横断図・舗装図・人孔構造図から拾う予定です（未対応）。"),
    h("div", { class: "dl" }, h("button", { class: "btn small", onclick: () => download(sheetCsv(rows, PIPE_COLUMNS), `入力シート_管きょ_${state.variant}.csv`, "text/csv") }, "CSVで保存")));
}

function renderMh() {
  const set = cur(), rows = set.sheet["人孔"];
  $("#s-mh").replaceChildren(
    variantNote(),
    h("p", { class: "note" }, "人孔の種類と人孔深です。人孔深は縦断図の帯、なければ人孔の注記（H=）から読みます。接続管種（東西南北）・荷重・底部工などは人孔構造図から拾う予定です（未対応）。"),
    table(rows, MH_FILLED, (src) => point(state.variant, "縦断図", [src], "info"), { changed: changedCells("人孔") }),
    h("div", { class: "dl" }, h("button", { class: "btn small", onclick: () => download(sheetCsv(rows, MH_COLUMNS), `入力シート_人孔_${state.variant}.csv`, "text/csv") }, "CSVで保存")));
}

// ---------------------------------------------------------------- Excel の計算（Oxi）

let oxiPromise = null, template = null;
function loadOxi(onProgress) {
  if (oxiPromise) return oxiPromise;
  oxiPromise = (async () => {
    const oxi = await import("../vendor/oxi/oxicells_lite.js");
    const res = await fetch(new URL("../vendor/oxi/oxicells_lite_bg.wasm", import.meta.url));
    const total = Number(res.headers.get("content-length")) || 4.3e6;
    const reader = res.body.getReader(), chunks = [];
    let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress?.(got / total); }
    const bytes = new Uint8Array(got);
    let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length; }
    await oxi.default({ module_or_path: bytes });
    const [tb, map] = await Promise.all([
      fetch(new URL("../template/数量計算書_模擬版.xlsx", import.meta.url)).then((r) => r.arrayBuffer()),
      fetch(new URL("../template/template_map.json", import.meta.url)).then((r) => r.json())]);
    template = { bytes: new Uint8Array(tb), map };
    return oxi;
  })();
  return oxiPromise;
}

async function computeSheet() {
  const mine = state;
  try {
    const oxi = await loadOxi((p) => { const bar = document.getElementById("oxi-bar"); if (bar) bar.style.width = `${Math.round(p * 100)}%`; });
    const t0 = performance.now();
    const base = fillWorkbook(oxi, template.bytes, template.map, mine.sets["当初"].sheet, 0);
    let bytes = base.bytes, written = base.written.length, changeSummary = null;
    if (mine.sets["変更"]) {
      const ch = fillWorkbook(oxi, bytes, template.map, mine.sets["変更"].sheet, 1);   // 下段＝変更
      bytes = ch.bytes; written += ch.written.length;
      // 変更後の数量: 変更の値で計算式を回す（模擬版の計算書は上段から計算するため、別のコピーで計算する）
      const alt = fillWorkbook(oxi, template.bytes, template.map, mine.sets["変更"].sheet, 0);
      changeSummary = readSummary(recalc(oxi, alt.bytes), template.map);
    }
    const wb = recalc(oxi, bytes);
    mine.calc = { calc: readCalc(wb, template.map), summary: readSummary(wb, template.map), changeSummary, xlsx: exportXlsx(oxi, bytes, wb), written,
      ms: Math.round(performance.now() - t0) };
  } catch (e) {
    console.error(e);
    mine.calc = { error: `数量計算書の計算でエラーが出ました: ${e.message ?? e}` };
  }
  if (state === mine) { renderCalc(); renderDiff(); }
}

const SUM_COLS = ["区分", "工種", "種別・規格", "単位", "数量"];

function renderCalc() {
  const s = $("#s-calc");
  if (!state.calc) {
    $("#calc-state").textContent = "…"; $("#calc-state").className = "busy";
    s.replaceChildren(h("p", { class: "note" }, "Excel の計算エンジン（Oxi）を読み込んでいます。"), h("div", { class: "progress" }, h("i", { id: "oxi-bar" })));
    return;
  }
  if (state.calc.error) { s.replaceChildren(h("div", { class: "err-msg" }, state.calc.error)); return; }
  const { calc, summary, ms, written } = state.calc;
  $("#calc-state").textContent = "✓"; $("#calc-state").className = "ok";
  s.replaceChildren(
    h("p", { class: "note" }, `図面から拾った値 ${written} セルを数量計算書（模擬版）の入力シートに書き込み${hasChange() ? "（上段＝当初、下段＝変更）" : ""}、様式の計算式のまま、このブラウザの中で再計算しました（${ms} ms）。`),
    h("div", { class: "dl" },
      h("button", { class: "btn primary small", onclick: () => download(state.calc.xlsx, "数量計算書_計算済み.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") }, "数量計算書（計算済み）を保存"),
      h("button", { class: "btn small", onclick: () => download(summaryCsv(summary), "取込用_集計_当初.csv", "text/csv") }, "取込用CSV（模擬）を保存")),
    h("h3", {}, `集計（積算システムへの取込用CSVの元）${hasChange() ? "・当初" : ""}`),
    h("table", { class: "grid" }, h("thead", {}, h("tr", {}, SUM_COLS.map((c) => h("th", {}, c)))),
      h("tbody", {}, summary.map((r) => h("tr", {}, SUM_COLS.map((c) => h("td", { class: c === "数量" ? "n" : "" }, r[c])))))),
    h("h3", {}, `第1号計算書 土工計算書${hasChange() ? "・当初" : ""}`),
    h("div", { style: "overflow:auto" }, h("table", { class: "grid" }, h("thead", {}, h("tr", {}, calc.header.map((c) => h("th", {}, c)))),
      h("tbody", {}, calc.rows.map((r) => h("tr", {}, r.map((v) => h("td", { class: typeof v === "number" ? "n" : "" }, typeof v === "number" ? +v.toFixed(3) : v))))))),
    h("p", { class: "note" }, "※ 数量計算書は豊川市の様式を説明会の投影画面から再現した模擬版で、計算式の係数は仮の値です。実物の様式に差し替えると、市の計算式どおりの数量になります。積算システムの取込用CSVの形式も、採択後に実際の仕様に合わせます。"));
}

// ---------------------------------------------------------------- 当初と変更

function renderDiff() {
  const s = $("#s-diff");
  if (!hasChange()) { s.replaceChildren(); return; }
  const d = diffSheets(state.sets["当初"].sheet, state.sets["変更"].sheet);
  const rows = [];
  for (const name of ["管きょ", "人孔"]) for (const r of d[name]) {
    if (r.status === "same") continue;
    if (r.status !== "changed") rows.push({ name, key: r.key, col: r.status === "added" ? "（区間の追加）" : "（区間の削除）", from: "", to: "", r });
    for (const c of r.cells) rows.push({ name, key: r.key, col: c.col, from: c.from, to: c.to, c });
  }
  $("#n-diff").textContent = rows.length || "";
  $("#n-diff").className = "busy";
  const sumDiff = [];
  if (state.calc?.changeSummary) {
    const key = (r) => `${r["区分"]}|${r["工種"]}|${r["種別・規格"]}|${r["単位"]}`;
    const a = new Map(state.calc.summary.map((r) => [key(r), r])), b = new Map(state.calc.changeSummary.map((r) => [key(r), r]));
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const ra = a.get(k), rb = b.get(k), qa = Number(ra?.["数量"] ?? 0), qb = Number(rb?.["数量"] ?? 0);
      const [kubun, kind, spec, unit] = k.split("|");
      sumDiff.push({ kubun, kind, spec, unit, qa, qb, dq: Math.round((qb - qa) * 1000) / 1000 });
    }
  }
  s.replaceChildren(
    h("p", { class: "note" }, "当初図面と変更図面から拾った値を、区間（下流・上流の測点の組）と人孔番号で突き合わせました。行を押すと、変更図面の該当箇所を示します。変更の値は数量計算書の下段に入ります。"),
    rows.length ? h("table", { class: "grid" },
      h("thead", {}, h("tr", {}, ["区分", "区間・人孔", "項目", "当初", "変更"].map((c) => h("th", {}, c)))),
      h("tbody", {}, rows.map((x) => {
        const tr = h("tr", {}, h("td", {}, x.name), h("td", {}, x.key), h("td", {}, x.col), h("td", { class: "n" }, x.from), h("td", { class: "n chg" }, x.to));
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => {
          const ev = x.c ? [x.c.srcChange] : Object.values(x.r.change?._src ?? x.r.base?._src ?? {});
          point(x.c || x.r.change ? "変更" : "当初", "縦断図", ev, "warn");
        });
        return tr;
      }))) : h("div", { class: "okbox" }, "当初と変更で、入力シートに入れる値の違いはありません。"),
    h("h3", {}, "数量の増減（模擬版の計算式による）"),
    !state.calc ? h("p", { class: "note" }, "計算エンジンの読み込みを待っています。") :
      h("table", { class: "grid" }, h("thead", {}, h("tr", {}, ["区分", "工種", "種別・規格", "単位", "当初", "変更", "増減"].map((c) => h("th", {}, c)))),
        h("tbody", {}, sumDiff.map((r) => h("tr", {}, h("td", {}, r.kubun), h("td", {}, r.kind), h("td", {}, r.spec), h("td", {}, r.unit),
          h("td", { class: "n" }, r.qa), h("td", { class: "n" }, r.qb), h("td", { class: `n ${r.dq > 0 ? "up" : r.dq < 0 ? "down" : ""}` }, r.dq > 0 ? `+${r.dq}` : r.dq || "—"))))),
    h("div", { class: "dl" }, h("button", { class: "btn small", onclick: () => download(diffCsv(rows, sumDiff), "当初と変更の差分.csv", "text/csv") }, "差分をCSVで保存")));
}

function diffCsv(rows, sumDiff) {
  const lines = [["区分", "区間・人孔", "項目", "当初", "変更"].join(",")];
  for (const x of rows) lines.push([x.name, x.key, x.col, x.from, x.to].join(","));
  lines.push("", ["区分", "工種", "種別・規格", "単位", "当初", "変更", "増減"].join(","));
  for (const r of sumDiff) lines.push([r.kubun, r.kind, r.spec, r.unit, r.qa, r.qb, r.dq].join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- AI チェック（任意）

const JUDGE_CLASS = { "図面の誤記": "typo", "抽出ミス": "miss", "問題なし": "ok", "判断不能": "" };

function renderAi() {
  const s = $("#s-ai");
  const ai = state.ai;
  const keyInput = h("input", { type: "password", placeholder: "Claude API キー（sk-ant-…）", autocomplete: "off" });
  const content = h("pre", {});
  const details = h("details", {}, h("summary", {}, "送る内容を確認する"), content);
  details.addEventListener("toggle", async () => {
    if (!details.open || content.textContent) return;
    const { buildContent } = await import("./ai.mjs");
    content.textContent = buildContent(cur()).join("\n\n").slice(0, 20000) + "\n…";
  });
  const go = h("button", { class: "btn primary small" }, "AIで二重チェックする");
  go.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) { keyInput.focus(); return; }
    state.ai = { busy: true, variant: state.variant };
    renderAi();
    try {
      const { review } = await import("./ai.mjs");
      const result = await review(cur(), key);
      state.ai = { result, variant: state.variant };
    } catch (e) {
      state.ai = { error: e.message ?? String(e), variant: state.variant };
    }
    renderAi();
  });
  const intro = h("div", { class: "ai-box" },
    h("p", { style: "margin-top:0" }, h("b", {}, "任意の追加機能です。"), "押したときだけ、", h("b", {}, "図面の文字データ（文字・座標）と抽出・検算の結果"), "を Claude API（Anthropic）に送り、",
      "検算の指摘ごとに「図面の誤記」か「読み取りの誤り」かを判定し、拾い漏れの疑いを探します。図面の線や画像は送りません。数量の計算は AI にさせません。"),
    h("p", { class: "note" }, "API キーはこの操作にだけ使い、保存しません。発注前の図面には使わないでください（市の許可がある場合のみ）。"),
    keyInput, h("div", { class: "dl" }, go, hasChange() ? h("span", { class: "note" }, `対象：${state.variant}図面`) : null), details);
  const parts = [intro];
  if (ai?.busy) parts.push(h("p", { class: "note" }, "AI が確認しています（30秒〜2分ほど）…"));
  if (ai?.error) parts.push(h("div", { class: "err-msg" }, ai.error));
  if (ai?.result) {
    const r = ai.result, set = state.sets[ai.variant];
    parts.push(h("h3", {}, `判定：${r.overall}`), h("p", {}, r.summary));
    if (r.check_assessment?.length) {
      parts.push(h("h3", {}, "検算の指摘ごとの判断"));
      for (const a of r.check_assessment) {
        const c = set.checks.find((x) => x.check === a.check && x.target === a.target);
        const item = h("div", { class: `item ${c?.level ?? "warn"}` },
          h("div", {}, h("span", { class: `judge ${JUDGE_CLASS[a.judgement] ?? ""}` }, a.judgement), "　", h("span", { class: "t" }, `${a.target}：${CHECK_TITLE[a.check] ?? a.check}`)),
          h("div", { class: "m" }, a.reason, a.suggested_value ? h("div", {}, h("b", {}, "正しい値の候補："), a.suggested_value) : null));
        if (c) item.addEventListener("click", () => point(ai.variant, c.sheet ?? "縦断図", c.evidence, "error"));
        parts.push(item);
      }
    }
    parts.push(h("h3", {}, "AI が見つけた点"));
    if (!r.findings?.length) parts.push(h("p", { class: "note" }, "追加の指摘はありません。"));
    for (const f of r.findings ?? []) parts.push(h("div", { class: `item ${f.severity === "error" ? "error" : "warn"}` },
      h("div", {}, h("span", { class: "lvl" }, f.category), h("span", { class: "t" }, f.target)), h("div", { class: "m" }, f.description), h("div", { class: "note" }, "根拠：", f.evidence)));
    parts.push(h("p", { class: "note" }, `モデル ${r._meta.model}・入力 ${r._meta.input_tokens.toLocaleString()} トークン・出力 ${r._meta.output_tokens.toLocaleString()} トークン`));
  }
  s.replaceChildren(...parts);
}

// ---------------------------------------------------------------- 共通

function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  h("a", { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fail(e) {
  console.error(e);
  $$(".err-msg.top").forEach((x) => x.remove());
  const msg = h("div", { class: "err-msg top" }, e.message ?? String(e));
  if (state) $("#work").prepend(msg); else $("#start").before(msg);
}

function selectTab(name) {
  for (const x of $$("#stabs [data-s]")) x.classList.toggle("on", x.dataset.s === name);
  for (const n of ["check", "pipe", "mh", "calc", "diff", "ai"]) $(`#s-${n}`).hidden = n !== name;
}

$("#file").addEventListener("change", (ev) => openBase([...ev.target.files]).catch(fail));
$("#file2").addEventListener("change", (ev) => openChange([...ev.target.files]).catch(fail).finally(() => (ev.target.value = "")));
for (const b of $$("[data-sample]")) b.addEventListener("click", () => openSample(b.dataset.sample).catch(fail));
const drop = $("#drop");
drop.addEventListener("dragover", (ev) => { ev.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (ev) => { ev.preventDefault(); drop.classList.remove("over"); openBase([...ev.dataTransfer.files]).catch(fail); });
$("#again").addEventListener("click", () => { $("#work").hidden = true; $("#start").hidden = false; $("#file").value = ""; state = null; });
$("#fit").addEventListener("click", () => views.get(`${state.variant}/${state.drawing}`)?.view.fit());
for (const b of $$("#dtabs [data-d]")) b.addEventListener("click", () => showDrawing(b.dataset.d));
for (const b of $$("#vtabs [data-v]")) b.addEventListener("click", () => { showDrawing(state.drawing, b.dataset.v); renderSummary(); renderPipe(); renderMh(); });
for (const b of $$("#stabs [data-s]")) b.addEventListener("click", () => selectTab(b.dataset.s));
loadOxi();   // 図面を選んでいる間に計算エンジンを読み込んでおく
