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

type SettingsData = Record<string, string>;

const SETTING_GROUPS = [
  {
    title: "WireGuard",
    fields: [
      { key: "wg_default_port", label: "默认端口" },
      { key: "wg_default_subnet", label: "默认子网" },
      { key: "wg_default_dns", label: "默认 DNS" },
      { key: "wg_node_ip_start", label: "节点 IP 起始位" },
      { key: "wg_device_ip_start", label: "设备 IP 起始位" },
    ],
  },
  {
    title: "Xray",
    fields: [
      { key: "xray_default_protocol", label: "默认协议" },
      { key: "xray_default_transport", label: "默认传输方式" },
      { key: "xray_default_port", label: "默认端口" },
    ],
  },
  {
    title: "隧道",
    fields: [
      { key: "tunnel_subnet", label: "隧道子网" },
      { key: "tunnel_port_start", label: "隧道端口起始" },
    ],
  },
  {
    title: "监控",
    fields: [{ key: "node_check_interval", label: "节点检查间隔（秒）" }],
  },
];

export default function SettingsPage() {
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
      .catch(() => toast.error("加载设置失败"))
      .finally(() => setLoading(false));
  }, []);

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
        toast.success("设置已保存");
      } else {
        const json = await res.json();
        toast.error(json.error?.message ?? "保存失败");
      }
    } catch {
      toast.error("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("请填写所有密码字段");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("新密码至少需要 6 位字符");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
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
        toast.success("密码已修改");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const json = await res.json();
        toast.error(json.error?.message ?? "修改密码失败");
      }
    } catch {
      toast.error("修改密码失败，请重试");
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground">
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">系统设置</h1>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存设置"}
        </Button>
      </div>

      {SETTING_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle>{group.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.fields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Input
                    id={field.key}
                    value={values[field.key] ?? ""}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.key}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>修改密码</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-w-md space-y-4">
            <div className="space-y-1">
              <Label htmlFor="currentPassword">当前密码</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 6 位字符"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="confirmPassword">确认新密码</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button onClick={handleChangePassword} disabled={changingPassword}>
              {changingPassword ? "修改中..." : "修改密码"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
