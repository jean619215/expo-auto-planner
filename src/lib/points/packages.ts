// 點數方案定義。Phase 1 寫死在程式碼;之後若要後台可調再搬進 DB。
// 訂單建立時會把 amount/points 快照進 point_orders,所以調整這裡不影響歷史訂單。

export interface PointPackage {
  id: string;
  name: string;
  points: number;
  bonusPoints: number; // 內含贈點數(顯示用,points 已含)
  amountTwd: number;
}

export const POINT_PACKAGES: PointPackage[] = [
  { id: "basic", name: "基本", points: 100, bonusPoints: 0, amountTwd: 100 },
  { id: "plus", name: "進階", points: 550, bonusPoints: 50, amountTwd: 500 },
  { id: "mega", name: "超值", points: 1200, bonusPoints: 200, amountTwd: 1000 },
];

export function findPackage(id: string): PointPackage | undefined {
  return POINT_PACKAGES.find((p) => p.id === id);
}
