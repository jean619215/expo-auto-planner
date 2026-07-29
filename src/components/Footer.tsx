// 全站頁尾。金流審核要求「無須登入」即可從網站任一頁走到商品、條款、退款、
// 隱私與聯絡資訊 — 這些連結必須對所有訪客可見,不可依登入狀態隱藏。

import Link from "next/link";
import { SITE } from "@/lib/site";

const links = [
  { href: "/pricing", label: "服務方案與價格" },
  { href: "/terms", label: "服務條款" },
  { href: "/refund", label: "退款政策" },
  { href: "/privacy", label: "隱私權政策" },
];

export default function Footer() {
  return (
    <footer
      data-testid="site-footer"
      className="mt-auto border-t border-line/70 px-4 py-6 text-sm text-muted-foreground"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              data-testid={`footer-link-${link.href.slice(1)}`}
              className="hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <p data-testid="footer-contact" className="text-xs">
          {SITE.sellerName}｜客服信箱 {SITE.supportEmail}｜客服電話{" "}
          {SITE.supportPhone}｜{SITE.supportHours}
        </p>
      </div>
    </footer>
  );
}
