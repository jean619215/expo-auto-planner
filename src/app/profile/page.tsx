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
            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">暱稱</span>
                <input
                  type="text"
                  name="nickname"
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
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {saveError}
                </p>
              )}
              {saveSuccess && (
                <p role="status" className="text-sm text-green-600 dark:text-green-400">
                  {saveSuccess}
                </p>
              )}

              <button
                type="submit"
                disabled={saving}
                className="mt-2 h-11 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
              >
                {saving ? "儲存中…" : "儲存"}
              </button>
            </form>
        )}
      </div>
    </main>
  );
}
