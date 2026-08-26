import "./globals.css";
import { AppProvider } from "@/lib/store";
import { ToastProvider } from "@/components/ui/Toast";

export const metadata = {
  title: "Stokvel Administration System",
  description:
    "Multi-tenant administration for rotating, accumulating and burial stokvels. Prototype."
};

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0A1628" };

export default function RootLayout({ children }) {
  return (
    <html lang="en-ZA">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AppProvider>
          <ToastProvider>{children}</ToastProvider>
        </AppProvider>
      </body>
    </html>
  );
}
