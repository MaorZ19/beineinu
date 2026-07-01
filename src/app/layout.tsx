import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maori Ink Screen",
  description: "Random lovely moments from our chat, on e-paper.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
