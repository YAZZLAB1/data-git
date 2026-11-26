import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { getCurrentUser } from "@/server/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Finance OS", template: "%s · Finance OS" },
  description: "Your personal finance command center.",
  robots: { index: false, follow: false },
};

/** Applies the theme before paint to avoid a flash. */
function themeScript(pref: string) {
  return `(function(){try{var p=${JSON.stringify(pref)};var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.theme=p;}catch(e){}})();`;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(user?.theme ?? "system") }} />
      </head>
      <body className="min-h-screen font-sans">
        {children}
        <Toaster position="bottom-right" toastOptions={{ classNames: { toast: "!rounded-xl !border-border !bg-popover !text-popover-foreground !shadow-card-hover" } }} />
      </body>
    </html>
  );
}
