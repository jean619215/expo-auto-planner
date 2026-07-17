"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Column, FloorPolygon, WallSegment } from "@/lib/venue/plan";
import type { FurnitureItem } from "@/lib/venue/furniture";
import { parseToolUse, type AiAction, type AiActionResult } from "@/lib/ai-panel/actions";

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
  const [pendingToolResults, setPendingToolResults] = useState<ContentBlock[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [imageDraft, setImageDraft] = useState<ImageDraft | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 允許重選同一檔案時仍觸發 onChange。
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_IMAGE_BYTES) {
      setError({ kind: "generic", message: "圖片超過 3MB 上限,請選擇較小的檔案" });
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
          media_type: imageDraft.mediaType as Anthropic.Base64ImageSource["media_type"],
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
          messages: nextTurns.map(({ role, content: c }) => ({ role, content: c })),
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
        const nextBalance = typeof data?.balance === "number" ? data.balance : null;
        setBalance(nextBalance);
        setError({ kind: "insufficient", balance: nextBalance });
      } else if (res.status === 401) {
        setError({ kind: "auth" });
      } else {
        setError({
          kind: "generic",
          message: typeof data?.error === "string" ? data.error : "發生錯誤,請稍後再試",
        });
      }
    } catch {
      setError({ kind: "generic", message: "連線失敗,請稍後再試" });
    } finally {
      setPending(false);
    }
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void handleSend();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        data-testid="ai-panel-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "關閉 AI 助理" : "AI 助理"}
      </Button>

      {open && (
        <Card data-testid="ai-panel" className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>AI 場地助理</CardTitle>
            <p className="text-xs text-muted-foreground">
              點數餘額:<span data-testid="ai-balance">{balance ?? "-"}</span>
              (每次呼叫將扣除點數)
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div
              data-testid="ai-messages"
              className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border border-input p-2"
            >
              {turns.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  描述你想要的場地配置,或上傳參考圖,AI 會幫你產生平面圖。
                </p>
              )}
              {turns.map((turn, i) => (
                <div key={i} className={turn.role === "user" ? "text-right" : "text-left"}>
                  <p className="whitespace-pre-wrap text-sm">
                    {turn.role === "user" ? turn.displayText : extractText(turn.content)}
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
                <Button type="button" size="sm" variant="ghost" onClick={clearImageDraft}>
                  移除圖片
                </Button>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                data-testid="ai-input"
                value={input}
                disabled={pending}
                placeholder="描述你想要的場地配置..."
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
              />
              <Button
                type="button"
                data-testid="ai-send"
                disabled={pending}
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
              className="text-xs"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
