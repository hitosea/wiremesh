"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { translateError } from "@/lib/translate-error";
import { useTranslations } from "next-intl";
import { AuditLogsList } from "@/components/audit-logs-list";

type SettingsData = Record<string, string>;

type FieldDef = {
  key: string;
  placeholder: string;
  type?: string;
  min?: number;
  max?: number;
};

type SettingGroup = {
  titleKey: string;
  descriptionKey?: string;
  fields: FieldDef[];
};

const SETTING_GROUPS: SettingGroup[] = [
  {
    titleKey: "wg.title",
    descriptionKey: "wg.description",
    fields: [
      { key: "wg_default_port", placeholder: "41820", type: "number", min: 1, max: 65535 },
      { key: "wg_default_subnet", placeholder: "10.210.0.0/24" },
      { key: "wg_default_dns", placeholder: "1.1.1.1" },
      { key: "wg_node_ip_start", placeholder: "1", type: "number", min: 1, max: 254 },
      { key: "wg_device_ip_start", placeholder: "100", type: "number", min: 1, max: 254 },
    ],
  },
  {
    titleKey: "xray.title",
    fields: [
      { key: "xray_default_port", placeholder: "41443", type: "number", min: 1, max: 65535 },
    ],
  },
  {
    titleKey: "tunnel.title",
    fields: [
      { key: "tunnel_subnet", placeholder: "10.211.0.0/16" },
      { key: "tunnel_port_start", placeholder: "41830", type: "number", min: 1, max: 65535 },
    ],
  },
  {
    titleKey: "filter.title",
    fields: [
      { key: "filter_sync_interval", placeholder: "86400", type: "number", min: 60 },
      { key: "dns_upstream", placeholder: "tls://8.8.8.8,tls://1.1.1.1" },
    ],
  },
];

export default function SettingsPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-48 text-muted-foreground">{tc("loading")}</div>}>
      <SettingsContainer />
    </Suspense>
  );
}

function SettingsContainer() {
  const t = useTranslations("settings");
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") === "logs" ? "logs" : "settings";

  const handleTabChange = (value: string) => {
    if (value === "logs") {
      router.replace("/settings?tab=logs");
    } else {
      router.replace("/settings");
    }
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="settings" className="px-4">{t("tabs.settings")}</TabsTrigger>
        <TabsTrigger value="logs" className="px-4">{t("tabs.logs")}</TabsTrigger>
      </TabsList>
      <TabsContent value="settings" className="mt-4">
        <SettingsTab />
      </TabsContent>
      <TabsContent value="logs" className="mt-4">
        <AuditLogsList />
      </TabsContent>
    </Tabs>
  );
}

function SettingsTab() {
  const t = useTranslations("settings");
  const tg = useTranslations("settingsGroups");
  const tf = useTranslations("settingsFields");
  const tc = useTranslations("common");
  const te = useTranslations("errors");

  const [values, setValues] = useState<SettingsData>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((json) => {
        setValues(json.data ?? {});
      })
      .catch(() => toast.error(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [t]);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        toast.success(t("saved"));
      } else {
        const json = await res.json();
        const keys = (json.error?.message ?? "").split(";").filter(Boolean);
        if (keys.length > 0) {
          keys.forEach((key: string) => toast.error(te(key.trim())));
        } else {
          toast.error(tc("saveFailed"));
        }
      }
    } catch {
      toast.error(tc("saveFailedRetry"));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error(t("passwordFieldsRequired"));
      return;
    }
    if (newPassword.length < 6) {
      toast.error(t("newPasswordTooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t("newPasswordMismatch"));
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.ok) {
        toast.success(t("passwordChanged"));
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const json = await res.json();
        toast.error(translateError(json.error, te, t("changePasswordFailed")));
      }
    } catch {
      toast.error(t("changePasswordFailedRetry"));
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        {tc("loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {SETTING_GROUPS.map((group) => (
        <Card key={group.titleKey}>
          <CardHeader>
            <CardTitle>{tg(group.titleKey)}</CardTitle>
            {group.descriptionKey && (
              <p className="text-sm text-muted-foreground">{tg(group.descriptionKey)}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{tf(`${field.key}.label`)}</Label>
                  <Input
                    id={field.key}
                    type={field.type ?? "text"}
                    min={field.min}
                    max={field.max}
                    value={values[field.key] ?? ""}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder ?? field.key}
                  />
                  <p className="text-xs text-muted-foreground">{tf(`${field.key}.hint`)}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? tc("saving") : tc("save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>{t("changePassword")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-md space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">{t("currentPassword")}</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t("currentPasswordPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">{t("newPassword")}</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("newPasswordPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("confirmNewPassword")}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("confirmNewPasswordPlaceholder")}
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={handleChangePassword} disabled={changingPassword}>
              {changingPassword ? t("changingPassword") : t("changePasswordBtn")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
