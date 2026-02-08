import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import RouteScaler from "@/components/RouteScaler";

export const metadata: Metadata = {
  title: "BrandWorks",
  description: "Social analytics and intelligence tools.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="antialiased">
        <RouteScaler>
          {children}
        </RouteScaler>
      </body>
    </html>
  );
}
