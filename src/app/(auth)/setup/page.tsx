"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("setup");
  const ta = useTranslations("auth");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
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
      toast.error(t("passwordMismatch"));
      return;
    }
    if (form.password.length < 6) {
      toast.error(t("passwordTooShort"));
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
        toast.error(data?.error?.message ? te(data.error.message, data.error.params) : t("initFailed"));
        return;
      }
      toast.success(t("initSuccess"));
      router.push("/login");
    } catch {
      toast.error(tc("networkError"));
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
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">{ta("username")}</Label>
            <Input
              id="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={ta("usernamePlaceholder")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{ta("password")}</Label>
            <Input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={t("passwordMinLength")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              placeholder={t("confirmPasswordPlaceholder")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wgDefaultSubnet">{t("defaultSubnet")}</Label>
            <Input
              id="wgDefaultSubnet"
              value={form.wgDefaultSubnet}
              onChange={(e) => setForm({ ...form, wgDefaultSubnet: e.target.value })}
              placeholder="10.210.0.0/24"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("initializing") : t("initializeSystem")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
