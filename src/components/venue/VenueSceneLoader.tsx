"use client";

import dynamic from "next/dynamic";
import type { Column, FloorPolygon, WallSegment } from "@/lib/venue/plan";

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
}

export default function VenueSceneLoader({
  polygon,
  walls,
  columns,
}: VenueSceneLoaderProps) {
  return <VenueScene polygon={polygon} walls={walls} columns={columns} />;
}
