import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BGWB 桌游白板",
  description: "一个用来展示和分享桌游收藏的无限画布。"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
