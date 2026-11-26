// 当初と変更・AI チェック画面の通し確認（ヘッドレス Chrome）。
//   node test/e2e_change.mjs [スクリーンショットの保存先]      … AI は呼ばない
//   ANTHROPIC_API_KEY=… node test/e2e_change.mjs [保存先] --ai   … AI チェックも実行する（課金あり）
import { chromium } from "playwright-core";

const out = process.argv[2] ?? "/tmp", withAi = process.argv.includes("--ai");
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://127.0.0.1:8765/index.html");
await page.click('[data-sample="T+U"]');
await page.waitForSelector("#tab-diff:not([hidden])", { timeout: 20000 });
await page.waitForSelector("#calc-state.ok", { timeout: 120000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/DE_1_diff.png` });
const diffRows = await page.$$eval("#s-diff table.grid", (ts) => ts.map((t) => [...t.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\t/g, " | "))));
console.log("差分:", diffRows[0]);
console.log("数量の増減:", diffRows[1]);
await page.click("#s-diff table.grid tbody tr >> nth=0");
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/DE_2_point.png` });
await page.click('[data-s="pipe"]');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/DE_3_pipe.png` });
await page.click('[data-s="ai"]');
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/DE_4_ai.png` });
if (withAi) {
  await page.click('#vtabs [data-v="当初"]');
  await page.fill("#s-ai input[type=password]", process.env.ANTHROPIC_API_KEY);
  await page.click("#s-ai .btn.primary");
  await page.waitForFunction(() => !document.querySelector("#s-ai")?.innerText.includes("確認しています"), null, { timeout: 300000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/DE_5_ai_result.png`, fullPage: false });
  console.log((await page.innerText("#s-ai")).slice(0, 1500));
}
if (errors.length) { console.log("ERRORS:", errors); process.exitCode = 1; }
await browser.close();
