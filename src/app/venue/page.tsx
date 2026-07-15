import PlanEditorLoader from "@/components/venue/PlanEditorLoader";

export default function VenuePage() {
  return (
    <main className="flex flex-1 flex-col items-center gap-8 px-4 py-16">
      <div className="w-full max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          場地規劃
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground/70">
          先在下方 2D 平面圖中繪製場地:點選「牆壁」或「柱子」工具後,在畫布上拖曳即可新增;
          「選取」模式下點擊物件可移動、拖曳邊角可調整大小,選取後按 Delete
          鍵可刪除。完成後按「下一步」即可預覽 3D 場景。
        </p>
        <div className="mt-6">
          <PlanEditorLoader />
        </div>
      </div>
    </main>
  );
}
