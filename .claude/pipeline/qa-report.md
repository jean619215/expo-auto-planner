# QA Report — 場地規劃 AI 助理 / Task 1 [BACKEND] 點數 ledger 支援 AI 扣點
> Generated: 2026-07-17T17:20:00+08:00 | QA iteration: 1

## Summary
- Tests executed: 13 independent probes (migration + helper) + 10 Playwright regression + tsc + lint
- Passed: 13 / 13 probes, 10 / 10 Playwright, tsc clean, lint clean
- Failed: 0
- Blocked: 0

## Recommendation
APPROVED — Feature meets all acceptance criteria. No bugs found.

## Independent Re-verification Method
Did not trust implement-phase numbers. Wrote a standalone `.mts` probe script (deleted after run, never committed) that:
- imports `getBalance` / `deductPoints` directly from `src/lib/points/ledger.ts` (real production code, not a reimplementation)
- creates a throwaway Supabase user via `auth.admin.createUser` (same pattern as `points_data_layer_manual.md`)
- exercises every AC1/AC2 scenario against the live cloud Supabase project
- cleans up: deletes the probe user (FK cascade removes its `point_transactions` rows) + a defensive delete-by-`ref_id`-prefix sweep

**Notable runtime finding (not a bug, documented for future QA runs):** `ledger.ts:1` now has `import "server-only"` (the review's 🟡 fix). This package's `index.js` unconditionally `throw`s unless the module resolver honors the `"react-server"` conditional export — which only happens inside Next's own bundler/runtime. A plain `tsx`/Node run of any file that transitively imports `ledger.ts` throws immediately. Worked around by running the probe with `NODE_OPTIONS="--conditions=react-server"`, which resolves `server-only` to its `empty.js` stub, matching how Next itself resolves it server-side. Future QA/dev scripts touching this module need the same flag. This does not affect the shipped app (Next's bundler always sets this condition server-side) — it only affects the ad-hoc script verification method architect-plan Step 3 prescribes for this file, so flagging it for whoever writes the next probe script.

Command used:
```
set -a && source .env.local && set +a && NODE_OPTIONS="--conditions=react-server" \
  PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH" npx -y tsx --tsconfig tsconfig.json <script>.mts
```

## Acceptance Criteria Results

### AC1 — reason constraint migration
| Criterion | Result | Notes |
|---|---|---|
| 新 migration 不改舊檔,drop 舊 check 加新 check(含 ai_usage) | ✅ PASS | `supabase/migrations/20260717070000_allow_ai_usage_reason.sql` present, additive, migration filename is new |
| `reason='ai_usage'` 可插入 | ✅ PASS | probe insert succeeded, cleaned up |
| 非法 reason 仍被 check 擋 | ✅ PASS | insert with `reason='bogus_reason'` rejected, Postgres code `23514` (check_violation) against constraint `point_transactions_reason_check` |
| 既有資料不受影響(signup_bonus/purchase 仍合法) | ✅ PASS | constraint body explicitly retains both original values; no data migration touched existing rows |
| 已推雲端 | ✅ PASS | probes ran directly against cloud Supabase project (`wfuvynpcjwrovkbtxcue.supabase.co`), constraint behavior observed live |

### AC2 — 扣點 helper (`src/lib/points/ledger.ts`)
| Criterion | Result | Notes |
|---|---|---|
| `getBalance(userId)` == SUM(delta), matches balance route semantics | ✅ PASS | helper result (50) matched independently-computed raw `SUM(delta)` (50) for freshly-created probe user |
| `amount` validated as positive integer, throws otherwise | ✅ PASS | `amount=0` throws, `amount=-5` throws, `amount=1.5` throws — all 3 confirmed |
| Successful deduct writes `delta = -amount` | ✅ PASS | ledger row for the deduct had `delta=-5, reason='ai_usage'`; balance decremented by exactly the deducted amount |
| Insufficient balance → `{ok:false, error:'insufficient_balance'}`, no write | ✅ PASS | requested amount = balance + 100000; returned correct error shape; balance unchanged; zero ledger rows written for that `ref_id` |
| Duplicate `refId` → `{ok:false, error:'duplicate'}`, idempotent (no double-deduct) | ✅ PASS | second call with same `refId` returned `duplicate`; balance unchanged after the duplicate attempt; exactly 1 ledger row exists for that `ref_id` (not 2) |
| Boundary: `amount === exact current balance` succeeds, balance → 0 | ✅ PASS (added edge case beyond orchestrator list) | deduct-to-zero succeeded, resulting balance was exactly 0 |
| Other DB errors throw (not swallowed) | ✅ PASS (inferred from code + error-shape tests above) | code path only has two explicit non-throw branches (insufficient_balance, 23505 duplicate); everything else falls through to `throw new Error(...)`, verified structurally — no separate DB-level fault was injected since doing so against the live cloud project isn't safely simulable without corrupting schema |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| amount = 0 | ✅ PASS | throws |
| amount = negative | ✅ PASS | throws |
| amount = non-integer (1.5) | ✅ PASS | throws |
| amount = exact balance (boundary) | ✅ PASS | succeeds, balance → 0 |
| duplicate refId (idempotency / concurrent-retry simulation) | ✅ PASS | no double-deduct, single ledger row |
| insufficient balance (amount > balance) | ✅ PASS | rejected, zero writes |
| illegal `reason` value at DB layer | ✅ PASS | check constraint enforces even if a caller bypassed the TS union type |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| `insufficient_balance` returned as typed result, not thrown | ✅ PASS | |
| `duplicate` (23505) returned as typed result, not thrown | ✅ PASS | |
| Invalid `amount` throws (caller's responsibility to 500 it) | ✅ PASS | verified for 0, negative, and non-integer |

## Regression Check
| Feature | Result |
|---|---|
| Points shop full Playwright suite (`points-shop.spec.ts`, 10 tests: access control, header nav, balance/packages display, mock purchase E2E, webhook idempotency, tampered-signature rejection, checkout cancel, unknown packageId rejection) | ✅ PASS (10/10) |
| `npx tsc --noEmit` | ✅ PASS (clean) |
| `npm run lint` | ✅ PASS (clean, no warnings/errors) |
| signup_bonus trigger / balance route (not re-run live beyond what points-shop spec already exercises via balance display test) | ✅ PASS (covered transitively by points-shop spec test #5, "shows numeric balance") |

## Security Test
- Sensitive data exposure: PASS — probe script never printed `.env.local` values; `ledger.ts` error messages only surface Postgres `code`/`message`, no secrets, tokens, or PII beyond `user_id` (already scoped to the caller in production usage)
- Input validation: PASS — `amount` validated as positive integer at the top of `deductPoints` before any DB call; `reason` narrowed by TS union (`DeductReason = "ai_usage"`) plus DB check constraint as second line of defense; `ledger.ts` correctly uses `src/lib/supabase/admin.ts` factory (no inline client construction), confirming AGENTS.md modularity convention
- Auth boundary: N/A for this task — `ledger.ts` explicitly delegates identity verification to the calling route (documented in its header comment); no API route was added in this task to test an auth boundary against. Confirmed no route currently imports `ledger.ts` (`grep -rn "lib/points/ledger" src/` → no hits), so nothing is prematurely exposed
- `server-only` boundary: PASS — `import "server-only"` present at `ledger.ts:1` (review's 🟡 fix, applied); confirmed no client component under `src/lib/points/` imports it; `npm install server-only` reflected in `package.json`/`package-lock.json`

## Bugs Found
None.

## Test Coverage
- New code coverage: 13/13 independent QA probes pass (migration: 2 scenarios; helper: 11 scenarios including 1 extra boundary case beyond the orchestrator's explicit list) + manual checklist (`supabase/tests/points_data_layer_manual.md`, AI 扣點 section, 7/7 items) independently re-confirmed, not just read
- Minimum required (per AGENTS.md): manual checklist or Playwright coverage for new logic — satisfied (this task is BACKEND-only; no JS unit/integration framework installed project-wide, consistent with AGENTS.md)
- Status: PASS
