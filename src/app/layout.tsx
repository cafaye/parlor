import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "parlor",
  description:
    "The cafaye app shell. Layout primitives, theme tokens and health surfaces — you own the code.",
};

// Props are typed explicitly rather than with Next 16's generated
// `LayoutProps<"/">`: that global only exists after `next build` has written
// .next/types, so `npm run typecheck` would fail on a fresh clone — exactly
// when you most want it to run. If you move to typed routes later, switch this
// back and add `next build &&` ahead of typecheck in CI.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
