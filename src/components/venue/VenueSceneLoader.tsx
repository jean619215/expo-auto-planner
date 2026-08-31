"use client";

import dynamic from "next/dynamic";
import type {
  Column,
  FloorBounds,
  FloorPolygon,
  WallSegment,
} from "@/lib/venue/plan";
import type { FurnitureItem } from "@/lib/venue/furniture";

const VenueScene = dynamic(() => import("./VenueScene"), {
  ssr: false,
  loading: () => (
    <div className="mt-4 flex h-[480px] w-full items-center justify-center rounded border border-stone-200 bg-stone-50 text-sm text-stone-500">
      載入中…
    </div>
  ),
});

interface VenueSceneLoaderProps {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
  furniture: FurnitureItem[];
  venueSizeM?: number;
  planArea?: FloorBounds;
  viewFitSizeM?: number;
  viewCenterM?: { x: number; y: number };
  wallHeightM: number;
  onWallHeightChange?: (meters: number) => void;
  onSceneChange?: (next: {
    walls: WallSegment[];
    columns: Column[];
    furniture: FurnitureItem[];
  }) => void;
}

export default function VenueSceneLoader({
  polygon,
  walls,
  columns,
  furniture,
  venueSizeM,
  planArea,
  viewFitSizeM,
  viewCenterM,
  wallHeightM,
  onWallHeightChange,
  onSceneChange,
}: VenueSceneLoaderProps) {
  return (
    <VenueScene
      polygon={polygon}
      walls={walls}
      columns={columns}
      furniture={furniture}
      venueSizeM={venueSizeM}
      planArea={planArea}
      viewFitSizeM={viewFitSizeM}
      viewCenterM={viewCenterM}
      wallHeightM={wallHeightM}
      onWallHeightChange={onWallHeightChange}
      onSceneChange={onSceneChange}
    />
  );
}
