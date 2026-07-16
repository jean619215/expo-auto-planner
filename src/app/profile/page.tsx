"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getProfileRequest,
  updateNicknameRequest,
  type Profile,
} from "@/lib/profile-client";
import { isValidNickname, NICKNAME_MAX_LENGTH } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PageState = "loading" | "ready" | "unauthenticated" | "error";

const createdAtFormatter = new Intl.DateTimeFormat("zh-TW", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatCreatedAt(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return createdAtFormatter.format(date);
}

export default function ProfilePage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pageError, setPageError] = useState("");
  const [nickname, setNickname] = useState("");
  const [lastSavedNickname, setLastSavedNickname] = useState("");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");

  useEffect(() => {
    let active = true;
    getProfileRequest().then((result) => {
      if (!active) return;
      if (result.ok && result.profile) {
        setProfile(result.profile);
        setNickname(result.profile.nickname ?? "");
        setLastSavedNickname(result.profile.nickname ?? "");
        setPageState("ready");
      } else if (result.status === 401) {
        setPageState("unauthenticated");
      } else {
        setPageError(result.error ?? "載入失敗，請稍後再試");
        setPageState("error");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  function handleEdit() {
    setNickname(lastSavedNickname);
    setSaveError("");
    setSaveSuccess("");
    setMode("edit");
  }

  function handleCancel() {
    if (saving) return;
    setNickname(lastSavedNickname);
    setSaveError("");
    setSaveSuccess("");
    setMode("view");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaveError("");
    setSaveSuccess("");

    if (!isValidNickname(nickname)) {
      setSaveError(`暱稱長度不可超過 ${NICKNAME_MAX_LENGTH} 字`);
      return;
    }

    setSaving(true);
    try {
      const result = await updateNicknameRequest(nickname);
      if (result.ok && result.profile) {
        setProfile(result.profile);
        setNickname(result.profile.nickname ?? "");
        setLastSavedNickname(result.profile.nickname ?? "");
        setMode("view");
        setSaveSuccess("暱稱已更新");
      } else {
        setSaveError(result.error ?? "儲存失敗，請稍後再試");
        if (result.status === 401) {
          setPageState("unauthenticated");
        }
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <Card className="w-full max-w-sm p-8">
        <CardHeader className="p-0">
          <CardTitle className="text-2xl font-black tracking-tight text-foreground">
            個人資料
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pageState === "loading" && (
            <div className="mt-6 flex flex-col gap-4">
              <div className="h-11 w-full animate-pulse rounded-lg bg-black/6" />
              <div className="h-5 w-2/3 animate-pulse rounded bg-black/6" />
            </div>
          )}

          {pageState === "unauthenticated" && (
            <p className="mt-6 text-sm text-zinc-600">
              請先登入。{" "}
              <Link
                href="/login"
                className="font-medium text-zinc-950 underline"
              >
                前往登入
              </Link>
            </p>
          )}

          {pageState === "error" && (
            <p role="alert" className="mt-6 text-sm text-red-600">
              {pageError}
            </p>
          )}

          {pageState === "ready" && profile && (
            <div className="mt-6 flex flex-col gap-4">
              {mode === "view" && (
                <>
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-zinc-800">暱稱</span>
                    {lastSavedNickname ? (
                      <p
                        data-testid="profile-nickname-display"
                        className="px-3 py-2 text-zinc-900"
                      >
                        {lastSavedNickname}
                      </p>
                    ) : (
                      <p
                        data-testid="profile-nickname-display"
                        className="px-3 py-2 text-zinc-400"
                      >
                        (未設定暱稱)
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-zinc-800">身分</span>
                    <p className="px-3 py-2 text-zinc-600">{profile.role}</p>
                  </div>

                  <div className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-zinc-800">建立時間</span>
                    <p className="px-3 py-2 text-zinc-600">
                      {formatCreatedAt(profile.created_at)}
                    </p>
                  </div>

                  {saveError && (
                    <p
                      role="alert"
                      data-testid="profile-save-error"
                      className="text-sm text-red-600"
                    >
                      {saveError}
                    </p>
                  )}
                  {saveSuccess && (
                    <p
                      role="status"
                      data-testid="profile-save-success"
                      className="text-sm text-green-600"
                    >
                      {saveSuccess}
                    </p>
                  )}

                  <Button
                    type="button"
                    data-testid="profile-edit-button"
                    onClick={handleEdit}
                    className="mt-2"
                  >
                    編輯
                  </Button>
                </>
              )}

              {mode === "edit" && (
                <form
                  onSubmit={handleSubmit}
                  className="flex flex-col gap-4"
                  noValidate
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="nickname">暱稱</Label>
                    <Input
                      id="nickname"
                      type="text"
                      name="nickname"
                      data-testid="profile-nickname-input"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      disabled={saving}
                    />
                  </div>

                  <div className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-zinc-800">身分</span>
                    <p className="px-3 py-2 text-zinc-600">{profile.role}</p>
                  </div>

                  <div className="flex flex-col gap-1 text-sm">
                    <span className="font-medium text-zinc-800">建立時間</span>
                    <p className="px-3 py-2 text-zinc-600">
                      {formatCreatedAt(profile.created_at)}
                    </p>
                  </div>

                  {saveError && (
                    <p
                      role="alert"
                      data-testid="profile-save-error"
                      className="text-sm text-red-600"
                    >
                      {saveError}
                    </p>
                  )}
                  {saveSuccess && (
                    <p
                      role="status"
                      data-testid="profile-save-success"
                      className="text-sm text-green-600"
                    >
                      {saveSuccess}
                    </p>
                  )}

                  <div className="mt-2 flex gap-3">
                    <Button
                      type="submit"
                      data-testid="profile-save-button"
                      disabled={saving}
                      className="flex-1"
                    >
                      {saving ? "儲存中…" : "儲存"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="profile-cancel-button"
                      onClick={handleCancel}
                      disabled={saving}
                      className="flex-1"
                    >
                      取消
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
