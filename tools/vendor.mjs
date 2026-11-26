// 外部部品をアプリに取り込む（ビルドツールなしで動く静的サイトにするため）。
//   ezjww: npm 版は Node 専用の読み込み方式なので、ブラウザでも Node でも読める ES モジュールに書き換える
//   Oxi:   ビルド済みの WebAssembly（ブラウザ向け ES モジュール）をそのままコピーする
//   samples: 検証用の図面
// 使い方: node tools/vendor.mjs [Oxi の web ディレクトリ]
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oxiWeb = process.argv[2] ?? "/data/oxi-release-099/web";

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
copyFileSync(path.join(oxiWeb, "oxidocs_wasm.js"), path.join(app, "vendor/oxi/oxidocs_wasm.js"));
copyFileSync(path.join(oxiWeb, "oxidocs_wasm_bg.wasm"), path.join(app, "vendor/oxi/oxidocs_wasm_bg.wasm"));
copyFileSync(path.join(oxiWeb, "..", "LICENSE"), path.join(app, "vendor/oxi/LICENSE"));
copyFileSync(path.join(app, "node_modules/@anthropic-ai/sdk/LICENSE"), path.join(app, "vendor/anthropic-sdk.LICENSE"));

// ---- サンプル図面
const samples = path.resolve(app, "../poc/samples_synth");
mkdirSync(path.join(app, "samples"), { recursive: true });
// 公開するのは架空のサンプルだけ（工事D・E は説明会で投影された実図面の値を写したもので、手元の検証用）
for (const f of readdirSync(samples).filter((f) => f.endsWith(".jww") && /^工事[ABCTU]_/.test(f))) copyFileSync(path.join(samples, f), path.join(app, "samples", f));
console.log(`ezjww: ${names.length} 関数 / Oxi: ${oxiWeb} / samples: 完了`);
