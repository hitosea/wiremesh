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
      { key: "wg_default_port", label: "默认端口", placeholder: "41820", type: "number", hint: "新建节点时的默认 WireGuard 监听端口（UDP），需在节点防火墙中放行" },
      { key: "wg_default_subnet", label: "默认子网", placeholder: "10.210.0.0/24", hint: "IP 自动分配的网段" },
      { key: "wg_default_dns", label: "默认 DNS", placeholder: "1.1.1.1", hint: "客户端配置使用的 DNS，修改后立即生效" },
      { key: "wg_node_ip_start", label: "节点 IP 起始位", placeholder: "1", type: "number", hint: "节点内网 IP 从该位开始分配" },
      { key: "wg_device_ip_start", label: "设备 IP 起始位", placeholder: "100", type: "number", hint: "设备内网 IP 从该位开始分配" },
    ],
  },
  {
    title: "隧道",
    description: "以下设置仅对新建线路生效",
    fields: [
      { key: "tunnel_subnet", label: "隧道子网", placeholder: "10.211.0.0/16", hint: "节点间点对点隧道的 IP 地址池" },
      { key: "tunnel_port_start", label: "隧道端口起始", placeholder: "41830", type: "number", hint: "隧道端口自动分配起始值（UDP），必须大于 WireGuard 默认端口，每条隧道占两个端口，需在节点防火墙中放行对应范围" },
    ],
  },
  {
    title: "分流与 DNS",
    description: "外部规则源同步和 DNS 代理相关设置",
    fields: [
      { key: "filter_sync_interval", label: "外部规则源同步间隔（秒）", placeholder: "86400", type: "number", hint: "Agent 定时拉取外部分流规则源的间隔，最小 60 秒" },
      { key: "dns_upstream", label: "DNS 上游服务器（逗号分隔）", placeholder: "8.8.8.8,1.1.1.1", hint: "Agent DNS 代理使用的上游服务器，默认 8.8.8.8,1.1.1.1" },
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
      {SETTING_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle>{group.title}</CardTitle>
            {group.description && (
              <p className="text-sm text-muted-foreground">{group.description}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {group.fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>{field.label}</Label>
                  <Input
                    id={field.key}
                    type={field.type ?? "text"}
                    value={values[field.key] ?? ""}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder ?? field.key}
                  />
                  {field.hint && (
                    <p className="text-xs text-muted-foreground">{field.hint}</p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "保存中..." : "保存设置"}
              </Button>
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
                placeholder="请输入当前密码"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="请输入新密码（至少 6 位）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认新密码</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入新密码"
              />
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={handleChangePassword} disabled={changingPassword}>
              {changingPassword ? "修改中..." : "修改密码"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
