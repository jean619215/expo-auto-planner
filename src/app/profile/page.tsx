"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getProfileRequest,
  updateNicknameRequest,
  type Profile,
} from "@/lib/profile-client";
import { isValidNickname, NICKNAME_MAX_LENGTH } from "@/lib/validation";

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
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-black/8 bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          個人資料
        </h1>

        {pageState === "loading" && (
          <div className="mt-6 flex flex-col gap-4">
            <div className="h-11 w-full animate-pulse rounded-lg bg-black/6 dark:bg-white/8" />
            <div className="h-5 w-2/3 animate-pulse rounded bg-black/6 dark:bg-white/8" />
          </div>
        )}

        {pageState === "unauthenticated" && (
          <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
            請先登入。{" "}
            <Link
              href="/login"
              className="font-medium text-zinc-950 underline dark:text-zinc-50"
            >
              前往登入
            </Link>
          </p>
        )}

        {pageState === "error" && (
          <p role="alert" className="mt-6 text-sm text-red-600 dark:text-red-400">
            {pageError}
          </p>
        )}

        {pageState === "ready" && profile && (
          <div className="mt-6 flex flex-col gap-4">
            {mode === "view" && (
              <>
                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">暱稱</span>
                  {lastSavedNickname ? (
                    <p
                      data-testid="profile-nickname-display"
                      className="px-3 py-2 text-zinc-900 dark:text-zinc-100"
                    >
                      {lastSavedNickname}
                    </p>
                  ) : (
                    <p
                      data-testid="profile-nickname-display"
                      className="px-3 py-2 text-zinc-400 dark:text-zinc-500"
                    >
                      (未設定暱稱)
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">身分</span>
                  <p className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{profile.role}</p>
                </div>

                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">建立時間</span>
                  <p className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {formatCreatedAt(profile.created_at)}
                  </p>
                </div>

                {saveError && (
                  <p role="alert" data-testid="profile-save-error" className="text-sm text-red-600 dark:text-red-400">
                    {saveError}
                  </p>
                )}
                {saveSuccess && (
                  <p role="status" data-testid="profile-save-success" className="text-sm text-green-600 dark:text-green-400">
                    {saveSuccess}
                  </p>
                )}

                <button
                  type="button"
                  data-testid="profile-edit-button"
                  onClick={handleEdit}
                  className="mt-2 h-11 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                >
                  編輯
                </button>
              </>
            )}

            {mode === "edit" && (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">暱稱</span>
                  <input
                    type="text"
                    name="nickname"
                    data-testid="profile-nickname-input"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    disabled={saving}
                    className="rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-white/18"
                  />
                </label>

                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">身分</span>
                  <p className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{profile.role}</p>
                </div>

                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">建立時間</span>
                  <p className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {formatCreatedAt(profile.created_at)}
                  </p>
                </div>

                {saveError && (
                  <p role="alert" data-testid="profile-save-error" className="text-sm text-red-600 dark:text-red-400">
                    {saveError}
                  </p>
                )}
                {saveSuccess && (
                  <p role="status" data-testid="profile-save-success" className="text-sm text-green-600 dark:text-green-400">
                    {saveSuccess}
                  </p>
                )}

                <div className="mt-2 flex gap-3">
                  <button
                    type="submit"
                    data-testid="profile-save-button"
                    disabled={saving}
                    className="h-11 flex-1 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
                  >
                    {saving ? "儲存中…" : "儲存"}
                  </button>
                  <button
                    type="button"
                    data-testid="profile-cancel-button"
                    onClick={handleCancel}
                    disabled={saving}
                    className="h-11 flex-1 rounded-full border border-black/12 px-5 font-medium text-zinc-800 transition-colors hover:bg-black/4 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/18 dark:text-zinc-200 dark:hover:bg-white/6"
                  >
                    取消
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
