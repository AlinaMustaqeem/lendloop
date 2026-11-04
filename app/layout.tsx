import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LendLoop — Borrow better, together", template: "%s — LendLoop" },
  description: "A neighborhood tool-lending board. Borrow what you need. Lend what you don't.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body><ConvexClientProvider>{children}</ConvexClientProvider></body>
      </html>
    </ClerkProvider>
  );
}
