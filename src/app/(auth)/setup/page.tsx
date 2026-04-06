"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [form, setForm] = useState({
    username: "",
    password: "",
    confirmPassword: "",
    wgDefaultSubnet: "",
  });

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (data?.data?.initialized) {
          router.replace("/login");
        } else {
          setChecking(false);
        }
      })
      .catch(() => setChecking(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }
    if (form.password.length < 6) {
      toast.error("密码至少需要 6 位字符");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          wgDefaultSubnet: form.wgDefaultSubnet || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message || "初始化失败");
        return;
      }
      toast.success("系统初始化成功，请登录");
      router.push("/login");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>初始化系统</CardTitle>
        <CardDescription>创建管理员账号以开始使用 WireMesh</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input
              id="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="请输入用户名"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="至少 6 位字符"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">确认密码</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              placeholder="再次输入密码"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wgDefaultSubnet">WireGuard 默认子网（可选）</Label>
            <Input
              id="wgDefaultSubnet"
              value={form.wgDefaultSubnet}
              onChange={(e) => setForm({ ...form, wgDefaultSubnet: e.target.value })}
              placeholder="10.210.0.0/24"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "初始化中..." : "初始化系统"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
