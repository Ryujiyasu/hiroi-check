// AI（Claude）による二重チェック。利用者が押したときだけ動く追加機能。
// 送るのは図面の文字データ（内容・座標・角度）と、システムの抽出結果・検算結果。図面の線や画像は送らない。
// 数量の計算は Claude にさせない（計算はシステムと数量計算書の計算式が行う）。
import Anthropic from "../vendor/anthropic-sdk.mjs";
import { loadTexts } from "./core.mjs";

export const MODEL = "claude-opus-5-5";
let promptPromise = null;
const prompt = () => (promptPromise ??= fetch(new URL("./ai_prompt.json", import.meta.url)).then((r) => r.json()));

const dump = (label, doc) => `# ${label} の全文字（内容\tx\ty\t角度、単位は図面上の mm）\n`
  + loadTexts(doc).map((t) => `${t.raw}\t${t.x}\t${t.y}\t${t.rot}`).join("\n");

const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "_src" || k === "evidence" ? undefined : v)));

/** 送る内容を組み立てる（画面で「送る内容を確認」に使う）。 */
export function buildContent(set) {
  const { profile, plan, checks, sheet, files } = set;
  const parts = [dump(`縦断図（${files.profile.name}）`, files.profile.doc)];
  if (files.plan) parts.push(dump(`平面図（${files.plan.name}）`, files.plan.doc));
  parts.push("# システムの抽出結果\n" + JSON.stringify({ 縦断図: strip(profile), 平面図: plan ? strip(plan) : null }));
  parts.push("# システムの検算結果\n" + JSON.stringify(checks.map(({ evidence, ...c }) => c)));
  parts.push("# 数量計算書の入力シートに入れる値（システムが図面から作成。計算はしないこと）\n" + JSON.stringify(strip({ 管きょ: sheet["管きょ"], 人孔: sheet["人孔"] })));
  parts.push("上の図面の文字データと抽出結果をダブルチェックし、指定の JSON 形式で回答してください。図面画像は送っていません。");
  return parts;
}

/** Claude に二重チェックを依頼する。apiKey はこの呼び出しにだけ使い、保存しない。 */
export async function review(set, apiKey, { signal } = {}) {
  const { system, schema } = await prompt();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const content = buildContent(set).map((text) => ({ type: "text", text }));
  let msg;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",          // 安全判定で断られた場合はサーバー側で別モデルに切り替える
      messages: [{ role: "user", content }],
    }, { signal });
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("API キーが正しくないようです（認証エラー）。");
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error("この API キーでは利用できません（権限エラー）。");
    if (e instanceof Anthropic.RateLimitError) throw new Error("利用の上限に達しました。少し待ってからもう一度押してください。");
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Claude API に接続できません。ネットワークを確認してください。");
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API のエラー（${e.status ?? "?"}）: ${e.message}`);
    throw e;
  }
  if (msg.stop_reason === "refusal") throw new Error("AI が回答を断りました。");
  if (msg.stop_reason === "max_tokens") throw new Error("回答が途中で切れました。");
  const text = msg.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("AI の回答が空でした。");
  const result = JSON.parse(text);
  result._meta = { model: msg.model, input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens };
  return result;
}
