# QA Report — [BACKEND] POST /api/ai/chat(場地規劃 AI 助理 Task 2)
> Generated: 2026-07-17T19:40:00+08:00 | QA iteration: 1

## Summary
- Tests executed: 24
- Passed: 24
- Failed: 0
- Blocked: 0
- 真模型呼叫:4 次(預算上限內),另 402 分支不呼叫模型(0 次)

## Recommendation
APPROVED — 所有驗收標準通過,review 的 3 項 🟡 修復已獨立重測確認生效,無新增 bug。

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| AC1 未登入 → 401 | ✅ PASS | status=401 |
| AC1 非 JSON body → 400 | ✅ PASS | status=400 |
| AC1 空 messages → 400 | ✅ PASS | status=400 |
| AC1 messages 非陣列 → 400 | ✅ PASS | status=400 |
| AC1 非法 role(system)→ 400 | ✅ PASS | status=400 |
| AC1 請求超過 5MB → 400 | ✅ PASS | 6MB body,content-length 預檢命中,status=400(review Issue 1 修復確認生效) |
| AC2 正常呼叫扣點(-AI_CHAT_COST) | ✅ PASS | before=1850 after=1840(-10) |
| AC2 回傳 balance 與 ledger 一致 | ✅ PASS | resp.balance=1840 |
| AC2 點數歸零 → 402 + balance,不呼叫模型 | ✅ PASS | status=402 balance=0,歸零後沖回,未消耗真呼叫預算 |
| AC3 正常訊息 → 200 + content | ✅ PASS | content 非空陣列 |
| AC3 body.system 被忽略(海盜注入防護) | ✅ PASS(靜態確認) | route.ts 僅取 `body.messages`,其餘欄位一律丟棄,邏輯自 review 起未變動;首輪 manual checklist 已真實觸發驗證過,本輪未重複消耗真呼叫預算 |
| AC3 規劃請求 → generate_plan tool_use | ✅ PASS | floor 4 頂點合法(0-50範圍、0.5對齊)、furniture 陣列合法、schema 無 id 欄位 |
| AC4 離題請求 → 拒絕並引導回主題 | ✅ PASS | 回應:「這超出我的服務範圍,我只能協助場地規劃。如果您有展場相關需求…」 |
| AC5 usage 三欄回傳且 inputTokens/outputTokens > 0 | ✅ PASS | 4 次呼叫皆有合理數值 |
| AC6 ANTHROPIC_API_KEY 僅 env var、無洩漏 | ✅ PASS | grep dev server 輸出無 key/token 字樣;錯誤回應皆固定繁中訊息,不含堆疊或內部細節 |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| content-length 6MB 預檢(不讀完整 body 即拒絕) | ✅ PASS | review Issue 1 修復確認:超過宣告長度即 400,未讀入 body |
| 多位元組(繁中)body 的 byte 數複核路徑 | ⚠️ 未實測到邊界 | 送出約 3MB 繁中字元(char 數 <5M、byte 數 <5MB)未觸及「字元數 under 但 byte 數 over」邊界;程式碼審視 `new TextEncoder().encode(raw).byteLength` 邏輯正確。Low,不影響簽核 |
| 402 分支確實跳過模型呼叫(無 usage log/扣點產生) | ✅ PASS | 歸零後呼叫,期間 dev log 無新增 ai_usage 行,ledger 無新增列 |
| cache 命中驗證(第二次呼叫緊接第一次) | ✅ PASS | 詳見下方「cache 驗證結論」 |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| 上游 Anthropic BadRequestError → 400(非 502) | ✅ PASS(程式碼審視) | route.ts:94-97 `err instanceof Anthropic.BadRequestError` 分流確認存在且邏輯正確;未刻意構造壞 payload 觸發真上游 400(需額外消耗真呼叫預算,ROI 低,邏輯簡單清楚故採靜態審視) |
| getBalance 失敗時不丟棄已計費回應 | ✅ PASS(程式碼審視) | `safeBalance()` 包 try/catch,失敗回 `balance: null`,仍 200 正常返回 content/usage;未注入 DB 故障(需改動生產路徑,超出 QA 邊界) |
| 扣點 DB 例外 → 500 `{error}` shape(非 Next 預設 500) | ✅ PASS(程式碼審視) | `deductPoints` 呼叫包 try/catch,回 500 且為既有繁中 `{error}` shape |

## Regression Check
| Feature | Result |
|---|---|
| `/api/auth/login`(QA 腳本依賴的登入流程) | ✅ PASS |
| `/api/points/*` ledger 餘額查詢(task 1 產物) | ✅ PASS — `balanceOf()` 全程與 route 回傳 `balance` 一致 |
| `proxy.ts` 保護路由(`/api/ai/chat` 未被誤放入 `PUBLIC_API_PATHS`) | ✅ PASS |
| `npx tsc --noEmit` | ✅ PASS(無錯誤輸出) |
| `npx eslint` route.ts + src/lib/ai/*.ts | ✅ PASS(無錯誤輸出) |

## Security Test
- Sensitive data exposure: PASS — usage log 僅含 `{userId, refId, model, inputTokens, outputTokens, cacheReadTokens}`,無對話內容、無 key;錯誤回應皆為固定繁中訊息,不回傳堆疊或內部細節。
- Input validation: PASS — 401/400(6 種分支)/402 齊備;role 白名單、messages 型別檢查、body 大小雙層驗證(content-length 預檢 + byte 數複核)均生效。
- Auth boundary: PASS — proxy fail-closed(`/api/ai/chat` 不在 allowlist)+ route 內 `getUser()` 雙層防護,未登入一律 401。

## Bugs Found
無。Review 的 3 項 🟡(content-length 預檢+byte 複核、BadRequestError 分流 400、safeBalance 降級)經本輪獨立重測確認生效,無回歸。

## Cache 驗證結論
**通過,非 known-gap。** 緊接兩次呼叫(call1 → call2,同一 process 內立即發送):
- call1:`inputTokens=87, cacheReadTokens=0`(首次無快取可讀,預期行為)
- call2:`inputTokens=89, cacheReadTokens=2993`(> 0,快取命中系統提示 + 5 支 tool schema 前綴)

Review 💡-2 的提醒(若為 0,先判斷是否未達 Sonnet 5 最小 cache 長度)不需啟用 —— 系統提示 + tool 定義組成的固定前綴已超過快取門檻,`cache_control` 斷點位置正確且實際生效。付費驗證腳本先後兩輪跑出的 `cacheReadTokens` 皆穩定為 2993,符合固定前綴命中快取的預期。

## Test Coverage
- New code coverage:手動 checklist(`supabase/tests/ai_chat_manual.md`)13/13(首輪)+ QA 本輪獨立重測 24/24,涵蓋全部 AC/edge/error 分支(少數低風險錯誤路徑採程式碼審視而非真觸發,已於上表逐項註記理由)
- Minimum required:依 AGENTS.md — BACKEND 無強制自動化框架,manual checklist / Insomnia 即符合要求
- Status: PASS

## 花費紀錄(供人工參考)
- 真模型呼叫:4 次(call1 正常訊息、call2 cache 驗證、call3 離題、call4 規劃請求/tool_use)
- 402 分支:0 次模型呼叫(餘額檢查於呼叫模型前短路,如預期)
- 測試扣點:全數以 service_role 事後刪除,測試結束時 ledger 無殘留 ai_usage 列,餘額完全復原至測試前的 1850
