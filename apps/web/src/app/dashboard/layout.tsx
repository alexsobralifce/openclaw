import type { Metadata } from "next";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ThemeSync } from "@/components/layout/ThemeSync";
import { PwaPrompt } from "@/components/layout/PwaPrompt";
import { WelcomeTour } from "@/components/onboarding/WelcomeTour";

// O painel é de uso interno: fora do Google
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh bg-gray-950 text-gray-100 overflow-hidden">
      <ThemeSync />
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        <PwaPrompt />
        <WelcomeTour />
      </div>
    </div>
  );
}
