import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16 font-sans">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 text-center sm:items-start sm:text-left">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-black tracking-tight text-foreground">
            展覽自動排程
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600">
            線上規劃展場空間的軟體服務：繪製 2D 場地平面圖、擺放展場家具，
            並由 AI 依你的需求自動配置動線與家具位置，再一鍵轉為 3D 場景預覽
            實際佈展效果。
          </p>
          <p className="max-w-md text-lg leading-8 text-zinc-600">
            服務以一次買斷的方案提供，每個方案含固定次數的 AI 規劃生成。
          </p>
        </div>
        <Link
          href="/pricing"
          className="inline-flex h-10 items-center justify-center rounded-md bg-blueprint px-5 text-sm font-medium text-white hover:opacity-90"
        >
          查看服務方案與價格
        </Link>
      </main>
    </div>
  );
}
