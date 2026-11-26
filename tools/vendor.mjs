// 外部部品をアプリに取り込む（ビルドツールなしで動く静的サイトにするため）。
//   ezjww: npm 版は Node 専用の読み込み方式なので、ブラウザでも Node でも読める ES モジュールに書き換える
//   Oxi:   表計算部分だけの軽量版（tools/oxicells-lite を wasm-pack でビルドしたもの）をコピーする
//   samples: 検証用の図面
// 使い方: (cd tools/oxicells-lite && wasm-pack build --target web --release --out-dir pkg) のあと node tools/vendor.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oxiPkg = process.argv[2] ?? path.join(app, "tools/oxicells-lite/pkg");
const oxiLicense = process.argv[3] ?? "/data/oxi-release-099/LICENSE";

// ---- ezjww
const ezDir = path.join(app, "node_modules/ezjww/wasm");
let src = readFileSync(path.join(ezDir, "ezjww_wasm.js"), "utf8");
const names = [...src.matchAll(/^exports\.(\w+) = \w+;$/gm)].map((m) => m[1]);
src = src.replace(/^exports\.\w+ = \w+;$/gm, "");
const loader = /const wasmPath = [\s\S]*?wasm\.__wbindgen_start\(\);/;
if (!loader.test(src)) throw new Error("ezjww の読み込み部分の形が想定と違います（ezjww の版が変わった？）");
src = src.replace(loader, `let wasm;
/** wasm のバイト列（ArrayBuffer / Uint8Array）か URL を渡して初期化する。 */
export async function init(source) {
  const bytes = typeof source === "string" || source instanceof URL ? await (await fetch(source)).arrayBuffer() : source;
  const { instance } = await WebAssembly.instantiate(bytes, __wbg_get_imports());
  wasm = instance.exports;
  wasm.__wbindgen_start();
}`);
src = `// ezjww ${JSON.parse(readFileSync(path.join(ezDir, "package.json"), "utf8")).version}（MIT, github.com/monozukuri-ai/ezjww）の WebAssembly 読み込み部を ES モジュールに書き換えたもの。tools/vendor.mjs で生成。\n`
  + src + `\nexport { ${names.join(", ")} };\n`;
mkdirSync(path.join(app, "vendor/ezjww"), { recursive: true });
writeFileSync(path.join(app, "vendor/ezjww/ezjww.mjs"), src);
copyFileSync(path.join(ezDir, "ezjww_wasm_bg.wasm"), path.join(app, "vendor/ezjww/ezjww_wasm_bg.wasm"));
copyFileSync(path.join(app, "node_modules/ezjww/LICENSE"), path.join(app, "vendor/ezjww/LICENSE"));

// ---- Oxi
mkdirSync(path.join(app, "vendor/oxi"), { recursive: true });
copyFileSync(path.join(oxiPkg, "oxicells_lite.js"), path.join(app, "vendor/oxi/oxicells_lite.js"));
copyFileSync(path.join(oxiPkg, "oxicells_lite_bg.wasm"), path.join(app, "vendor/oxi/oxicells_lite_bg.wasm"));
copyFileSync(oxiLicense, path.join(app, "vendor/oxi/LICENSE"));
copyFileSync(path.join(app, "node_modules/@anthropic-ai/sdk/LICENSE"), path.join(app, "vendor/anthropic-sdk.LICENSE"));

// ---- サンプル図面
const samples = path.resolve(app, "../poc/samples_synth");
mkdirSync(path.join(app, "samples"), { recursive: true });
// 公開するのは架空のサンプルだけ（工事D・E は説明会で投影された実図面の値を写したもので、手元の検証用）
for (const f of readdirSync(samples).filter((f) => f.endsWith(".jww") && /^工事[ABCTU]_/.test(f))) copyFileSync(path.join(samples, f), path.join(app, "samples", f));
console.log(`ezjww: ${names.length} 関数 / Oxi: ${oxiPkg} / samples: 完了`);
