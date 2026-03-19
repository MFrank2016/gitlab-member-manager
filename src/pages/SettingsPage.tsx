import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { getGitLabConfig, setGitLabConfig } from "@/lib/invoke";

export function SettingsPage() {
  const [baseUrl, setBaseUrl] = React.useState("https://gitlab.com");
  const [token, setToken] = React.useState("");
  const [localRepoRoot, setLocalRepoRoot] = React.useState("");
  const [defaultBranch, setDefaultBranch] = React.useState("master");
  const [defaultRemote, setDefaultRemote] = React.useState("origin");
  const [status, setStatus] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    getGitLabConfig()
      .then((cfg) => {
        if (!cfg) return;
        setBaseUrl(cfg.baseUrl);
        setToken(cfg.token);
        setLocalRepoRoot(cfg.localRepoRoot ?? "");
        setDefaultBranch(cfg.defaultBranch ?? "master");
        setDefaultRemote(cfg.defaultRemote ?? "origin");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function onSave() {
    setStatus("");
    try {
      await setGitLabConfig({
        baseUrl: baseUrl.trim(),
        token: token.trim(),
        localRepoRoot: localRepoRoot.trim() || null,
        defaultBranch: defaultBranch.trim() || "master",
        defaultRemote: defaultRemote.trim() || "origin",
      });
      setStatus("已保存到数据库，下次启动将自动加载。");
    } catch (error) {
      setStatus(`保存失败：${String(error)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-col items-start gap-2">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">GitLab 配置</h2>
            <p className="text-sm text-muted-foreground">
              请输入 GitLab Base URL、Private Token，以及托管项目的本地默认路径和 git 默认值。
            </p>
          </div>
        </PanelHeader>
        <PanelBody>
          <div className="grid max-w-2xl gap-4">
            <div className="grid gap-2">
              <Label htmlFor="gitlab-base-url">Base URL</Label>
              <Input
                id="gitlab-base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://gitlab.example.com"
                disabled={loading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="gitlab-token">Private Token</Label>
              <Input
                id="gitlab-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="glpat-..."
                disabled={loading}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="local-repo-root">本地仓库根目录</Label>
              <Input
                id="local-repo-root"
                value={localRepoRoot}
                onChange={(event) => setLocalRepoRoot(event.target.value)}
                placeholder="D:/repos"
                disabled={loading}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="default-branch">默认分支</Label>
                <Input
                  id="default-branch"
                  value={defaultBranch}
                  onChange={(event) => setDefaultBranch(event.target.value)}
                  placeholder="master"
                  disabled={loading}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="default-remote">默认远程</Label>
                <Input
                  id="default-remote"
                  value={defaultRemote}
                  onChange={(event) => setDefaultRemote(event.target.value)}
                  placeholder="origin"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={onSave} disabled={loading}>
                保存配置
              </Button>
              {status && <span className="text-sm">{status}</span>}
            </div>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}

