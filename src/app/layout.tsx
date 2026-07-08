import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "1888 — Discord Tools",
  description: "أداة ديسكورد عربية متكاملة — 34 ميزة + 2FA + فحص فيروسات",
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
    apple: '/icon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
