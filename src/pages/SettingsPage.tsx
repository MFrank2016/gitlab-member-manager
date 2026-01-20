import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { getGitLabConfig, setGitLabConfig } from "@/lib/invoke";

export function SettingsPage() {
  const [baseUrl, setBaseUrl] = React.useState("https://gitlab.com");
  const [token, setToken] = React.useState("");
  const [status, setStatus] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getGitLabConfig()
      .then((cfg) => {
        if (cfg) {
          setBaseUrl(cfg.baseUrl);
          setToken(cfg.token);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function onSave() {
    setStatus("");
    try {
      await setGitLabConfig(baseUrl.trim(), token.trim());
      setStatus("✅ 已保存到数据库，下次启动将自动加载");
    } catch (e) {
      setStatus(`❌ 保存失败：${String(e)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-col items-start gap-2">
        <div className="space-y-2">
                <h2 className="text-xl font-semibold">GitLab 配置</h2>
                <p className="text-sm text-muted-foreground">
                  请输入 GitLab Base URL（如 https://gitlab.example.com）和 Private Token。配置将保存到本地数据库，启动时自动加载。
                </p>
              </div>
        </PanelHeader>
        <PanelBody>
        <div className="grid gap-4 max-w-xl">
                <div className="grid gap-2">
                  <Label>Base URL</Label>
                  <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://gitlab.example.com" disabled={loading} />
                </div>
                <div className="grid gap-2">
                  <Label>Private Token</Label>
                  <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="glpat-..." disabled={loading} />
                  <p className="text-xs text-muted-foreground">建议使用 Project/Group Access Token 或 Personal Access Token（至少具备 API 权限）。</p>
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={onSave} disabled={loading}>保存配置</Button>
                  {status && <span className="text-sm">{status}</span>}
                </div>
              </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
