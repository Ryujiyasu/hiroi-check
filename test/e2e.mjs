// 画面の通し確認（ヘッドレス Chrome）。python3 -m http.server 8765 で app/ を配信してから実行する。
//   node test/e2e.mjs [サンプル記号 D|C|B] [スクリーンショットの保存先]
import { chromium } from "playwright-core";

const code = process.argv[2] ?? "T", out = process.argv[3] ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(process.env.BASE ?? "http://127.0.0.1:8765/index.html");
await page.click(`[data-sample="${code}"]`);
await page.waitForSelector("#work:not([hidden])", { timeout: 20000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/${code}_1_checks.png` });
const items = await page.$$("#s-check .item");
if (items.length) {
  await items[0].click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${code}_2_point.png` });
}
await page.waitForSelector("#calc-state.ok", { timeout: 120000 });
await page.click('[data-s="calc"]');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/${code}_3_calc.png` });
const summary = await page.$$eval("#s-calc table.grid", (ts) => [...ts[0].querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\t/g, " | ")));
console.log(`工事${code}: 確認箇所 ${items.length} 件 / 集計 ${summary.length} 行`);
summary.forEach((s) => console.log("  ", s));
if (errors.length) {
  console.log("ERRORS:", errors);
  process.exitCode = 1;
}
await browser.close();
