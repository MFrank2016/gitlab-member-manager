import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setGitLabConfig } from "@/lib/invoke";

function loadRemembered() {
  try {
    const raw = localStorage.getItem("glm_cfg");
    if (!raw) return null;
    return JSON.parse(raw) as { baseUrl: string; token: string };
  } catch {
    return null;
  }
}

export function SettingsPage() {
  const remembered = loadRemembered();
  const [baseUrl, setBaseUrl] = React.useState(remembered?.baseUrl ?? "https://gitlab.com");
  const [token, setToken] = React.useState(remembered?.token ?? "");
  const [remember, setRemember] = React.useState(Boolean(remembered));
  const [status, setStatus] = React.useState<string>("");

  async function onSave() {
    setStatus("");
    try {
      await setGitLabConfig(baseUrl.trim(), token.trim());
      if (remember) {
        localStorage.setItem("glm_cfg", JSON.stringify({ baseUrl: baseUrl.trim(), token: token.trim() }));
      } else {
        localStorage.removeItem("glm_cfg");
      }
      setStatus("✅ 已保存（本次会话后端会使用该配置）");
    } catch (e) {
      setStatus(`❌ 保存失败：${String(e)}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">GitLab 配置</h2>
        <p className="text-sm text-muted-foreground">
          请输入 GitLab Base URL（如 https://gitlab.example.com）和 Private Token。
        </p>
      </div>

      <div className="grid gap-4 max-w-xl">
        <div className="grid gap-2">
          <Label>Base URL</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gitlab.example.com" />
        </div>
        <div className="grid gap-2">
          <Label>Private Token</Label>
          <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="glpat-..." />
          <p className="text-xs text-muted-foreground">建议使用 Project/Group Access Token 或 Personal Access Token（至少具备 API 权限）。</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          记住配置到 localStorage（不推荐在共享电脑）
        </label>
        <div className="flex items-center gap-3">
          <Button onClick={onSave}>保存配置</Button>
          {status && <span className="text-sm">{status}</span>}
        </div>
      </div>
    </div>
  );
}
