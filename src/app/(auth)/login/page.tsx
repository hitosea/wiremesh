"use client";

import { useState } from "react";
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

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ username: "", password: "" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error?.message || t("loginFailed"));
        return;
      }
      router.push("/dashboard");
    } catch {
      toast.error(tc("networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("loginTitle")}</CardTitle>
        <CardDescription>{t("loginDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">{t("username")}</Label>
            <Input
              id="username"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={t("usernamePlaceholder")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={t("passwordPlaceholder")}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("loggingIn") : t("login")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
