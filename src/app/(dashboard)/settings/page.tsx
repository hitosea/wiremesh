"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

type SettingsData = Record<string, string>;

const SETTING_GROUPS = [
  {
    titleKey: "wg.title",
    descriptionKey: "wg.description",
    fields: [
      { key: "wg_default_port", placeholder: "41820", type: "number" },
      { key: "wg_default_subnet", placeholder: "10.210.0.0/24" },
      { key: "wg_default_dns", placeholder: "1.1.1.1" },
      { key: "wg_node_ip_start", placeholder: "1", type: "number" },
      { key: "wg_device_ip_start", placeholder: "100", type: "number" },
    ],
  },
  {
    titleKey: "tunnel.title",
    descriptionKey: undefined,
    fields: [
      { key: "tunnel_subnet", placeholder: "10.211.0.0/16" },
      { key: "tunnel_port_start", placeholder: "41830", type: "number" },
    ],
  },
  {
    titleKey: "filter.title",
    descriptionKey: undefined,
    fields: [
      { key: "filter_sync_interval", placeholder: "86400", type: "number" },
      { key: "dns_upstream", placeholder: "8.8.8.8,1.1.1.1" },
    ],
  },
];

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tg = useTranslations("settingsGroups");
  const tf = useTranslations("settingsFields");
  const tc = useTranslations("common");

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
        toast.error(json.error?.message ?? tc("saveFailed"));
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
        toast.error(json.error?.message ?? t("changePasswordFailed"));
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
