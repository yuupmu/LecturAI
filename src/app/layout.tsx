import type { Metadata } from "next";
import {
  Gowun_Batang,
  IBM_Plex_Mono,
  IBM_Plex_Sans_KR,
} from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const displayFont = Gowun_Batang({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const uiFont = IBM_Plex_Sans_KR({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-ui",
  display: "swap",
});

const monoFont = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LecturAI · Lecture Margin",
  description: "강의 자료와 실시간 발화 사이의 중요한 여백을 기록합니다.",
};

// Global font variables are shared by the lecture and raw signal surfaces.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${displayFont.variable} ${uiFont.variable} ${monoFont.variable}`}>
        {children}
      </body>
    </html>
  );
}
