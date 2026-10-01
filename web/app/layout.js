import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata = {
  title: {
    default: "Stokvel Administration System",
    template: "%s — Stokvel Administration System"
  },
  description:
    "The book of account for rotating savings clubs, grocery stokvels and burial societies.",
  robots: { index: false, follow: false }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#70283E"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-ZA">
      <body className="font-sans">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}