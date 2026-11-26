"""模擬版の数量計算書（xlsx）と、アプリがどのセルに書くかの対応表（JSON）を作る。

豊川市の数量計算書（02_数量計算書.xlsx）は採択後でないと手に入らないため、2026-11-25 説明会で投影された
入力シートの見出し（写真）から並びを再現した「模擬版」。係数（掘削幅・基礎厚など）は仮の値。
実物が手に入ったら、実物の xlsx と対応表（template_map.json）を差し替えるだけでアプリが使えるようにする。

使い方: python app/tools/make_template.py
"""
from __future__ import annotations

import json
import pathlib

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

OUT = pathlib.Path(__file__).resolve().parent.parent / "template"
N_REC = 30                      # 管きょの行（区間）数
N_MH = 31                       # 人孔の行数
FIRST = 9                       # データ開始行（上段＝当初、下段＝変更の2行で1区間）

thin = Side(style="thin", color="999999")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
HEAD = PatternFill("solid", fgColor="DDE7F0")
INPUT = PatternFill("solid", fgColor="FFFBE6")
NOTE = Font(color="C00000", bold=True)


def head(ws, row, col, text, width=None):
    c = ws.cell(row, col, text)
    c.fill, c.border = HEAD, BOX
    c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    c.font = Font(bold=True, size=9)
    if width:
        ws.column_dimensions[get_column_letter(col)].width = width


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.Workbook()

    # ---------------------------------------------------------- 入力シート（管きょ）
    ws = wb.active
    ws.title = "入力シート"
    ws["A1"] = "入力シート（模擬版）"
    ws["A1"].font = Font(bold=True, size=14)
    ws["A2"] = "※豊川市の数量計算書の入力シートを、説明会で投影された画面から再現した模擬版です。実物の様式に差し替えて使います。"
    ws["A2"].font = NOTE
    ws["H3"], ws["H4"] = "上段：当初", "下段：変更"
    ws["H3"].font = ws["H4"].font = NOTE
    cols = [  # (見出し, 単位, 列幅, 対応表のキー)
        ("路線番号", "", 9, "路線番号"),
        ("測点番号\n(下流側)", "", 9, "測点番号(下流側)"),
        ("人孔種別\n(下流側)\n管止め1/組立1号2/点検孔3", "", 13, "人孔コード(下流側)"),
        ("測点番号\n(上流側)", "", 9, "測点番号(上流側)"),
        ("人孔種別\n(上流側)\n管止め1/組立1号2/点検孔3", "", 13, "人孔コード(上流側)"),
        ("管種・管径\nVU150 1\nVU200 2\nVU250 3", "", 10, "管種コード"),
        ("区間距離", "m", 9, "区間距離"),
        ("土被り\n下流側", "m", 8, "土被り(下流側)"),
        ("土被り\n上流側", "m", 8, "土被り(上流側)"),
        ("平均掘削深", "m", 9, None),
        ("基礎材\n再生砂 1", "", 8, "基礎材"),
        ("外副管", "箇所", 7, "外副管"),
        ("舗装幅員", "m", 8, "舗装幅員"),
        ("舗装厚\n表層+プライム\nt=5cm", "m", 9, "表層+プライム"),
        ("舗装厚\n上層(瀝安)\nt=5cm", "m", 9, "上層(瀝安)"),
        ("路盤厚\n上層(粒調)\nt=10cm", "m", 9, "路盤上層(粒調)"),
        ("路盤厚\n下層(RC-40)\nt=25cm", "m", 9, "路盤下層(RC-40)"),
        ("舗装切断\n※当初", "m", 8, "舗装切断"),
        ("仮舗装\n※当初は路盤", "m2", 9, "仮舗装"),
        ("バックホウ規格\n0.45m3級 1\n0.28m3級 2", "", 11, "バックホウ規格"),
        ("国費/単独", "", 8, "国費/単独"),
    ]
    mapping = {"sheet": "入力シート", "first_row": FIRST, "rows_per_record": 2, "records": N_REC, "columns": {}}
    for j, (h, unit, w, key) in enumerate(cols, start=1):
        ws.merge_cells(start_row=5, start_column=j, end_row=7, end_column=j)
        head(ws, 5, j, h, w)
        head(ws, 8, j, unit)
        if key:
            mapping["columns"][key] = get_column_letter(j)
    ws.row_dimensions[5].height = 30
    ws.row_dimensions[6].height = 30
    ws.row_dimensions[7].height = 30
    for i in range(N_REC):
        for dr in (0, 1):
            r = FIRST + i * 2 + dr
            for j in range(1, len(cols) + 1):
                c = ws.cell(r, j)
                c.border = BOX
                c.font = Font(size=9, color="1F4E9A" if dr == 0 else "C00000")
                if j != 10:
                    c.fill = INPUT
            # 平均掘削深 = (土被り下流 + 土被り上流)/2 + 外径 + 基礎厚（模擬の算定式）
            ws.cell(r, 10, f'=IF(G{r}="","",ROUND((H{r}+I{r})/2+INDEX(係数!$B$4:$B$6,F{r})+係数!$B$9,2))')
            ws.cell(r, 10).number_format = "0.00"
    ws.freeze_panes = "B9"

    # ---------------------------------------------------------- 人孔
    wm = wb.create_sheet("人孔")
    wm["A1"] = "人孔（模擬版）"
    wm["A1"].font = Font(bold=True, size=14)
    wm["A2"] = "※実物の人孔入力シートは接続管種（東西南北）・荷重・底部工なども持つ。ここでは図面から決まる3列のみ。"
    wm["A2"].font = NOTE
    for j, (h, w) in enumerate([("人孔No.", 9), ("人孔種別", 11), ("人孔深", 9), ("当初/変更", 9)], start=1):
        head(wm, 4, j, h, w)
    mapping["mh"] = {"sheet": "人孔", "first_row": 5, "rows": N_MH, "columns": {"人孔No.": "A", "人孔種別": "B", "人孔深": "C"}}
    for i in range(N_MH):
        for j in range(1, 5):
            c = wm.cell(5 + i, j)
            c.border, c.font = BOX, Font(size=9)
            if j < 4:
                c.fill = INPUT

    # ---------------------------------------------------------- 係数（仮）
    wk = wb.create_sheet("係数")
    wk["A1"] = "係数（仮の値。実物の数量計算書の値に差し替える）"
    wk["A1"].font = NOTE
    head(wk, 3, 1, "管種コード→外径(m)", 22)
    head(wk, 3, 2, "値", 10)
    head(wk, 3, 3, "掘削幅(m)", 10)
    for i, (name, od, w) in enumerate([("1 VU150", 0.165, 0.60), ("2 VU200", 0.216, 0.65), ("3 VU250", 0.267, 0.70)]):
        wk.cell(4 + i, 1, name)
        wk.cell(4 + i, 2, od)
        wk.cell(4 + i, 3, w)
    wk["A9"], wk["B9"] = "基礎厚(m)", 0.10
    wk["A10"], wk["B10"] = "舗装切断（延長あたり本数）", 2

    # ---------------------------------------------------------- 第1号計算書 土工計算書
    wc = wb.create_sheet("土工計算書")
    wc["A1"] = "第1号計算書　土工計算書（模擬版）"
    wc["A1"].font = Font(bold=True, size=14)
    wc["A2"] = "※入力シートの当初（上段）から計算。算定式は仮。"
    wc["A2"].font = NOTE
    hdr = ["路線番号", "測点(下流)", "測点(上流)", "管径", "延長(m)", "平均掘削深(m)", "掘削幅(m)",
           "掘削(m3)", "管体積(m3)", "埋戻し(m3)", "舗装復旧(m2)", "舗装切断(m)", "国費/単独"]
    for j, h in enumerate(hdr, start=1):
        head(wc, 4, j, h, 11)
    for i in range(N_REC):
        r, s = 5 + i, FIRST + i * 2
        f = {
            1: f'=IF(OR(入力シート!G{s}="",入力シート!A{s}=""),"",入力シート!A{s})',
            2: f'=IF(入力シート!G{s}="","",入力シート!B{s})',
            3: f'=IF(入力シート!G{s}="","",入力シート!D{s})',
            4: f'=IF(入力シート!G{s}="","",CHOOSE(入力シート!F{s},"VUφ150","VUφ200","VUφ250"))',
            5: f'=IF(入力シート!G{s}="","",入力シート!G{s})',
            6: f'=IF(入力シート!G{s}="","",入力シート!J{s})',
            7: f'=IF(入力シート!G{s}="","",INDEX(係数!$C$4:$C$6,入力シート!F{s}))',
            8: f'=IF(E{r}="","",ROUND(E{r}*F{r}*G{r},1))',
            9: f'=IF(E{r}="","",ROUND(E{r}*PI()*(INDEX(係数!$B$4:$B$6,入力シート!F{s})/2)^2,2))',
            10: f'=IF(E{r}="","",ROUND(H{r}-I{r},1))',
            11: f'=IF(E{r}="","",ROUND(E{r}*IF(入力シート!M{s}="",G{r},入力シート!M{s}),1))',
            12: f'=IF(E{r}="","",ROUND(E{r}*係数!$B$10,2))',
            13: f'=IF(入力シート!G{s}="","",IF(入力シート!U{s}="","区分なし",入力シート!U{s}))',
        }
        for j, v in f.items():
            c = wc.cell(r, j, v)
            c.border, c.font = BOX, Font(size=9)
    tr = 5 + N_REC
    wc.cell(tr, 1, "合計").font = Font(bold=True)
    for j in (5, 8, 9, 10, 11, 12):
        L = get_column_letter(j)
        c = wc.cell(tr, j, f"=ROUND(SUM({L}5:{L}{tr - 1}),2)")
        c.font, c.border = Font(bold=True), BOX

    # ---------------------------------------------------------- 集計（取込用CSVの元）
    wt = wb.create_sheet("集計")
    wt["A1"] = "集計（模擬版）"
    wt["A1"].font = Font(bold=True, size=14)
    wt["A2"] = "※積算システムの取込用CSVはこの表から作る想定。実際のCSV仕様（工種・規格のコード）は採択後に合わせる。"
    wt["A2"].font = NOTE
    for j, (h, w) in enumerate([("区分", 8), ("工種", 12), ("種別・規格", 18), ("単位", 6), ("数量", 10)], start=1):
        head(wt, 4, j, h, w)
    rows = []
    rng = f"土工計算書!$M$5:$M${tr - 1}"
    for fund in ("国費", "単独", "区分なし"):
        for kind, spec, unit, col in [("管路土工", "掘削", "m3", "H"), ("管路土工", "埋戻し", "m3", "J"),
                                      ("舗装工", "舗装復旧", "m2", "K"), ("舗装工", "舗装切断", "m", "L")]:
            rows.append((fund, kind, spec, unit, f'=ROUND(SUMIF({rng},"{fund}",土工計算書!${col}$5:${col}${tr - 1}),1)'))
        for pipe in ("VUφ150", "VUφ200", "VUφ250"):
            rows.append((fund, "管布設工", pipe, "m",
                         f'=ROUND(SUMIFS(土工計算書!$E$5:$E${tr - 1},{rng},"{fund}",土工計算書!$D$5:$D${tr - 1},"{pipe}"),2)'))
    for kind in ("組立1号", "小型", "点検孔"):
        rows.append(("共通", "マンホール工", kind, "箇所", f'=COUNTIF(人孔!$B$5:$B${4 + N_MH},"{kind}")'))
    for i, row in enumerate(rows):
        for j, v in enumerate(row, start=1):
            c = wt.cell(5 + i, j, v)
            c.border, c.font = BOX, Font(size=9)
    mapping["summary"] = {"sheet": "集計", "first_row": 5, "rows": len(rows), "columns": {"区分": "A", "工種": "B", "種別・規格": "C", "単位": "D", "数量": "E"}}
    mapping["calc"] = {"sheet": "土工計算書", "first_row": 5, "rows": N_REC, "header_row": 4, "last_col": "M"}
    mapping["note"] = "模擬版。豊川市の実物（02_数量計算書.xlsx）が手に入ったら、実物と、この対応表の列の割り当てを差し替える。"

    wb.save(OUT / "数量計算書_模擬版.xlsx")
    (OUT / "template_map.json").write_text(json.dumps(mapping, ensure_ascii=False, indent=1), encoding="utf-8")
    print("wrote", OUT / "数量計算書_模擬版.xlsx")


if __name__ == "__main__":
    main()
