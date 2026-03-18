import * as React from "react";
import { toast } from "sonner";

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
  listManagedProjects,
  updateManagedProject,
} from "@/lib/invoke";
import type { ManagedProject } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type ProjectDraft = {
  gitlabProjectId: string;
  name: string;
  pathWithNamespace: string;
  repoPath: string;
  defaultBranch: string;
  defaultRemote: string;
  enabled: boolean;
};

const EMPTY_DRAFT: ProjectDraft = {
  gitlabProjectId: "",
  name: "",
  pathWithNamespace: "",
  repoPath: "",
  defaultBranch: "",
  defaultRemote: "",
  enabled: true,
};

function toPositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function ProjectDraftForm({
  draft,
  onChange,
}: {
  draft: ProjectDraft;
  onChange: (next: ProjectDraft) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Label>GitLab Project ID</Label>
        <Input
          type="number"
          min={1}
          value={draft.gitlabProjectId}
          onChange={(e) => onChange({ ...draft, gitlabProjectId: e.target.value })}
          placeholder="e.g. 12345"
        />
      </div>
      <div className="grid gap-1">
        <Label>Name</Label>
        <Input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="project name"
        />
      </div>
      <div className="grid gap-1">
        <Label>Path With Namespace</Label>
        <Input
          value={draft.pathWithNamespace}
          onChange={(e) => onChange({ ...draft, pathWithNamespace: e.target.value })}
          placeholder="group/project-name"
        />
      </div>
      <div className="grid gap-1">
        <Label>Local Repo Path</Label>
        <Input
          value={draft.repoPath}
          onChange={(e) => onChange({ ...draft, repoPath: e.target.value })}
          placeholder="D:/repos/project-name"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <Label>Default Branch</Label>
          <Input
            value={draft.defaultBranch}
            onChange={(e) => onChange({ ...draft, defaultBranch: e.target.value })}
            placeholder="main"
          />
        </div>
        <div className="grid gap-1">
          <Label>Default Remote</Label>
          <Input
            value={draft.defaultRemote}
            onChange={(e) => onChange({ ...draft, defaultRemote: e.target.value })}
            placeholder="origin"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={draft.enabled}
          onCheckedChange={(v) => onChange({ ...draft, enabled: Boolean(v) })}
        />
        Enabled
      </label>
    </div>
  );
}

export function ManagedProjectsPage() {
  const [items, setItems] = React.useState<ManagedProject[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createDraft, setCreateDraft] = React.useState<ProjectDraft>(EMPTY_DRAFT);

  const [editOpen, setEditOpen] = React.useState(false);
  const [editingItem, setEditingItem] = React.useState<ManagedProject | null>(null);
  const [editDraft, setEditDraft] = React.useState<ProjectDraft>(EMPTY_DRAFT);

  async function refresh() {
    setLoading(true);
    try {
      setItems(await listManagedProjects());
    } catch (error) {
      toast.error(`Load managed projects failed: ${String(error)}`);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refresh();
  }, []);

  async function onCreate() {
    const gitlabProjectId = toPositiveNumber(createDraft.gitlabProjectId);
    if (!gitlabProjectId) {
      toast.error("GitLab Project ID must be a positive integer.");
      return;
    }

    try {
      await createManagedProject({
        gitlabProjectId,
        name: createDraft.name,
        pathWithNamespace: createDraft.pathWithNamespace,
        repoPath: createDraft.repoPath,
        defaultBranch: createDraft.defaultBranch || null,
        defaultRemote: createDraft.defaultRemote || null,
        enabled: createDraft.enabled,
      });
      setCreateDraft(EMPTY_DRAFT);
      setCreateOpen(false);
      await refresh();
      toast.success("Managed project created.");
    } catch (error) {
      toast.error(`Create failed: ${String(error)}`);
    }
  }

  function startEdit(item: ManagedProject) {
    setEditingItem(item);
    setEditDraft({
      gitlabProjectId: String(item.gitlabProjectId),
      name: item.name,
      pathWithNamespace: item.pathWithNamespace,
      repoPath: item.repoPath,
      defaultBranch: item.defaultBranch,
      defaultRemote: item.defaultRemote,
      enabled: item.enabled,
    });
    setEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editingItem) return;

    const gitlabProjectId = toPositiveNumber(editDraft.gitlabProjectId);
    if (!gitlabProjectId) {
      toast.error("GitLab Project ID must be a positive integer.");
      return;
    }

    try {
      await updateManagedProject({
        id: editingItem.id,
        gitlabProjectId,
        name: editDraft.name,
        pathWithNamespace: editDraft.pathWithNamespace,
        repoPath: editDraft.repoPath,
        defaultBranch: editDraft.defaultBranch.trim() || "main",
        defaultRemote: editDraft.defaultRemote.trim() || "origin",
        enabled: editDraft.enabled,
      });
      setEditOpen(false);
      setEditingItem(null);
      await refresh();
      toast.success("Managed project updated.");
    } catch (error) {
      toast.error(`Update failed: ${String(error)}`);
    }
  }

  async function onDelete(item: ManagedProject) {
    if (!confirm(`Delete managed project "${item.name}"?`)) return;
    try {
      await deleteManagedProject(item.id);
      await refresh();
      toast.success("Managed project deleted.");
    } catch (error) {
      toast.error(`Delete failed: ${String(error)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Managed Projects</h2>
            <p className="text-sm text-muted-foreground">
              Register GitLab projects with local repository paths for group operations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>New Managed Project</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Managed Project</DialogTitle>
                  <DialogDescription>
                    Bind a GitLab project to a local repository path.
                  </DialogDescription>
                </DialogHeader>
                <ProjectDraftForm draft={createDraft} onChange={setCreateDraft} />
                <DialogFooter>
                  <Button variant="secondary" onClick={() => setCreateDraft(EMPTY_DRAFT)}>
                    Clear
                  </Button>
                  <Button onClick={() => void onCreate()}>Create</Button>
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
                <TableHead>Name</TableHead>
                <TableHead>Namespace Path</TableHead>
                <TableHead>Repo Path</TableHead>
                <TableHead>Defaults</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
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
                    {item.defaultBranch} / {item.defaultRemote} / {item.enabled ? "enabled" : "disabled"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{formatDateTime(item.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => startEdit(item)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void onDelete(item)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    {loading ? "Loading..." : "No managed projects yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
      </Panel>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Managed Project</DialogTitle>
            <DialogDescription>Update project binding and defaults.</DialogDescription>
          </DialogHeader>
          <ProjectDraftForm draft={editDraft} onChange={setEditDraft} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onSaveEdit()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
