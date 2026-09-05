import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Diffusion maze solver",
  description:
    "A diffusion model that solves mazes by denoising instead of searching. Draw a maze and watch a path appear, running entirely in your browser.",
  openGraph: {
    title: "Diffusion maze solver",
    description: "Pathfinding through denoising. Draw a maze and watch a diffusion model solve it in your browser.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
