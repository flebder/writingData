import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Writing Analytics Dashboard",
  description: "A polished writing analytics dashboard powered by Google Sheets"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
