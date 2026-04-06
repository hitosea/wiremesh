"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Topbar() {
  const router = useRouter();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
    } catch {
      toast.error("退出失败，请重试");
    }
  }

  return (
    <header className="h-14 flex-shrink-0 bg-white border-b border-gray-200 flex items-center justify-end px-6">
      <Button variant="outline" size="sm" onClick={handleLogout}>
        退出登录
      </Button>
    </header>
  );
}
