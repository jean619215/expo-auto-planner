"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { PlanSnapshot } from "@/lib/venue/plan";

export type Slot = 1 | 2 | 3;

export interface SlotRow {
  slot: Slot;
  occupied: boolean;
  name: string | null;
  updatedAt: string | null;
}

export interface LoadedPlan {
  planId: string;
  slot: Slot;
  name: string;
  plan: unknown;
  updatedAt: string;
  conversation: { role: string; content: unknown }[];
}

interface PlanSlotsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getSnapshot: () => PlanSnapshot;
  isDirty: () => boolean;
  currentSlot: Slot | null;
  onLoaded: (data: LoadedPlan) => void;
  onSaved: (slot: Slot, planId: string) => void;
  onDeleted: (slot: Slot) => void;
}

const SLOTS: Slot[] = [1, 2, 3];

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("zh-TW", { hour12: false });
}

export default function PlanSlotsDialog({
  open,
  onOpenChange,
  getSnapshot,
  isDirty,
  currentSlot,
  onLoaded,
  onSaved,
  onDeleted,
}: PlanSlotsDialogProps) {
  const [rows, setRows] = useState<SlotRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [busySlot, setBusySlot] = useState<Slot | null>(null);

  const [overwriteTarget, setOverwriteTarget] = useState<SlotRow | null>(null);
  const [overwriteError, setOverwriteError] = useState<string | null>(null);
  const [loadConfirmSlot, setLoadConfirmSlot] = useState<Slot | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SlotRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<SlotRow | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetchSlots();
  }, [open]);

  async function fetchSlots() {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/plans");
      const data = await res.json().catch(() => null);
      if (res.status === 200 && data && Array.isArray(data.slots)) {
        setRows(data.slots as SlotRow[]);
      } else {
        setListError("讀取存檔列表失敗,請重試");
      }
    } catch {
      setListError("連線失敗,請重試");
    } finally {
      setListLoading(false);
    }
  }

  function rowFor(slot: Slot): SlotRow | undefined {
    return rows?.find((r) => r.slot === slot);
  }

  async function performSave(slot: Slot) {
    setBusySlot(slot);
    setOverwriteError(null);
    try {
      const trimmedName = saveNameInput.trim();
      const res = await fetch(`/api/plans/${slot}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: getSnapshot(),
          ...(trimmedName ? { name: trimmedName } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.status !== 200 || !data) {
        const message =
          typeof data?.error === "string" ? data.error : "存檔失敗,請重試";
        setOverwriteError(message);
        return;
      }
      setRows((prev) =>
        (prev ?? []).map((r) =>
          r.slot === slot
            ? { slot, occupied: true, name: data.name, updatedAt: data.updatedAt }
            : r,
        ),
      );
      setOverwriteTarget(null);
      setSaveNameInput("");

      // PUT 不回 planId(既有契約)— 補一次 GET 取得,該次 conversation 丟棄
      // 不餵入 seed(存檔語意不改對話),見 architect-plan.md D9。
      // 注意用獨立 try:此時 PUT 已成功,GET 網路失敗不可誤入外層 catch
      // 顯示「存檔失敗」— 存檔其實成功了,只是 planId 沒綁到。
      try {
        const getRes = await fetch(`/api/plans/${slot}`);
        const getData = await getRes.json().catch(() => null);
        if (getRes.status === 200 && getData?.planId) {
          onSaved(slot, getData.planId as string);
        } else {
          throw new Error("planId fetch failed");
        }
      } catch {
        // 存檔本身已成功,但取 planId 失敗 → currentPlanId 無法綁定
        // (對話不落庫、清空鈕不出現)。不可無聲吞掉:提示使用者補讀一次。
        setLoadError(
          "存檔成功,但無法取得存檔識別碼,請點「讀取」重新載入此格以啟用對話存檔",
        );
      }
    } catch {
      setOverwriteError("連線失敗,請重試");
    } finally {
      setBusySlot(null);
    }
  }

  function handleSaveClick(slot: Slot) {
    const row = rowFor(slot);
    if (row?.occupied) {
      setOverwriteError(null);
      setOverwriteTarget(row);
      return;
    }
    void performSave(slot);
  }

  function handleLoadClick(slot: Slot) {
    if (isDirty()) {
      setLoadConfirmSlot(slot);
      return;
    }
    void performLoad(slot);
  }

  async function performLoad(slot: Slot) {
    setBusySlot(slot);
    setLoadError(null);
    try {
      const res = await fetch(`/api/plans/${slot}`);
      const data = await res.json().catch(() => null);
      if (res.status !== 200 || !data) {
        const message =
          typeof data?.error === "string" ? data.error : "讀取存檔失敗,請重試";
        setLoadError(message);
        return;
      }
      onLoaded(data as LoadedPlan);
      setLoadConfirmSlot(null);
      onOpenChange(false);
    } catch {
      setLoadError("連線失敗,請重試");
    } finally {
      setBusySlot(null);
    }
  }

  function handleRenameClick(slot: Slot) {
    const row = rowFor(slot);
    if (!row) return;
    setRenameError(null);
    setRenameInput(row.name ?? "");
    setRenameTarget(row);
  }

  async function performRename() {
    if (!renameTarget) return;
    const trimmed = renameInput.trim();
    if (!trimmed) return;
    const slot = renameTarget.slot;
    setBusySlot(slot);
    setRenameError(null);
    try {
      const res = await fetch(`/api/plans/${slot}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (res.status !== 200 || !data) {
        const message =
          typeof data?.error === "string" ? data.error : "改名失敗,請重試";
        setRenameError(message);
        return;
      }
      setRows((prev) =>
        (prev ?? []).map((r) =>
          r.slot === slot ? { ...r, name: data.name, updatedAt: data.updatedAt } : r,
        ),
      );
      setRenameTarget(null);
    } catch {
      setRenameError("連線失敗,請重試");
    } finally {
      setBusySlot(null);
    }
  }

  function handleDeleteClick(slot: Slot) {
    const row = rowFor(slot);
    if (!row) return;
    setDeleteError(null);
    setDeleteTarget(row);
  }

  async function performDelete() {
    if (!deleteTarget) return;
    const slot = deleteTarget.slot;
    setBusySlot(slot);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/plans/${slot}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (res.status !== 200 || !data) {
        const message =
          typeof data?.error === "string" ? data.error : "刪除失敗,請重試";
        setDeleteError(message);
        return;
      }
      setRows((prev) =>
        (prev ?? []).map((r) =>
          r.slot === slot
            ? { slot, occupied: false, name: null, updatedAt: null }
            : r,
        ),
      );
      setDeleteTarget(null);
      onDeleted(slot);
    } catch {
      setDeleteError("連線失敗,請重試");
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent data-testid="plan-slots-dialog" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>我的存檔</DialogTitle>
            <DialogDescription>
              最多 3 格,可存入、讀取、改名或刪除。
            </DialogDescription>
          </DialogHeader>

          {listLoading && (
            <p className="text-sm text-muted-foreground">載入中...</p>
          )}
          {listError && (
            <div
              data-testid="plan-slots-list-error"
              role="alert"
              className="rounded-md bg-destructive/10 p-2 text-xs text-destructive"
            >
              <p>{listError}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void fetchSlots()}
              >
                重試
              </Button>
            </div>
          )}
          {loadError && (
            <div
              data-testid="plan-load-error"
              role="alert"
              className="rounded-md bg-destructive/10 p-2 text-xs text-destructive"
            >
              {loadError}
            </div>
          )}

          {rows && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-save-name-input" className="text-xs">
                存入時的名稱(選填)
              </Label>
              <Input
                id="plan-save-name-input"
                data-testid="plan-save-name-input"
                value={saveNameInput}
                onChange={(e) => setSaveNameInput(e.target.value)}
                placeholder="未命名場地"
              />

              <div className="mt-2 flex flex-col gap-2">
                {SLOTS.map((slot) => {
                  const row = rowFor(slot);
                  const busy = busySlot === slot;
                  return (
                    <div
                      key={slot}
                      data-testid={`plan-slot-row-${slot}`}
                      className={
                        "flex items-center justify-between gap-2 rounded-md border p-2 " +
                        (slot === currentSlot ? "border-blueprint" : "border-line")
                      }
                    >
                      {row?.occupied ? (
                        <div className="min-w-0 flex-1">
                          <p
                            data-testid={`plan-slot-name-${slot}`}
                            className="truncate text-sm font-medium"
                          >
                            {row.name}
                          </p>
                          <p
                            data-testid={`plan-slot-updated-${slot}`}
                            className="text-xs text-muted-foreground"
                          >
                            {formatUpdatedAt(row.updatedAt)}
                          </p>
                        </div>
                      ) : (
                        <p
                          data-testid={`plan-slot-empty-${slot}`}
                          className="flex-1 text-sm text-muted-foreground"
                        >
                          空格
                        </p>
                      )}
                      <div className="flex shrink-0 gap-1">
                        {row?.occupied && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              data-testid={`plan-load-button-${slot}`}
                              disabled={busy}
                              onClick={() => handleLoadClick(slot)}
                            >
                              讀取
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              data-testid={`plan-rename-button-${slot}`}
                              disabled={busy}
                              onClick={() => handleRenameClick(slot)}
                            >
                              改名
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              data-testid={`plan-delete-button-${slot}`}
                              disabled={busy}
                              onClick={() => handleDeleteClick(slot)}
                            >
                              刪除
                            </Button>
                          </>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          data-testid={`plan-save-button-${slot}`}
                          disabled={busy}
                          onClick={() => handleSaveClick(slot)}
                        >
                          存入此格
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={overwriteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setOverwriteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="plan-overwrite-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>覆蓋現有存檔？</AlertDialogTitle>
            <AlertDialogDescription>
              {overwriteTarget &&
                `格 ${overwriteTarget.slot}「${overwriteTarget.name}」(更新於 ${formatUpdatedAt(overwriteTarget.updatedAt)})將被覆蓋,確定嗎？`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {overwriteError && (
            <p role="alert" className="text-xs text-destructive">
              {overwriteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="plan-overwrite-confirm-cancel">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="plan-overwrite-confirm-accept"
              disabled={busySlot !== null}
              onClick={() => {
                if (overwriteTarget) void performSave(overwriteTarget.slot);
              }}
            >
              確定覆蓋
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={loadConfirmSlot !== null}
        onOpenChange={(next) => {
          if (!next) setLoadConfirmSlot(null);
        }}
      >
        <AlertDialogContent data-testid="plan-load-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>捨棄未儲存的變更？</AlertDialogTitle>
            <AlertDialogDescription>
              目前工作區有未儲存的變更,讀取將捨棄這些變更,確定要繼續嗎？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="plan-load-confirm-cancel">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="plan-load-confirm-accept"
              disabled={busySlot !== null}
              onClick={() => {
                if (loadConfirmSlot !== null) void performLoad(loadConfirmSlot);
              }}
            >
              繼續讀取
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent data-testid="plan-delete-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>刪除存檔？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget &&
                `格 ${deleteTarget.slot}「${deleteTarget.name}」將被刪除,連同該格的 AI 對話一併刪除,此動作無法復原。若刪除的是目前讀取中的格,畫面內容保留但不再對應任何存檔。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p role="alert" className="text-xs text-destructive">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="plan-delete-confirm-cancel">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="plan-delete-confirm-accept"
              disabled={busySlot !== null}
              onClick={() => void performDelete()}
            >
              確定刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRenameTarget(null);
        }}
      >
        <DialogContent data-testid="plan-rename-dialog">
          <DialogHeader>
            <DialogTitle>改名</DialogTitle>
          </DialogHeader>
          <Input
            data-testid="plan-rename-input"
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            placeholder="新名稱"
          />
          {renameError && (
            <p role="alert" className="text-xs text-destructive">
              {renameError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-testid="plan-rename-cancel-button"
              onClick={() => setRenameTarget(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              data-testid="plan-rename-confirm-button"
              disabled={renameInput.trim() === "" || busySlot !== null}
              onClick={() => void performRename()}
            >
              確認
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
