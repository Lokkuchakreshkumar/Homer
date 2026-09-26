import type { Metadata, Viewport } from "next";

import { createSiteMetadata } from "@/lib/site-metadata";

import "./globals.css";

export const metadata: Metadata = createSiteMetadata();

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
