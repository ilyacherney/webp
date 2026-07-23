import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Быстрый WebP — конвертировать и обрезать фото онлайн",
  description:
    "Конвертация JPG, PNG, WebP и HEIC со свободным кадрированием, квадратом или кругом прямо в браузере.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
