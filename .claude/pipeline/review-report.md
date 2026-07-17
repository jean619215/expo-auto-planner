# Code Review Report — [BACKEND] POST /api/ai/chat(場地規劃 AI 助理 Task 2)
> Generated: 2026-07-17T18:10:00+08:00 | Review iteration: 1

## Overall Assessment
APPROVED WITH MINOR FIXES

## Summary
實作與 architect plan 高度一致:API key 邊界乾淨(`src/lib/ai/*` 全 `import "server-only"`、key 僅 env var、log/回應無任何洩漏路徑)、先扣後叫順序正確且 502 不退點的取捨有註解與含 userId/refId 的補償 log、系統提示凍結無插值且 cache 斷點位置正確、5 支 tool schema 逐欄比對 `src/lib/venue/plan.ts` / `furniture.ts` 全部對齊(WallSegment start/end、Column center/w/h、FurnitureItem kind/center/rotationDeg、家具預設尺寸與 FURNITURE_DEFAULTS 一致、id 依計畫排除)。13/13 實測含真模型三呼叫(海盜注入、離題拒答、tool 結構)可信。三項 🟡 集中在錯誤路徑的精確度,無安全風險。

## 🔴 Critical Issues (Must Fix — Pipeline Paused)
無。

## 🟡 Should Fix (Auto-resolved by Developer)

### Issue 1 — 5MB 上限在讀完整個 body 之後才檢查,且量的是字元數非位元組
- **File**: `src/app/api/ai/chat/route.ts:28-31`
- **Issue**: `await request.text()` 會先把整個 body 讀進記憶體才比對 `raw.length`。(a) 已登入攻擊者可送遠大於 5MB 的 body,在被拒之前已全量佔用記憶體(Next.js route handler 對 `request.text()` 無內建大小上限);(b) `String.length` 是 UTF-16 code unit 數,非位元組 — 繁中字元每字 3 bytes 只計 1,實際位元組上限可達 ~15MB,與 spec「5MB(含 base64 圖)」不符。
- **Suggested fix**: 先讀 `request.headers.get("content-length")`,超限直接 400(或 413)不讀 body;讀後複核改用 `Buffer.byteLength(raw)` / `new TextEncoder().encode(raw).length`。

### Issue 2 — 上游一律 502:client 造成的 Anthropic 400 被誤報為服務故障,且已扣點
- **File**: `src/app/api/ai/chat/route.ts:64-87`
- **Issue**: `messages` 直接 cast 成 `Anthropic.MessageParam[]` 轉發、依賴上游驗證格式 — 方向可接受(避免重造 SDK 驗證),但 catch 不分型別全部回 502「AI 服務暫時無法回應」。client 可自行觸發的 400(首則訊息為 assistant、壞的 base64 image block、messages 內夾帶超過 4 個 cache_control 斷點等)會:使用者被扣點、拿到誤導性的 502,且 log 只有 `err.message` 無 status,人工補償時無法區分「服務故障該補點」與「client 傳壞資料」。
- **Suggested fix**: 以 SDK typed error 分流 — `err instanceof Anthropic.BadRequestError` 回 400 `{error: 請求格式錯誤}`(退點與否照現行取捨,但至少誠實回報);其餘維持 502。log 補上 `err.status`。順手可在轉發前剝除 message content block 上的 client 端 `cache_control`(防斷點配額被占用)。

### Issue 3 — 模型呼叫成功後 `getBalance` 若 throw,整包回應被丟棄(未處理例外 → 非 {error} shape 的 500)
- **File**: `src/app/api/ai/chat/route.ts:57, 101`(及 49 行 `deductPoints` 的 throw 路徑)
- **Issue**: `getBalance` / `deductPoints` 內部以 throw 表達 DB 失敗,route 未包 try/catch。line 101 最傷:已扣點、模型已回應且已計費,僅因餘額查詢失敗就 500,回應內容全丟;且未處理例外回的是 Next 預設 500,非本 API 的 `{error}` 繁中 shape。
- **Suggested fix**: line 101 的 `getBalance` 包 try/catch,失敗時仍回 200、`balance: null`(前端容錯)並 log;line 48-62 扣點段整體包 try/catch 統一回 500 `{error: 伺服器錯誤}`。

## 💡 Suggestions (Consider — No Action Required)
1. **`AI_CHAT_COST` 無啟動期驗證**(`src/lib/ai/client.ts:10`):env 設成非數字時 `parseInt` 得 NaN,每個請求到 `deductPoints` 才 throw 500。建議 module load 時驗證正整數、fail fast。
2. **cache 命中驗證留 QA 的提示**:tools+system 前綴需超過模型最小可 cache 長度才生效(Sonnet 4.6 為 2048 tokens;Sonnet 5 未公布)。若 QA 觀察到 `cacheReadTokens` 恆為 0,優先懷疑前綴總長不足,而非斷點放錯 — 斷點位置經查正確。
3. **messages 無則數/單則長度上限**(僅總量 5MB):長對話 input tokens 線性成長、每次全量重送。Task 3 前端可考慮截斷策略;後端非必要。

## Security Assessment
- Secrets scan: **PASS** — key 僅 `process.env.ANTHROPIC_API_KEY`;`.env.example` 為佔位符;三個 lib 檔皆 `server-only`;log 與錯誤回應無 key/session/對話內容。
- Input validation: **PASS**(改善點見 🟡-1/🟡-2)— 401/400/402 分支齊備,`system` 欄位確實忽略(海盜注入實測通過),role 白名單驗證存在。
- Auth/authz: **PASS** — proxy fail-closed 已驗證:`/api/ai/chat` 不在 `PUBLIC_API_PATHS`,`/api/:path*` matcher 覆蓋;route 內另有 getUser 雙層防護。本 task 僅消費既有 auth,無 auth 流程變更。
- CORS/CSP: 未修改。
- 依賴:`@anthropic-ai/sdk`(官方 SDK)為唯一新增,無已知風險。
- Test coverage: 手動 checklist 13/13 PASS(`supabase/tests/ai_chat_manual.md`),含 3 次真模型呼叫;tsc/lint 乾淨。cache 命中與圖片輸入為已標注的 known gap(QA / task 3)。

## Plan Compliance
- [x] All architect plan steps implemented(4 檔 + package.json 依賴 + .env.example + manual checklist)
- [x] Implementation matches plan intent(route 六步流程、strict tools、凍結系統提示、502 取捨註解)
- [x] No unauthorised scope additions
- 附註:tool schema 與 `src/lib/venue/` 型別逐欄核對一致;模型 `claude-sonnet-5` 為 story 定案(claude-api skill 確認為合法 model ID);`strict: true` + `additionalProperties: false` 用法正確;數值範圍寫在 description(structured outputs 不支援 min/max)符合限制。

## Conversation Log
| Issue | Developer Response | Resolution |
|---|---|---|
| 🟡-1/2/3 | 待 developer agent auto-resolve(review 無編輯權限,依 pipeline 規則交回 implement) | pending |
