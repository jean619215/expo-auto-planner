# QA Report — 建立 2D 網格編輯器基礎
> Generated: 2026-07-12T13:00:00+08:00 | QA iteration: 1
> Story: 場地白模產生器 (階段一) | Task 1 of 5 | Type: FRONTEND

## Summary
- Tests executed: 10 acceptance criteria + 5 edge cases + 2 error states + regression + security = 19 checks
- Passed: 19
- Failed: 0
- Blocked: 0

## Scope note
Per AGENTS.md ("No JS test framework installed — verification is manual"; "For FRONTEND tasks, Playwright is the acceptance gate at the `playwright` stage, not here"), this QA pass is **static/code-level verification**: source read against every acceptance criterion, edge case, and error state in orchestrator-output.md, plus targeted logic replays (Node) of `validateGridSize` for input classes not easily eyeballed. Real-browser interactive confirmation (pointer drag feel, actual click sequencing) is the next pipeline stage's (`playwright`) job and is not claimed here.

## Recommendation
**APPROVED** — proceed to `playwright` stage.

## Acceptance Criteria Results
| Criterion | Result | Notes |
|---|---|---|
| Page loads → 10×10 grid, all empty | ✅ PASS | `GridEditor.tsx`: `size` initialized to `DEFAULT_GRID_SIZE` (`{widthM:10, heightM:10}`), `cells` initialized to empty `Map`. Render loop produces `heightM×widthM` = 100 cells, all `data-cell-state="empty"` since `cells.has(key)` is false for all keys. |
| Resize (valid width/height) re-renders + clears floor cells | ✅ PASS | `handleResizeSubmit`: on `result.ok`, calls `setSize(result.size)` then `setCells(new Map())` unconditionally — matches spec ("clears/resets all existing floor-cell selections", no partial preservation). |
| Resize exceeding 50m or 2,500 cells → rejected with clear message | ✅ PASS | `validateGridSize` checks `widthM > MAX_DIMENSION_M \|\| heightM > MAX_DIMENSION_M \|\| widthM*heightM > MAX_TOTAL_CELLS` → returns Traditional Chinese message `最大網格為 50m × 50m（2,500 格）`; verified via Node replay: 51×10 → rejected, 50×51 → rejected (2550 cells). `setSize`/`setCells` never called on `!result.ok` path — grid dimensions untouched. |
| Empty cell click → floor (light blue) | ✅ PASS | `handleCellPointerDown`: `mode = cells.has(key) ? "empty" : "floor"` → for an empty cell this evaluates to `"floor"`, `applyPaint` sets it; render class `bg-sky-300 border-sky-400` (light blue) per spec. |
| Floor cell click → empty | ✅ PASS | Same handler; for a painted cell `cells.has(key)` is true → mode `"empty"` → `applyPaint` deletes the key; render falls back to `bg-white border-gray-300`. |
| Drag from empty cell paints all entered cells to floor regardless of prior state | ✅ PASS | Stroke mode is decided once at `pointerdown` (`paintModeRef.current = mode`) and `handleCellPointerEnter` unconditionally calls `applyPaint(key, paintModeRef.current)` for every entered cell — no per-cell re-toggle, exactly matching "state decision made once at drag start." |
| Drag from floor cell erases all entered cells regardless of prior state | ✅ PASS | Same mechanism, mode `"empty"` branch. |
| Stroke ends cleanly on pointerup/leave — no further cells affected | ✅ PASS | Grid container `onPointerUp`/`onPointerLeave` both null the ref; a `window`-level `pointerup` listener (registered in `useEffect`) nulls it too as a safety net for release-outside-grid. `handleCellPointerEnter` early-returns when `paintModeRef.current === null`, so no cell is affected after any of the three exits fire. |
| Non-contiguous/irregular floor shapes preserved, no auto-fill/validation | ✅ PASS | `cells` is an unconstrained sparse `Map`; nothing in `applyPaint`/render enforces contiguity or shape validation — multiple independent strokes simply union/subtract keys. |
| Reload → no persisted state | ✅ PASS | All state (`size`, `cells`, inputs, error) is component-local `useState`/`useRef`; no `localStorage`/`sessionStorage`/cookie/API call anywhere in `grid.ts` or `GridEditor.tsx` (grepped — none present). Reload always re-mounts to `DEFAULT_GRID_SIZE` + empty `Map`. |

## Edge Case Results
| Edge Case | Result | Notes |
|---|---|---|
| Resize smaller than current → all selections discarded (not just out-of-range) | ✅ PASS | `setCells(new Map())` is unconditional on any successful resize, regardless of whether new dims are larger or smaller — satisfies "discard all, not just out-of-bounds." |
| Resize input 0 / negative / non-numeric → rejected with message, sensible min enforced | ✅ PASS | Node replay: `"0"`→rejected, `"-5"`→rejected, `"abc"`→rejected (NaN fails `Number.isInteger`), all via the `MIN_DIMENSION_M` / integer check, generic Traditional-Chinese message `寬度與高度必須是至少 1 的整數公尺數`. Decimal (`"3.5"`) also rejected (fails `Number.isInteger`) — stricter than required, still correct per spec ("do not silently clamp"). |
| Drag leaves grid mid-stroke then re-enters without new pointerdown → does not resume painting | ✅ PASS | `onPointerLeave` nulls `paintModeRef.current`; `handleCellPointerEnter` re-checks `paintModeRef.current === null` on every entry, so re-entering with the ref already null paints nothing until a fresh `pointerdown`. |
| Rapid clicking (zero-distance drag) → clean single toggle, not no-op/double-toggle | ✅ PASS | `pointerdown` decides mode from current cell state and applies it immediately (not deferred to a matching `pointerup`), so each discrete click independently toggles based on the state at the moment of that click. No double-apply since `pointerenter` never fires without movement. |
| Touch/pointer-events preference (nice-to-have) | ✅ PASS | All handlers use `onPointerDown`/`onPointerEnter`/`onPointerUp`/`onPointerLeave` (Pointer Events), plus `touchAction: "none"` on the grid container — future-proofed as suggested, not a blocking requirement. |

## Error State Results
| Error State | Result | Notes |
|---|---|---|
| Resize exceeds max grid guard → rejected, inline message, grid stays at previous valid dims | ✅ PASS | `sizeError` state set to the max-guard message and rendered via `data-testid="grid-size-error"` (`role="alert"`, red text `text-red-600`); `size`/`cells` state untouched since `setSize`/`setCells` only run on the `ok:true` branch. |
| Resize input invalid (non-numeric/zero/negative) → rejected, inline message, grid unchanged | ✅ PASS | Same code path, message `寬度與高度必須是至少 1 的整數公尺數`; same untouched-state guarantee. |

## Regression Check
| Feature | Result |
|---|---|
| `src/proxy.ts` (auth gate / page-route protection) | ✅ PASS — byte-for-byte untouched (confirmed via `git status`: no entry for `src/proxy.ts`; the new `/venue` route is simply outside `config.matcher` and is public by omission, per plan Decision 3) |
| `/login`, `/register`, `/profile`, `/api/*` routes | ✅ PASS — zero files under these paths touched; diff is additive-only (`src/lib/venue/`, `src/components/venue/`, `src/app/venue/`, `manual-tests/venue-grid-editor.md`) |
| Build route table | ✅ PASS — `npm run build` output shows `/venue` as a new static (○) route; all pre-existing routes (`/`, `/login`, `/register`, `/profile`, `/api/auth/*`, `/api/profile`) unchanged in the table |

## Security Test
- Sensitive data exposure: PASS — no logging anywhere in new files; no secrets/tokens/credentials; nothing sent to a server (feature is 100% client-local state)
- Input validation: PASS — the one boundary (resize meter inputs) is validated via pure `validateGridSize`, which rejects (never silently clamps) NaN/non-integer/<1/>50/>2,500-cell combinations with a Traditional-Chinese message, exactly per spec and AGENTS.md security rules
- Auth boundary: N/A — page is intentionally public; verified no Supabase client import in any new file (`grid.ts`, `GridEditor.tsx`, `venue/page.tsx`) and `src/proxy.ts` untouched, so no auth-adjacent risk introduced

## Bugs Found
None. 0 Critical / 0 High / 0 Medium / 0 Low.

(For completeness: the PR review stage logged 4 non-blocking 💡 suggestions — redundant no-op `Map` copies when dragging over already-painted cells, `Number()` accepting exotic literals like `"0x10"`/`"1e1"`, doubled interior gridlines from per-cell borders, no keyboard/AT affordance on cells. None affect any acceptance criterion, edge case, or error state; QA concurs these are log-only and do not block sign-off.)

## Test Coverage
- New code coverage: manual checklist (`manual-tests/venue-grid-editor.md`) covers all 11 items mapping 1:1 to the 10 acceptance criteria + all 5 edge cases + both error states; Playwright hooks (`data-testid="venue-grid"`, `data-x`, `data-y`, `data-cell-state`, `grid-width-input`, `grid-height-input`, `grid-resize-apply`, `grid-size-error`) all present in `GridEditor.tsx`, ready for the `playwright` stage's page-object assertions and simulated drag sequences.
- Minimum required (per AGENTS.md): manual checklist for new logic — satisfied (no JS unit-test framework installed; `validateGridSize` written as a pure function, trivially unit-testable the day a framework lands, per architect plan).
- Status: PASS

## Build/Static Gate Re-verification (this QA pass)
- `npm run lint` → PASS (no errors/warnings)
- `npx tsc --noEmit` → PASS (no errors)
- `npm run build` → PASS (`/venue` compiled as a new static route; Proxy middleware output unchanged)

## Playwright E2E Results
> Executed: 2026-07-12T14:00:00+08:00

| Test | Acceptance Criterion | Result | Duration |
|---|---|---|---|
| AC1 | /venue loads with default 10x10 grid, all cells empty | ✅ PASS | 1.1s |
| AC2 | Single click toggles a cell floor <-> empty | ✅ PASS | 843ms |
| AC3 | Drag from empty cell paints every cell passed over as floor | ✅ PASS | 902ms |
| AC4 | Drag from floor cell erases every cell passed over | ✅ PASS | 1.0s |
| AC5 | Valid resize (15x8) rebuilds grid, clears painted cells | ✅ PASS | 892ms |
| AC6 | Invalid resize input (0/non-numeric/>50) shows error, grid untouched | ✅ PASS | 945ms |
| AC7 | 2500-cell cap — 50x50 accepted, exceeding cap rejected | ✅ PASS | 1.1s |
| AC8 | Non-contiguous painting — two separate areas preserved | ✅ PASS | 926ms |
| AC9 | Reload does not persist prior grid state | ✅ PASS | 1.4s |

9/9 passed, 0 failed. Run against local dev server (`npm run dev`), no Supabase/auth involvement (public page).

### Notes
- Drag scenarios used raw `page.mouse.down()/move()/up()` sequences (per developer's note that pointer capture is deliberately released on `pointerdown` so `pointerenter` fires on intermediate cells during a real drag) rather than Playwright's locator drag helpers.
- The 2,500-cell total cap and the 50m per-dimension cap are mathematically inseparable in this implementation (50×50 = 2,500 exactly, the maximum achievable product with both dimensions ≤ 50), so no input combination exercises the total-cell guard independently of the per-dimension guard — both reject via the same validation branch. This is expected given the chosen limits, not a gap.
- No console errors observed during any run.

### Failures
None.
