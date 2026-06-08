import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hospeech - 医疗健康智能匹配",
  description: "Hospeech 医院智能语音助手，为患者和家属提供便捷的医疗健康咨询服务",
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
