//! Oxi（https://github.com/Ryujiyasu/oxi）の表計算部分だけを WebAssembly にしたもの。
//! 関数の中身は oxidocs-wasm の同名関数と同じ（文書・スライド・PDF・フォントの部分を含めないため小さい）。
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// .xlsx を読み、ブックの中間表現を返す。
#[wasm_bindgen]
pub fn parse_spreadsheet(data: &[u8]) -> Result<JsValue, JsError> {
    let workbook = oxicells_core::parse_xlsx(data).map_err(|e| JsError::new(&e.to_string()))?;
    serde_wasm_bindgen::to_value(&workbook).map_err(|e| JsError::new(&e.to_string()))
}

#[derive(Deserialize)]
struct JsCellEdit {
    sheet_index: usize,
    row: u32,
    col: u32,
    new_value: String,
    #[serde(default)]
    value_type: Option<String>,
}

/// セルの値を書き換えた .xlsx を返す。行は1始まり、列は0始まり。
#[wasm_bindgen]
pub fn edit_xlsx(data: &[u8], edits: JsValue) -> Result<Vec<u8>, JsError> {
    use oxicells_core::editor::CellEditValue;
    let js_edits: Vec<JsCellEdit> = serde_wasm_bindgen::from_value(edits).map_err(|e| JsError::new(&e.to_string()))?;
    let mut editor = oxicells_core::XlsxEditor::new(data).map_err(|e| JsError::new(&e.to_string()))?;
    for edit in js_edits {
        let value = match edit.value_type.as_deref() {
            None | Some("string") => CellEditValue::String(edit.new_value),
            Some("number") => CellEditValue::Number(edit.new_value.parse().map_err(|_| JsError::new("invalid numeric spreadsheet edit"))?),
            Some("boolean") => match edit.new_value.to_ascii_lowercase().as_str() {
                "true" | "1" => CellEditValue::Boolean(true),
                "false" | "0" => CellEditValue::Boolean(false),
                _ => return Err(JsError::new("invalid boolean spreadsheet edit")),
            },
            Some("formula") => CellEditValue::Formula(edit.new_value),
            Some("empty") => CellEditValue::Empty,
            Some(other) => return Err(JsError::new(&format!("unsupported spreadsheet edit type: {other}"))),
        };
        editor.set_cell_value(edit.sheet_index, edit.row, edit.col, value);
    }
    editor.save().map_err(|e| JsError::new(&e.to_string()))
}

/// ブック全体の数式を再計算して返す。now はTODAY()などに使う時刻（ミリ秒）。
#[wasm_bindgen]
pub fn recalculate_spreadsheet(workbook: JsValue, now: Option<f64>) -> Result<JsValue, JsError> {
    let mut workbook: oxicells_core::ir::Workbook = serde_wasm_bindgen::from_value(workbook).map_err(|e| JsError::new(&e.to_string()))?;
    match now {
        Some(moment) => oxicells_core::formula::evaluate_workbook_formulas_at(&mut workbook, moment),
        None => oxicells_core::formula::evaluate_workbook_formulas(&mut workbook),
    }
    serde_wasm_bindgen::to_value(&workbook).map_err(|e| JsError::new(&e.to_string()))
}

/// 中間表現（再計算後の値を含む）を元の .xlsx に書き戻す。
#[wasm_bindgen]
pub fn edit_xlsx_from_workbook(data: &[u8], workbook: JsValue) -> Result<Vec<u8>, JsError> {
    let workbook: oxicells_core::ir::Workbook = serde_wasm_bindgen::from_value(workbook).map_err(|e| JsError::new(&e.to_string()))?;
    let mut editor = oxicells_core::XlsxEditor::new(data).map_err(|e| JsError::new(&e.to_string()))?;
    editor.apply_workbook(&workbook).map_err(|e| JsError::new(&e.to_string()))?;
    editor.save().map_err(|e| JsError::new(&e.to_string()))
}
