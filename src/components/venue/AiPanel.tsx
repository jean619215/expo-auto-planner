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
import type { Column, FloorPolygon, WallSegment } from "@/lib/venue/plan";
import type { FurnitureItem } from "@/lib/venue/furniture";
import {
  parseToolUse,
  type AiAction,
  type AiActionResult,
} from "@/lib/ai-panel/actions";

// 單張圖片上限(AC2):超過拒絕上傳,不送出。
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

type ContentBlock = Anthropic.ContentBlockParam;

export interface AiPanelPlanSnapshot {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
}

interface AiPanelProps {
  plan: AiPanelPlanSnapshot;
  applyActions: (actions: AiAction[]) => AiActionResult[];
}

interface ChatTurn {
  role: "user" | "assistant";
  content: ContentBlock[];
  /** user 回合的原始輸入(不含附帶的目前配置 JSON),渲染用。 */
  displayText?: string;
  /** assistant 回合套用 tool call 後的動作摘要(可能多行,一 action 一行)。 */
  actionSummary?: string;
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

export default function AiPanel({ plan, applyActions }: AiPanelProps) {
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
    const configJson = JSON.stringify({
      floor: plan.polygon,
      walls: plan.walls,
      columns: plan.columns,
      furniture: plan.furniture,
    });
    const textBlock: Anthropic.TextBlockParam = {
      type: "text",
      text: `${trimmed}\n\n[目前配置]\n${configJson}`,
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
          messages: nextTurns.map(({ role, content: c }) => ({
            role,
            content: c,
          })),
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

        const assistantTurn: ChatTurn = {
          role: "assistant",
          content: assistantContent,
          actionSummary,
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
            點數餘額:<span data-testid="ai-balance">{balance ?? "-"}</span>
            (每次呼叫扣<span data-testid="ai-chat-cost">{chatCost ?? "-"}</span>
            點)
          </p>
        </div>
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
              點數不足(目前餘額:{error.balance ?? "-"})。
              <a href="/shop" className="ml-1 underline">
                前往商店購買點數
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
    </div>
  );
}
