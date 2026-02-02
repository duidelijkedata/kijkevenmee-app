import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kijk even mee",
  description: "Veilig meekijken op afstand (zonder overname).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <div className="mx-auto max-w-5xl p-4 sm:p-8">{children}</div>
      </body>
    </html>
  );
}
