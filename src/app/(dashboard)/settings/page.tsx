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
    description: "以下设置仅对新建节点/设备生效，不影响已有资源",
    fields: [
      { key: "wg_default_port", label: "默认端口", hint: "新建节点时的默认 WireGuard 监听端口" },
      { key: "wg_default_subnet", label: "默认子网", hint: "IP 自动分配的网段" },
      { key: "wg_default_dns", label: "默认 DNS", hint: "客户端配置使用的 DNS，修改后立即生效" },
      { key: "wg_node_ip_start", label: "节点 IP 起始位", hint: "节点内网 IP 从该位开始分配" },
      { key: "wg_device_ip_start", label: "设备 IP 起始位", hint: "设备内网 IP 从该位开始分配" },
    ],
  },
  {
    title: "隧道",
    description: "以下设置仅对新建线路生效",
    fields: [
      { key: "tunnel_subnet", label: "隧道子网", hint: "节点间点对点隧道的 IP 地址池" },
      { key: "tunnel_port_start", label: "隧道端口起始", hint: "隧道 WireGuard 端口自动分配起始值" },
    ],
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
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存设置"}
        </Button>
      </div>

      {SETTING_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle>{group.title}</CardTitle>
            {group.description && (
              <p className="text-sm text-muted-foreground">{group.description}</p>
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Input
                    id={field.key}
                    value={values[field.key] ?? ""}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.key}
                  />
                  {field.hint && (
                    <p className="text-xs text-muted-foreground">{field.hint}</p>
                  )}
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
            <div className="space-y-2">
              <Label htmlFor="currentPassword">当前密码</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少 6 位字符"
              />
            </div>
            <div className="space-y-2">
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
