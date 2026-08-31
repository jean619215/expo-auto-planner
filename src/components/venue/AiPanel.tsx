"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type Anthropic from "@anthropic-ai/sdk";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type {
  Column,
  FloorBounds,
  FloorPolygon,
  WallSegment,
} from "@/lib/venue/plan";
import type { FurnitureItem } from "@/lib/venue/furniture";
import { catalogueForModel } from "@/lib/venue/catalog";
import {
  parseToolUse,
  type AiAction,
  type AiActionResult,
} from "@/lib/ai-panel/actions";
import { toApiMessages, CONFIG_APPENDIX_HEADER } from "@/lib/ai-panel/messages";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// 單張圖片上限(AC2):超過拒絕上傳,不送出。
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
// 100 輪軟上限(architect-plan.md D7):一「輪」= 一組 user+assistant 配對。
const TURN_LIMIT = 100;

type ContentBlock = Anthropic.ContentBlockParam;

export interface AiPanelPlanSnapshot {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  /**
   * 可編輯範圍(公尺)。**模型必須知道這個,否則畫出來的東西會被無聲夾壞。**
   *
   * 2026-08-31 的實際案例:模型畫正六角形時把中心放在 (30,30),而當時的可
   * 編輯範圍是 [15,28] —— 超界的頂點被 `snapPoint` 夾到邊界,兩個頂點疊成
   * 一點,六角形塌成三角形。模型不是算錯,是**從來沒被告知能畫在哪裡**。
   */
  area: FloorBounds;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: ContentBlock[];
  /** user 回合的原始輸入(不含附帶的目前配置 JSON),渲染用。 */
  displayText?: string;
  /** assistant 回合套用 tool call 後的動作摘要(可能多行,一 action 一行)。 */
  actionSummary?: string;
  /** user 回合:還原自落庫歷史的圖片佔位數(僅讀檔還原的訊息會帶,見 D7)。 */
  priorImageCount?: number;
}

interface ConversationSeed {
  seq: number;
  turns: ChatTurn[];
}

interface AiPanelProps {
  plan: AiPanelPlanSnapshot;
  applyActions: (actions: AiAction[]) => AiActionResult[];
  planId: string | null;
  slot: number | null;
  conversationSeed: ConversationSeed | null;
}

interface ImageDraft {
  base64: string;
  mediaType: string;
  previewUrl: string;
}

type ChatError =
  | { kind: "insufficient"; balance: number | null }
  | { kind: "auth" }
  | { kind: "generic"; message: string };

function extractText(content: ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlockParam => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export default function AiPanel({
  plan,
  applyActions,
  planId,
  slot,
  conversationSeed,
}: AiPanelProps) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  // 尚未回傳給模型的 tool_result blocks(等使用者下一輪發話時併入)。
  const [pendingToolResults, setPendingToolResults] = useState<ContentBlock[]>(
    [],
  );
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [chatCost, setChatCost] = useState<number | null>(null);
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const lastSeedSeqRef = useRef<number | null>(null);

  // 讀檔還原對話(architect-plan.md D2):不用 key remount(會重置 open/
  // config fetch),改用受控 seed — conversationSeed.seq 變化時整批換掉
  // turns。seq 為遞增計數器,連續讀同一格兩次也會觸發。
  useEffect(() => {
    if (!conversationSeed) return;
    if (lastSeedSeqRef.current === conversationSeed.seq) return;
    lastSeedSeqRef.current = conversationSeed.seq;
    setTurns(conversationSeed.turns);
    setPendingToolResults([]);
    setError(null);
  }, [conversationSeed]);

  // 面板展開即抓取扣點值 + 初始餘額(AC5)。獨立降級:失敗時各自維持
  // null(顯示 "-"),不擋面板其餘功能、不設 error。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/ai/config");
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.status === 200 && data) {
          setChatCost(typeof data.chatCost === "number" ? data.chatCost : null);
          setBalance(typeof data.balance === "number" ? data.balance : null);
        }
      } catch {
        // 降級:維持既有值(通常是 null → "-"),不阻斷面板功能。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 允許重選同一檔案時仍觸發 onChange。
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_IMAGE_BYTES) {
      setError({
        kind: "generic",
        message: "圖片超過 3MB 上限,請選擇較小的檔案",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return;
      const commaIndex = result.indexOf(",");
      const base64 = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
      setImageDraft({
        base64,
        mediaType: file.type || "image/png",
        previewUrl: result,
      });
      setError(null);
    };
    reader.readAsDataURL(file);
  }

  function clearImageDraft() {
    setImageDraft(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSend() {
    if (pending) return;
    const trimmed = input.trim();
    if (!trimmed && !imageDraft) return;
    setError(null);

    // 每輪 user 訊息自動附帶目前配置 JSON,供模型 index 參照(AC3)。
    //
    // 目錄一併附上:tool schema 的 code 是自由字串(不用 enum,見
    // src/lib/ai/tools.ts),模型得從某處知道有哪些代碼可用。放這裡而不是
    // system prompt 或 tool description —— 那兩者都在 prompt cache 的前綴裡,
    // 目錄一長就會讓快取每次失效,而這份附錄本來就逐輪不同,已在斷點之後。
    //
    // 目錄長到上百項時(T6)要重新考慮:那時整份塞進每一輪的成本就不划算,
    // 比較合理的做法是給模型一支查詢工具,而不是繼續加大這份清單。
    const configJson = JSON.stringify({
      // 可編輯範圍放在最前面 —— 這是所有座標的前提。超出去的頂點會被夾到
      // 邊界上(形狀會塌),所以模型產生任何座標之前都要先看這個。
      editableArea: {
        minX: plan.area.minX,
        maxX: plan.area.maxX,
        minY: plan.area.minY,
        maxY: plan.area.maxY,
        note: "所有 floor / walls / columns / furniture 的座標必須落在此範圍內(公尺),超出的會被夾到邊界,形狀會變形",
      },
      floor: plan.polygon,
      walls: plan.walls,
      columns: plan.columns,
      furniture: plan.furniture,
      // 欄位定義在 catalogueForModel() —— 大小守衛的測試讀同一個函式,
      // 兩邊不可能各自漂移。
      catalogue: catalogueForModel(),
    });
    const textBlock: Anthropic.TextBlockParam = {
      type: "text",
      text: `${trimmed}\n\n${CONFIG_APPENDIX_HEADER}\n${configJson}`,
    };

    const content: ContentBlock[] = [...pendingToolResults];
    if (imageDraft) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type:
            imageDraft.mediaType as Anthropic.Base64ImageSource["media_type"],
          data: imageDraft.base64,
        },
      });
    }
    content.push(textBlock);

    const userTurn: ChatTurn = {
      role: "user",
      content,
      displayText: trimmed || "(圖片)",
    };
    const nextTurns = [...turns, userTurn];

    setPending(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: toApiMessages(nextTurns),
          ...(planId ? { planId } : {}),
        }),
      });
      const data = await res.json().catch(() => null);

      if (res.status === 200 && data) {
        const assistantContent = (data.content ?? []) as ContentBlock[];
        const actions = parseToolUse(assistantContent);
        let actionSummary: string | undefined;
        let nextPendingToolResults: ContentBlock[] = [];

        if (actions.length > 0) {
          const results = applyActions(actions);
          actionSummary = results.map((r) => r.message).join("\n");
          nextPendingToolResults = results.map(
            (r): Anthropic.ToolResultBlockParam => ({
              type: "tool_result",
              tool_use_id: r.toolUseId,
              content: r.message,
              is_error: !r.ok,
            }),
          );
        }

        // 模型回了 200,但既沒有文字也沒有動作 —— 使用者會看到一個空白泡泡,
        // 完全不知道發生什麼事(而且點數已經扣了)。最常見的成因是回應在
        // max_tokens 被截斷:思考吃光預算,text / tool_use 都還沒產出。
        //
        // 這裡不猜原因,只保證**畫面上一定有話說**。真正的原因在伺服器端的
        // ai_usage log(stopReason / blockTypes)。
        const hasText = extractText(assistantContent).trim().length > 0;
        const emptyReply = !hasText && actions.length === 0;

        const assistantTurn: ChatTurn = {
          role: "assistant",
          content: assistantContent,
          actionSummary: emptyReply
            ? "這次沒有產生任何變更(回應可能過長被截斷)。請把需求拆小一點再試一次,例如先產生場地與牆,再請 AI 配置家具。"
            : actionSummary,
        };
        setTurns([...nextTurns, assistantTurn]);
        setPendingToolResults(nextPendingToolResults);
        setBalance(typeof data.balance === "number" ? data.balance : null);
        setInput("");
        clearImageDraft();
      } else if (res.status === 402) {
        const nextBalance =
          typeof data?.balance === "number" ? data.balance : null;
        setBalance(nextBalance);
        setError({ kind: "insufficient", balance: nextBalance });
      } else if (res.status === 401) {
        setError({ kind: "auth" });
      } else {
        setError({
          kind: "generic",
          message:
            typeof data?.error === "string"
              ? data.error
              : "發生錯誤,請稍後再試",
        });
      }
    } catch {
      setError({ kind: "generic", message: "連線失敗,請稍後再試" });
    } finally {
      setPending(false);
    }
  }

  // 清空對話(architect-plan.md D7):非 optimistic — turns 只在 200 成功
  // 才清空,失敗保持原狀,不影響場地配置(polygon/walls/columns/furniture)。
  async function handleClearConversation() {
    if (slot === null || clearing) return;
    setClearing(true);
    try {
      const res = await fetch(`/api/plans/${slot}/conversation`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => null);
      if (res.status === 200) {
        setTurns([]);
        setPendingToolResults([]);
        setClearConfirmOpen(false);
      } else if (res.status === 401) {
        setError({ kind: "auth" });
      } else {
        setError({
          kind: "generic",
          message:
            typeof data?.error === "string" ? data.error : "清空對話失敗,請稍後再試",
        });
      }
    } catch {
      setError({ kind: "generic", message: "連線失敗,請稍後再試" });
    } finally {
      setClearing(false);
    }
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Shift+Enter 換行;IME 組字中(注音/拼音選字)按 Enter 一律放行,不送出。
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void handleSend();
  }

  // 收合時只渲染 toggle 按鈕(不佔用/不遮擋編輯畫面);展開時渲染側欄。
  // AiPanel 本身常駐掛載,turns/input/imageDraft 等 state 不因收合重置。
  if (!open) {
    return (
      <div className="shrink-0">
        <Button
          type="button"
          variant="outline"
          data-testid="ai-panel-toggle"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          AI 助理
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="ai-panel"
      className="flex w-80 shrink-0 flex-col gap-3 rounded-lg bg-card p-3 xl:w-96"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">AI 場地助理</h2>
          <p className="text-xs text-muted-foreground">
            {/* 對外只講「次數」— 販售型態是服務方案而非點數儲值。
                內部餘額/成本仍是額度單位,在此換算成剩餘可用次數。 */}
            剩餘次數:
            <span data-testid="ai-balance">
              {balance !== null && chatCost ? Math.floor(balance / chatCost) : "-"}
            </span>
            (每次規劃生成扣<span data-testid="ai-chat-cost">1</span>次)
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {planId !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="ai-clear-conversation-button"
              onClick={() => setClearConfirmOpen(true)}
            >
              清空對話
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="ai-panel-toggle"
            aria-expanded={open}
            onClick={() => setOpen(false)}
          >
            收合
          </Button>
        </div>
      </div>

      <div
        data-testid="ai-messages"
        className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto p-1"
      >
        {turns.length === 0 && (
          <p className="text-xs text-muted-foreground">
            描述你想要的場地配置,或上傳參考圖,AI 會幫你產生平面圖。
          </p>
        )}
        {turns.map((turn, i) => (
          <div
            key={i}
            className={turn.role === "user" ? "text-right" : "text-left"}
          >
            <p
              data-testid={
                turn.role === "assistant" ? "ai-assistant-text" : undefined
              }
              className="whitespace-pre-wrap text-sm"
            >
              {turn.role === "user"
                ? turn.displayText
                : extractText(turn.content)}
            </p>
            {turn.role === "user" &&
              !!turn.priorImageCount &&
              turn.priorImageCount > 0 && (
                <span className="flex flex-wrap justify-end gap-1">
                  {Array.from({ length: turn.priorImageCount }).map((_, j) => (
                    <span
                      key={j}
                      data-testid="ai-history-image-placeholder"
                      className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs"
                    >
                      📷 參考圖
                    </span>
                  ))}
                </span>
              )}
            {turn.actionSummary && (
              <p
                data-testid="ai-action-summary"
                className="mt-1 whitespace-pre-wrap text-xs font-medium text-blueprint"
              >
                {turn.actionSummary}
              </p>
            )}
          </div>
        ))}
      </div>

      {Math.floor(turns.length / 2) >= TURN_LIMIT && (
        <p
          data-testid="ai-turn-limit-hint"
          className="text-xs text-muted-foreground"
        >
          對話已達 100 輪,建議清空對話後重新開始,以確保 AI 回應品質
        </p>
      )}

      {pending && (
        <p data-testid="ai-loading" className="text-xs text-muted-foreground">
          AI 思考中...
        </p>
      )}

      {error && (
        <div
          data-testid="ai-error"
          role="alert"
          className="rounded-md bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error.kind === "insufficient" && (
            <p>
              可用次數不足(剩餘:
              {error.balance !== null && error.balance !== undefined && chatCost
                ? Math.floor(error.balance / chatCost)
                : "-"}
              次)。
              <a href="/shop" className="ml-1 underline">
                前往購買方案
              </a>
            </p>
          )}
          {error.kind === "auth" && <p>請先登入才能使用 AI 助理。</p>}
          {error.kind === "generic" && <p>{error.message}</p>}
        </div>
      )}

      {imageDraft && (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- 本地 base64 預覽,非遠端圖檔,不適用 next/image 最佳化。 */}
          <img
            src={imageDraft.previewUrl}
            alt="上傳預覽"
            className="h-12 w-12 rounded object-cover"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearImageDraft}
          >
            移除圖片
          </Button>
        </div>
      )}

      <Textarea
        data-testid="ai-input"
        rows={3}
        value={input}
        disabled={pending}
        placeholder="描述你想要的場地配置...(Enter 送出,Shift+Enter 換行)"
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleInputKeyDown}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          data-testid="ai-image-button"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
        >
          上傳圖片
        </Button>
        <Button
          type="button"
          data-testid="ai-send"
          disabled={pending}
          className="ml-auto"
          onClick={() => void handleSend()}
        >
          送出
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        data-testid="ai-image-input"
        disabled={pending}
        onChange={handleImageChange}
        className="hidden"
      />
      <AlertDialog
        open={clearConfirmOpen}
        onOpenChange={(next) => {
          if (!next) setClearConfirmOpen(false);
        }}
      >
        <AlertDialogContent data-testid="ai-clear-conversation-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>清空對話紀錄？</AlertDialogTitle>
            <AlertDialogDescription>
              確定要清空這個存檔格的對話紀錄嗎？此動作無法復原,場地配置不受影響。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="ai-clear-conversation-confirm-cancel">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="ai-clear-conversation-confirm-accept"
              disabled={clearing}
              onClick={() => void handleClearConversation()}
            >
              確定清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
