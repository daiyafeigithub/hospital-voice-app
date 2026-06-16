import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "协同诊疗系统",
  description: "协同诊疗系统 — 远程会诊平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
      </head>
      <body className="min-h-full flex flex-col touch-manipulation">{children}</body>
    </html>
  );
}
