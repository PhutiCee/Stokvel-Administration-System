import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

// One family, two widths, clearly distinct roles.
//
// Plex Sans carries everything a person reads. Plex Mono is reserved for
// figures in the ledger and for reference codes — the places where a column of
// characters has to line up vertically to be read at all. Using a monospace
// face anywhere else would be decoration.
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap"
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap"
});

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
  themeColor: "#0A1628"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-ZA" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="font-sans">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}