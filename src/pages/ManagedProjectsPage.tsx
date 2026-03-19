import * as React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";

import { ProjectCombobox } from "@/components/ProjectCombobox";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createManagedProject,
  deleteManagedProject,
  getGitLabConfig,
  listManagedProjects,
  updateManagedProject,
} from "@/lib/invoke";
import {
  createManagedProjectDraft,
  type ManagedProjectDraft,
  type ManagedProjectOnboardingDefaults,
} from "@/lib/managed-project-onboarding";
import type { GitLabConfig, ManagedProject, ProjectSummary } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

function normalizeDefaults(cfg: GitLabConfig | null): ManagedProjectOnboardingDefaults {
  return {
    localRepoRoot: cfg?.localRepoRoot ?? "",
    defaultBranch: cfg?.defaultBranch ?? "master",
    defaultRemote: cfg?.defaultRemote ?? "origin",
  };
}

function toPositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function toDraft(item: ManagedProject): ManagedProjectDraft {
  return {
    gitlabProjectId: String(item.gitlabProjectId),
    name: item.name,
    pathWithNamespace: item.pathWithNamespace,
    repoPath: item.repoPath,
    defaultBranch: item.defaultBranch,
    defaultRemote: item.defaultRemote,
    enabled: item.enabled,
  };
}

function buildPayload(draft: ManagedProjectDraft) {
  const gitlabProjectId = toPositiveNumber(draft.gitlabProjectId);
  if (!gitlabProjectId) {
    throw new Error("GitLab 项目 ID 必须是正整数。");
  }

  const name = draft.name.trim();
  if (!name) throw new Error("名称不能为空。");

  const pathWithNamespace = draft.pathWithNamespace.trim();
  if (!pathWithNamespace) throw new Error("命名空间路径不能为空。");

  const repoPath = draft.repoPath.trim();
  if (!repoPath) throw new Error("本地仓库路径不能为空。");

  return {
    gitlabProjectId,
    name,
    pathWithNamespace,
    repoPath,
    defaultBranch: draft.defaultBranch.trim() || "master",
    defaultRemote: draft.defaultRemote.trim() || "origin",
    enabled: draft.enabled,
  };
}

function ManagedProjectForm({
  draft,
  onChange,
  defaults,
  showProjectSearch,
  selectedProject,
  onProjectChange,
  onPickRepoPath,
}: {
  draft: ManagedProjectDraft;
  onChange: (next: ManagedProjectDraft) => void;
  defaults: ManagedProjectOnboardingDefaults;
  showProjectSearch: boolean;
  selectedProject: ProjectSummary | null;
  onProjectChange?: (project: ProjectSummary | null) => void;
  onPickRepoPath: () => Promise<void>;
}) {
  const repoPathId = showProjectSearch ? "create-managed-project-repo-path" : "edit-managed-project-repo-path";

  return (
    <div className="grid gap-4">
      {showProjectSearch && (
        <div className="grid gap-2">
          <Label>GitLab 项目</Label>
          <ProjectCombobox
            value={selectedProject}
            onChange={(project) => {
              onProjectChange?.(project);
              onChange(createManagedProjectDraft(defaults, project));
            }}
            placeholder="搜索 GitLab 项目"
          />
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor={`${repoPathId}-gitlab-project-id`}>GitLab 项目 ID</Label>
        <Input
          id={`${repoPathId}-gitlab-project-id`}
          type="number"
          min={1}
          value={draft.gitlabProjectId}
          onChange={(event) => onChange({ ...draft, gitlabProjectId: event.target.value })}
          placeholder="1234"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${repoPathId}-name`}>名称</Label>
        <Input
          id={`${repoPathId}-name`}
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          placeholder="项目名称"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${repoPathId}-path`}>命名空间路径</Label>
        <Input
          id={`${repoPathId}-path`}
          value={draft.pathWithNamespace}
          onChange={(event) => onChange({ ...draft, pathWithNamespace: event.target.value })}
          placeholder="group/project-name"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${repoPathId}-repo-path`}>本地仓库路径</Label>
        <div className="flex gap-2">
          <Input
            id={`${repoPathId}-repo-path`}
            className="flex-1"
            value={draft.repoPath}
            onChange={(event) => onChange({ ...draft, repoPath: event.target.value })}
            placeholder="D:/repos/project-name"
          />
          <Button type="button" variant="secondary" onClick={() => void onPickRepoPath()}>
            选择目录
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${repoPathId}-default-branch`}>默认分支</Label>
          <Input
            id={`${repoPathId}-default-branch`}
            value={draft.defaultBranch}
            onChange={(event) => onChange({ ...draft, defaultBranch: event.target.value })}
            placeholder="master"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${repoPathId}-default-remote`}>默认远程</Label>
          <Input
            id={`${repoPathId}-default-remote`}
            value={draft.defaultRemote}
            onChange={(event) => onChange({ ...draft, defaultRemote: event.target.value })}
            placeholder="origin"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.enabled}
          onCheckedChange={(value) => onChange({ ...draft, enabled: Boolean(value) })}
        />
        启用
      </label>
    </div>
  );
}

export function ManagedProjectsPage() {
  const [items, setItems] = React.useState<ManagedProject[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [projectDefaults, setProjectDefaults] = React.useState<ManagedProjectOnboardingDefaults>({
    localRepoRoot: "",
    defaultBranch: "master",
    defaultRemote: "origin",
  });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createProject, setCreateProject] = React.useState<ProjectSummary | null>(null);
  const [createDraft, setCreateDraft] = React.useState<ManagedProjectDraft>(() =>
    createManagedProjectDraft(projectDefaults, null)
  );
  const [creating, setCreating] = React.useState(false);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<ManagedProject | null>(null);
  const [editDraft, setEditDraft] = React.useState<ManagedProjectDraft>(() =>
    createManagedProjectDraft(projectDefaults, null)
  );
  const [saving, setSaving] = React.useState(false);

  async function refreshProjects() {
    setLoading(true);
    try {
      setItems(await listManagedProjects());
    } catch (error) {
      toast.error(`加载托管项目失败：${String(error)}`);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function refreshDefaults() {
    try {
      const cfg = await getGitLabConfig();
      const next = normalizeDefaults(cfg);
      setProjectDefaults(next);
      return next;
    } catch {
      const next = {
        localRepoRoot: "",
        defaultBranch: "master",
        defaultRemote: "origin",
      };
      setProjectDefaults(next);
      return next;
    }
  }

  React.useEffect(() => {
    void refreshProjects();
    void refreshDefaults();
  }, []);

  async function handleCreateDirectoryPick() {
    const picked = await open({
      directory: true,
      multiple: false,
      defaultPath: createDraft.repoPath || projectDefaults.localRepoRoot || undefined,
    });

    if (typeof picked === "string") {
      setCreateDraft((prev) => ({ ...prev, repoPath: picked }));
    }
  }

  async function handleEditDirectoryPick() {
    const picked = await open({
      directory: true,
      multiple: false,
      defaultPath: editDraft.repoPath || projectDefaults.localRepoRoot || undefined,
    });

    if (typeof picked === "string") {
      setEditDraft((prev) => ({ ...prev, repoPath: picked }));
    }
  }

  function handleCreateOpenChange(nextOpen: boolean) {
    setCreateOpen(nextOpen);
    if (nextOpen) {
      setCreateProject(null);
      setCreateDraft(createManagedProjectDraft(projectDefaults, null));
      void refreshDefaults().then((next) => {
        setCreateProject(null);
        setCreateDraft(createManagedProjectDraft(next, null));
      });
    }
  }

  async function onCreate() {
    let payload: ReturnType<typeof buildPayload>;
    try {
      payload = buildPayload(createDraft);
    } catch (error) {
      toast.error(String(error));
      return;
    }

    setCreating(true);
    try {
      await createManagedProject(payload);
      setCreateOpen(false);
      setCreateProject(null);
      setCreateDraft(createManagedProjectDraft(projectDefaults, null));
      await refreshProjects();
      toast.success("托管项目已创建。");
    } catch (error) {
      toast.error(`创建失败：${String(error)}`);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(item: ManagedProject) {
    setEditingItem(item);
    setEditDraft(toDraft(item));
    setEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editingItem) return;

    let payload: ReturnType<typeof buildPayload>;
    try {
      payload = buildPayload(editDraft);
    } catch (error) {
      toast.error(String(error));
      return;
    }

    setSaving(true);
    try {
      await updateManagedProject({
        id: editingItem.id,
        ...payload,
      });
      setEditOpen(false);
      setEditingItem(null);
      await refreshProjects();
      toast.success("托管项目已更新。");
    } catch (error) {
      toast.error(`更新失败：${String(error)}`);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(item: ManagedProject) {
    if (!confirm(`确定删除托管项目「${item.name}」吗？`)) return;

    try {
      await deleteManagedProject(item.id);
      await refreshProjects();
      toast.success("托管项目已删除。");
    } catch (error) {
      toast.error(`删除失败：${String(error)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">托管项目</h2>
            <p className="text-sm text-muted-foreground">
              绑定 GitLab 项目和本地仓库路径，用于后续分组批量操作和 git 工作流。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void refreshProjects()} disabled={loading}>
              刷新
            </Button>
            <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
              <DialogTrigger asChild>
                <Button>新建托管项目</Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>新建托管项目</DialogTitle>
                  <DialogDescription>
                    先搜索 GitLab 项目，再回填项目名、命名空间路径、本地仓库路径和默认 git 配置。
                  </DialogDescription>
                </DialogHeader>
                <ManagedProjectForm
                  draft={createDraft}
                  onChange={setCreateDraft}
                  defaults={projectDefaults}
                  showProjectSearch
                  selectedProject={createProject}
                  onProjectChange={setCreateProject}
                  onPickRepoPath={handleCreateDirectoryPick}
                />
                <DialogFooter>
                  <Button variant="secondary" type="button" onClick={() => setCreateDraft(createManagedProjectDraft(projectDefaults, null))}>
                    重置
                  </Button>
                  <Button type="button" onClick={() => void onCreate()} disabled={creating}>
                    创建
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </PanelHeader>
        <PanelBody>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>GitLab ID</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>命名空间路径</TableHead>
                <TableHead>本地仓库路径</TableHead>
                <TableHead>默认值</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono">{item.id}</TableCell>
                  <TableCell className="font-mono">{item.gitlabProjectId}</TableCell>
                  <TableCell>{item.name}</TableCell>
                  <TableCell className="font-mono text-xs">{item.pathWithNamespace}</TableCell>
                  <TableCell className="font-mono text-xs">{item.repoPath}</TableCell>
                  <TableCell className="text-xs">
                    {item.defaultBranch} / {item.defaultRemote} / {item.enabled ? "启用" : "禁用"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{formatDateTime(item.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(item)}>
                        编辑
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void onDelete(item)}>
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    {loading ? "加载中..." : "暂无托管项目。"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>编辑托管项目</DialogTitle>
            <DialogDescription>更新项目绑定信息、路径和默认 git 配置。</DialogDescription>
          </DialogHeader>
          <ManagedProjectForm
            draft={editDraft}
            onChange={setEditDraft}
            defaults={projectDefaults}
            showProjectSearch={false}
            selectedProject={null}
            onPickRepoPath={handleEditDirectoryPick}
          />
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={() => setEditOpen(false)}>
              取消
            </Button>
            <Button type="button" onClick={() => void onSaveEdit()} disabled={saving}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
