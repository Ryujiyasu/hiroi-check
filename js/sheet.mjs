// 数量計算書（xlsx）への書き込みと再計算。Oxi（ブラウザで動く文書エンジン）を使い、サーバーには何も送らない。
// どの値をどのセルに書くかは template_map.json で決める（実物の様式に差し替えるときは対応表を直すだけ）。

const colIndex = (letter) => [...letter].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;   // A → 0

function sheetIndex(oxi, bytes, name) {
  const wb = oxi.parse_spreadsheet(bytes);
  const i = wb.sheets.findIndex((s) => s.name === name);
  if (i < 0) throw new Error(`数量計算書にシート「${name}」が見つかりません`);
  return i;
}

const isNum = (v) => v !== "" && v != null && !Number.isNaN(Number(v));

/** 入力シートの値を数量計算書に書き込む。variant: 0 = 当初（上段）、1 = 変更（下段）。書き込んだセルの一覧も返す。 */
export function fillWorkbook(oxi, templateBytes, map, sheetData, variant = 0) {
  const edits = [], written = [];
  const pi = sheetIndex(oxi, templateBytes, map.sheet);
  sheetData["管きょ"].slice(0, map.records).forEach((rec, i) => {
    const row = map.first_row + i * map.rows_per_record + variant;
    for (const [key, letter] of Object.entries(map.columns)) {
      const v = rec[key];
      if (v === "" || v == null) continue;
      edits.push({ sheet_index: pi, row, col: colIndex(letter), new_value: String(v), value_type: isNum(v) ? "number" : "string" });
      written.push({ sheet: map.sheet, cell: `${letter}${row}`, key, value: v, record: i });
    }
  });
  if (sheetData["管きょ"].length > map.records) throw new Error(`区間が ${sheetData["管きょ"].length} あり、様式の ${map.records} 行を超えています`);
  if (variant === 0 && map.mh) {
    const mi = sheetIndex(oxi, templateBytes, map.mh.sheet);
    sheetData["人孔"].slice(0, map.mh.rows).forEach((rec, i) => {
      const row = map.mh.first_row + i;
      for (const [key, letter] of Object.entries(map.mh.columns)) {
        const v = rec[key];
        if (v === "" || v == null) continue;
        edits.push({ sheet_index: mi, row, col: colIndex(letter), new_value: String(v), value_type: isNum(v) ? "number" : "string" });
        written.push({ sheet: map.mh.sheet, cell: `${letter}${row}`, key, value: v, record: i });
      }
    });
  }
  return { bytes: oxi.edit_xlsx(templateBytes, edits), written };
}

/** 再計算した workbook（Oxi の中間表現）を返す。 */
export function recalc(oxi, bytes) {
  return oxi.recalculate_spreadsheet(oxi.parse_spreadsheet(bytes), Date.now());
}

const cellValue = (cell) => {
  const v = cell?.value;
  if (v == null) return "";
  if (typeof v !== "object") return v;
  const [k, x] = Object.entries(v)[0] ?? [];
  if (k === "Number") return x;
  if (k === "Bool" || k === "Boolean") return x;
  if (k === "Error") return `#${x}`;
  return x ?? "";
};

/** シートの値を 行(1始まり) → 列(0始まり) → 値 で読む。 */
export function sheetValues(wb, name) {
  const s = wb.sheets.find((x) => x.name === name);
  const out = new Map();
  for (const r of s?.rows ?? []) {
    const m = new Map();
    for (const c of r.cells) m.set(c.col, cellValue(c));
    out.set(r.index, m);
  }
  return out;
}

/** 集計表（取込用CSVの元）を読む。数量が 0 の行は除く。 */
export function readSummary(wb, map) {
  const vals = sheetValues(wb, map.summary.sheet), cols = map.summary.columns, rows = [];
  for (let i = 0; i < map.summary.rows; i++) {
    const r = vals.get(map.summary.first_row + i);
    if (!r) continue;
    const row = Object.fromEntries(Object.entries(cols).map(([k, L]) => [k, r.get(colIndex(L)) ?? ""]));
    if (Number(row["数量"]) > 0) rows.push(row);
  }
  return rows;
}

/** 土工計算書（区間ごとの計算結果）を読む。 */
export function readCalc(wb, map) {
  const vals = sheetValues(wb, map.calc.sheet), last = colIndex(map.calc.last_col);
  const head = vals.get(map.calc.header_row), header = [];
  for (let c = 0; c <= last; c++) header.push(String(head?.get(c) ?? ""));
  const rows = [];
  for (let i = 0; i <= map.calc.rows; i++) {
    const r = vals.get(map.calc.first_row + i);
    if (!r) continue;
    const row = header.map((_, c) => r.get(c) ?? "");
    if (row.some((v) => v !== "")) rows.push(row);
  }
  return { header, rows };
}

/** 再計算後の値を書き込んだ xlsx（Excel で開くと計算済みの状態）。 */
export function exportXlsx(oxi, bytes, wb) {
  return oxi.edit_xlsx_from_workbook(bytes, wb);
}

/** 取込用 CSV（模擬）。実際の積算システムの取込仕様は採択後に合わせる。 */
export function summaryCsv(rows) {
  const head = ["区分", "工種", "種別・規格", "単位", "数量"];
  return "﻿" + [head.join(","), ...rows.map((r) => head.map((h) => r[h]).join(","))].join("\r\n") + "\r\n";
}
