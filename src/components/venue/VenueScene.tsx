"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import {
  VENUE_SIZE_M,
  WALL_THICKNESS_M,
  wallLengthM,
  type Column,
  type FloorPolygon,
  type WallSegment,
} from "@/lib/venue/plan";

const WALL_HEIGHT_M = 3;
const FLOOR_THICKNESS_M = 0.1;

interface VenueSceneProps {
  polygon: FloorPolygon;
  walls: WallSegment[];
  columns: Column[];
}

function FloorMesh({ polygon }: { polygon: FloorPolygon }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(polygon[0].x, polygon[0].y);
    polygon.slice(1).forEach((p) => shape.lineTo(p.x, p.y));
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: FLOOR_THICKNESS_M,
      bevelEnabled: false,
    });
  }, [polygon]);

  return (
    <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]}>
      <meshStandardMaterial color="#f5f5f4" side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function VenueScene({ polygon, walls, columns }: VenueSceneProps) {
  return (
    <div
      data-testid="venue-scene"
      data-generated="true"
      data-wall-mesh-count={walls.length}
      data-column-mesh-count={columns.length}
      data-floor-vertex-count={polygon.length}
      className="mt-4 h-[480px] w-full overflow-hidden rounded border border-stone-300 bg-stone-100"
    >
      <Canvas
        camera={{
          position: [VENUE_SIZE_M * 0.7, VENUE_SIZE_M * 0.9, VENUE_SIZE_M * 0.7],
          fov: 50,
        }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[25, 40, 25]} intensity={0.8} />
        <FloorMesh polygon={polygon} />
        {walls.map((wall) => {
          const rotationY = -Math.atan2(
            wall.end.y - wall.start.y,
            wall.end.x - wall.start.x,
          );
          return (
            <mesh
              key={wall.id}
              position={[
                (wall.start.x + wall.end.x) / 2,
                WALL_HEIGHT_M / 2,
                (wall.start.y + wall.end.y) / 2,
              ]}
              rotation={[0, rotationY, 0]}
            >
              <boxGeometry
                args={[wallLengthM(wall), WALL_HEIGHT_M, WALL_THICKNESS_M]}
              />
              <meshStandardMaterial color="#78350f" />
            </mesh>
          );
        })}
        {columns.map((col) => (
          <mesh
            key={col.id}
            position={[col.center.x, WALL_HEIGHT_M / 2, col.center.y]}
          >
            <boxGeometry args={[col.w, WALL_HEIGHT_M, col.h]} />
            <meshStandardMaterial color="#78716c" />
          </mesh>
        ))}
      </Canvas>
    </div>
  );
}
