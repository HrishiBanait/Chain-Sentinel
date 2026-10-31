import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Bricolage_Grotesque, IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

const fontDisplay = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const fontBody = Public_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const fontMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "ChainSentinel: explainable on-chain risk monitoring for MST",
  description:
    "Watch contracts and treasuries on MST Blockchain. Every alert explains itself and links to evidence that anyone can verify on-chain.",
};

export const viewport: Viewport = {
  themeColor: "#0f2f3a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
