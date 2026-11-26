// Python 版 POC（poc/run_takeoff.py の出力）と、ブラウザ版の中核（js/core.mjs）の結果が一致するかを確かめる。
import { readFileSync } from "node:fs";
import { readDocument } from "ezjww";
import { runTakeoff, PIPE_FILLED, MH_FILLED } from "../js/core.mjs";

const root = new URL("../../poc/", import.meta.url).pathname;
const parseCsv = (s) => {
  const lines = s.replace(/^﻿/, "").trim().split(/\r?\n/);
  const head = lines[0].split(",");
  return lines.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));
};
let fail = 0;
for (const c of ["A", "B", "C", "D", "E", "T", "U"]) {
  const doc = (f) => readDocument(readFileSync(`${root}samples_synth/工事${c}_${f}.jww`));
  const r = runTakeoff(doc("02_縦断図"), doc("01_平面図"));
  const out = `${root}out/工事${c}/`;
  let cells = 0, diff = [];
  for (const [name, cols] of [["管きょ", PIPE_FILLED], ["人孔", MH_FILLED]]) {
    const py = parseCsv(readFileSync(`${out}入力シート_${name}.csv`, "utf8"));
    py.forEach((row, i) => cols.forEach((col) => { cells++; const js = String(r.sheet[name][i]?.[col] ?? ""); if (js !== row[col]) diff.push(`${name}[${i}].${col}: py=${row[col]} js=${js}`); }));
  }
  const pyChecks = JSON.parse(readFileSync(`${out}検算結果.json`, "utf8")).map((x) => `${x.level}|${x.check}|${x.target}`).sort();
  const jsChecks = r.checks.map((x) => `${x.level}|${x.check}|${x.target}`).sort();
  const sameChecks = JSON.stringify(pyChecks) === JSON.stringify(jsChecks);
  console.log(`工事${c}: 入力シート ${cells - diff.length}/${cells} セル一致, 検算 ${sameChecks ? "一致" : "不一致"}（${jsChecks.length}件）`);
  if (diff.length || !sameChecks) { fail++; diff.slice(0, 8).forEach((d) => console.log("  ", d)); if (!sameChecks) console.log("   py:", pyChecks, "\n   js:", jsChecks); }
}
process.exit(fail ? 1 : 0);
