"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { loginRequest } from "@/lib/auth-client";
import { isValidEmail, isValidPassword, MIN_PASSWORD_LENGTH } from "@/lib/validation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setErrorMsg("");

    if (!isValidEmail(email)) {
      setErrorMsg("請輸入有效的 email 格式");
      return;
    }
    if (!isValidPassword(password)) {
      setErrorMsg(`密碼長度至少需 ${MIN_PASSWORD_LENGTH} 個字元`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await loginRequest(email, password);
      if (result.ok) {
        router.push("/");
        router.refresh();
        return;
      }
      setErrorMsg(result.error ?? "登入失敗，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-sm rounded-2xl border border-black/8 bg-white p-8 shadow-sm dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          登入
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          使用註冊時的 email 與密碼登入。
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              required
              className="rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-white/18"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">密碼</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              required
              className="rounded-lg border border-black/12 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-500 disabled:opacity-60 dark:border-white/18"
            />
          </label>

          {errorMsg && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 h-11 rounded-full bg-foreground px-5 font-medium text-background transition-colors hover:bg-[#383838] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#ccc]"
          >
            {submitting ? "登入中…" : "登入"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          還沒有帳號？{" "}
          <Link href="/register" className="font-medium text-zinc-950 underline dark:text-zinc-50">
            前往註冊
          </Link>
        </p>
      </div>
    </main>
  );
}
