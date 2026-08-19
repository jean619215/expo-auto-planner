"use client";

import dynamic from "next/dynamic";
import type { Column, FloorPolygon, WallSegment } from "@/lib/venue/plan";
import type { FurnitureItem } from "@/lib/venue/furniture";

const RefinedScene = dynamic(() => import("./RefinedScene"), {
  ssr: false,
  loading: () => (
    <div className="mt-4 flex h-[480px] w-full items-center justify-center rounded border border-stone-200 bg-stone-50 text-sm text-stone-500">
      載入中…
    </div>
  ),
});

interface RefinedSceneLoaderProps {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  venueSizeM?: number;
  viewFitSizeM?: number;
  wallHeightM: number;
}

export default function RefinedSceneLoader({
  polygon,
  walls,
  columns,
  furniture,
  venueSizeM,
  viewFitSizeM,
  wallHeightM,
}: RefinedSceneLoaderProps) {
  return (
    <RefinedScene
      polygon={polygon}
      walls={walls}
      columns={columns}
      furniture={furniture}
      venueSizeM={venueSizeM}
      viewFitSizeM={viewFitSizeM}
      wallHeightM={wallHeightM}
    />
  );
}
