"use client";

import dynamic from "next/dynamic";
import type { Column, FloorPolygon, WallSegment } from "@/lib/venue/plan";
import type { FurnitureItem } from "@/lib/venue/furniture";
import type { SurfaceSelection } from "@/lib/venue/surfacePresets";

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
  viewCenterM?: { x: number; y: number };
  surfaces: SurfaceSelection;
  surfaceUploads: { floor: string | null; wall: string | null };
  wallHeightM: number;
}

export default function RefinedSceneLoader({
  polygon,
  walls,
  columns,
  furniture,
  venueSizeM,
  viewFitSizeM,
  viewCenterM,
  surfaces,
  surfaceUploads,
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
      viewCenterM={viewCenterM}
      surfaces={surfaces}
      surfaceUploads={surfaceUploads}
      wallHeightM={wallHeightM}
    />
  );
}
