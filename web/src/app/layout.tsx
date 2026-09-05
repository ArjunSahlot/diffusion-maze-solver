import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

import "./globals.css";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
const serif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
});

/** Resolves the theme before first paint so there is never a flash of the wrong one. */
const themeScript = `(function(){try{var t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.classList.toggle("dark",t==="dark");document.documentElement.style.colorScheme=t}catch(e){}})()`;

const title = "Diffusion maze solver";
const description =
  "A diffusion model that solves mazes by denoising instead of searching. Draw a maze and watch a path appear, running entirely in your browser.";

export const metadata: Metadata = {
  metadataBase: new URL("https://maze-diffusion.arjunsahlot.com"),
  title,
  description,
  authors: [{ name: "Arjun Sahlot", url: "https://arjunsahlot.com" }],
  creator: "Arjun Sahlot",
  openGraph: { type: "website", title, description, url: "/", locale: "en_US" },
  twitter: { card: "summary_large_image", title, description, creator: "@arjunsahlot" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  // The theme script sets `class` and `color-scheme` on <html> before React hydrates,
  // so those two attributes are expected to differ from the server output.
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${serif.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
