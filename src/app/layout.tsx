import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hospeech - 医院智能语音呼叫",
  description: "Hospeech 医院智能语音助手，通过语音识别帮助患者快速呼叫需要的医护人员",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link rel="preload" href="/ringtone.mp3" as="audio" />
      </head>
      <body className="min-h-full flex flex-col touch-manipulation">{children}</body>
    </html>
  );
}
