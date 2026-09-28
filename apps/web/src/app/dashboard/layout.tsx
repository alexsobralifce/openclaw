import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { BottomNav } from "@/components/layout/BottomNav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh bg-gray-950 text-gray-100 overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
