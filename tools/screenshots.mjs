// 応募書・資料用の画面画像を撮る（ヘッドレス Chrome、2倍解像度）。
//   node tools/screenshots.mjs [保存先] [--ai]   （--ai は ANTHROPIC_API_KEY が要る・課金あり）
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "shots", withAi = process.argv.includes("--ai"), onlyAi = process.argv.includes("--only-ai");
const base = process.env.BASE ?? "http://127.0.0.1:8765/index.html";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
const open = async (sample) => {
  await page.goto(base);
  await page.click(`[data-sample="${sample}"]`);
  await page.waitForSelector("#work:not([hidden])");
  await page.waitForSelector("#calc-state.ok", { timeout: 120000 });
  await page.waitForTimeout(400);
};
const tab = async (name) => { await page.click(`[data-s="${name}"]`); await page.waitForTimeout(250); };

if (!onlyAi) {
await page.goto(base);
await page.waitForTimeout(300);
await shot("01_はじめの画面");

await open("C");                                   // 誤記を含む図面
await page.click("#s-check .item >> nth=0");
await page.waitForTimeout(500);
await shot("02_確認すべき箇所_誤記を図面上で示す");

await open("T");                                   // 豊川市の書き方を再現した図面
await tab("pipe");
await page.click("#s-pipe table.grid tbody tr:nth-child(3) td:nth-child(12)");   // 土被り(上流側)
await page.waitForTimeout(500);
await shot("03_入力シート_値の根拠を図面上で示す");
await tab("calc");
await shot("04_計算結果_数量計算書をブラウザ内で再計算");

await open("T+U");                                 // 当初と変更
await tab("diff");
await page.click("#s-diff table.grid tbody tr >> nth=0");
await page.waitForTimeout(500);
await shot("05_当初と変更_差分と数量の増減");
}

if (withAi || onlyAi) {
  await open("C");
  await tab("ai");
  await page.fill("#s-ai input[type=password]", process.env.ANTHROPIC_API_KEY);
  await page.click("#s-ai .btn.primary");
  await page.waitForFunction(() => !document.querySelector("#s-ai")?.innerText.includes("確認しています"), null, { timeout: 300000 });
  await page.evaluate(() => { const box = document.querySelector("#s-ai"), h3 = box.querySelector("h3"); window.scrollTo(0, 0); if (h3) box.scrollTop = h3.offsetTop - box.offsetTop - 8; });
  await page.click("#fit");
  await page.waitForTimeout(400);
  await shot("06_AIチェック_誤記か読み取りミスかの判定");
}
await browser.close();
console.log(`保存先: ${out}`);
