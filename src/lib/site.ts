// 對外公開頁面(方案、服務條款、隱私權、退款政策)共用的站台/賣家資訊。
//
// ⚠️ 金流審核(綠界)會逐項檢查「聯絡方式、退款政策、服務內容說明」是否
// 在「無須登入」的頁面上可見。
//
// 目前刻意只提供 email + LINE 兩個聯絡管道:賣家姓名、客服電話、聯絡地址
// 尚未決定要公開哪些資料,先不放 placeholder(留假字串送審必被駁回,不如
// 不放)。這是「先送審看看,被退再補」的取捨 —— 若駁回理由指向聯絡資訊
// 不足,就把 sellerName / supportPhone / address 三個欄位加回來並在
// pricing / privacy / terms / refund 四頁與 Footer 一併顯示。
export const SITE = {
  name: "展覽自動排程",
  tagline: "AI 輔助的展場平面規劃工具",
  supportEmail: "northlab.tw@gmail.com",
  supportHours: "週一至週五 10:00–18:00（例假日除外）",
  // LINE 官方帳號（未認證/免費方案，ID 由系統配發）。非金流審核必要項目，
  // 純粹多一個台灣使用者習慣的聯絡管道。
  lineId: "@910xtpus",
  // 加好友連結。手機點擊直接開啟 LINE；QR code 圖檔給桌機/印刷品用
  // （手機無法掃自己螢幕上的碼，所以連結才是手機訪客的主要入口）。
  lineUrl: "https://line.me/R/ti/p/@910xtpus",
  lineQr: "/line-qr.png",
} as const;
