"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function NewSubscriptionPage() {
  const t = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const te = useTranslations("errors");
  const router = useRouter();

  const [name, setName] = useState("");
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(te("validation.nameRequired"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), remark: remark.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(translateError(json.error, te, t("createFailed")));
      }
      toast.success(t("saved"));
      router.push(`/subscriptions/${json.data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("create")}</h1>
        <Button variant="outline" onClick={() => router.push("/subscriptions")}>
          {tc("back")}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>{t("tabBasic")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                {t("name")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                disabled={submitting}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="remark">{t("remark")}</Label>
              <Textarea
                id="remark"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder={t("remarkPlaceholder")}
                disabled={submitting}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/subscriptions")}
            disabled={submitting}
          >
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? tc("creating") : tc("create")}
          </Button>
        </div>
      </form>
    </div>
  );
}
