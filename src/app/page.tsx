export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16 font-sans">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 text-center sm:items-start sm:text-left">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground">
            展覽自動排程
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600">
            登入後即可管理個人資料並使用個人化的排程功能。
          </p>
        </div>
      </main>
    </div>
  );
}
