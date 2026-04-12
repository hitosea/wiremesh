import Sidebar, { SidebarProvider } from "@/components/sidebar";
import Topbar from "@/components/topbar";
import { AdminSSEProvider } from "@/components/admin-sse-provider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AdminSSEProvider>
        <div className="flex h-dvh">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <Topbar />
            <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
          </div>
        </div>
      </AdminSSEProvider>
    </SidebarProvider>
  );
}
