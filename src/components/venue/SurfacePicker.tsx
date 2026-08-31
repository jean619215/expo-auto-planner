"use client";

// 地板/牆面材質的縮圖選擇器(第四輪)。
//
// 取代原本的 `<select>` —— 下拉選單裡只有名字,而「水泥」與「磨損水泥(實拍)」
// 光看名字分不出差別:兩者底色幾乎一樣,差別全在紋理。使用者必須先選下去、
// 等場景重新烘焙、看一眼、再換一個,才知道自己要的是哪一款。縮圖把那個來回
// 變成一眼。
//
// 縮圖來自 `surfaceThumbnails.ts`,是**實際的材質**(程序化用同一支烘焙
// shader,實拍用貼圖檔本身),不是手挑的示意色塊。

import { surfaceThumbnail } from "./surfaceThumbnails";
import type { SurfacePreset } from "@/lib/venue/surfacePresets";
import { cn } from "@/lib/utils";

/**
 * 單一款式的縮圖。
 *
 * 烘焙是同步的(一張 96² 的全螢幕四邊形),所以不需要載入狀態 —— 但實拍那條
 * 路徑回傳的是檔案 URL,瀏覽器自己非同步載入,`<img>` 本來就處理得了。
 */
export function SurfaceSwatch({
  surface,
  presetId,
  className,
}: {
  surface: "floor" | "wall";
  presetId: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={surfaceThumbnail(surface, presetId)}
      alt=""
      data-testid={`surface-swatch-${surface}-${presetId}`}
      className={cn("size-full object-cover", className)}
    />
  );
}

export default function SurfacePicker({
  surface,
  label,
  presets,
  value,
  onChange,
}: {
  surface: "floor" | "wall";
  label: string;
  presets: SurfacePreset[];
  value: string;
  onChange: (presetId: string) => void;
}) {
  return (
    <div
      data-testid={`surface-picker-${surface}`}
      data-selected={value}
      className="flex flex-col gap-1"
    >
      <span className="px-0.5 text-[11px] font-bold text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((preset) => {
          const active = preset.id === value;
          return (
            <button
              key={preset.id}
              type="button"
              data-testid={`surface-option-${surface}-${preset.id}`}
              aria-pressed={active}
              title={preset.label}
              onClick={() => onChange(preset.id)}
              className={cn(
                "flex w-16 flex-col items-center gap-0.5 rounded border p-1 transition-colors",
                "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "border-blueprint bg-blueprint-wash"
                  : "border-stone-300 bg-card hover:bg-blueprint-wash",
              )}
            >
              <span className="size-12 overflow-hidden rounded-sm border border-stone-200">
                <SurfaceSwatch surface={surface} presetId={preset.id} />
              </span>
              <span
                // 標籤換行而不是截斷:「木質地板(實拍)」被截成「木質地板…」
                // 之後,與「木地板」在畫面上看起來是同一款。完整名稱本來就在
                // title 裡,但那要 hover 才看得到 —— 選單上的東西應該直接讀得完。
                //
                // 同一列的格子高度會自動對齊(flex 的預設 align-items: stretch
                // 讓同一行的項目等高),所以兩行標籤不會把那一列弄歪。
                className={cn(
                  "w-full text-center text-[10px] leading-tight break-words",
                  active ? "font-bold text-blueprint" : "text-muted-foreground",
                )}
              >
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
