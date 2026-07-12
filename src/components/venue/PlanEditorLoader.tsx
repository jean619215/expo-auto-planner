"use client";

import dynamic from "next/dynamic";

const PlanEditor = dynamic(() => import("./PlanEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[320px] w-full items-center justify-center rounded border border-zinc-200 bg-zinc-50 text-sm text-zinc-500">
      載入中…
    </div>
  ),
});

export default function PlanEditorLoader() {
  return <PlanEditor />;
}
