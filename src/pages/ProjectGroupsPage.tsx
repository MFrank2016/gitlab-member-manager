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
  addProjectsToGroup,
  createProjectGroup,
  deleteProjectGroup,
  listManagedProjects,
  listProjectGroupProjects,
  listProjectGroups,
  removeProjectsFromGroup,
  updateProjectGroup,
} from "@/lib/invoke";
import type { ManagedProject, ProjectGroup } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export function ProjectGroupsPage() {
  const [groups, setGroups] = React.useState<ProjectGroup[]>([]);
  const [managedProjects, setManagedProjects] = React.useState<ManagedProject[]>([]);
  const [groupProjects, setGroupProjects] = React.useState<ManagedProject[]>([]);
  const [activeGroupId, setActiveGroupId] = React.useState<number | null>(null);
  const [selectedManagedIds, setSelectedManagedIds] = React.useState<Set<number>>(new Set());
  const [loading, setLoading] = React.useState(false);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [newGroupName, setNewGroupName] = React.useState("");

  const [editOpen, setEditOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState<ProjectGroup | null>(null);
  const [editGroupName, setEditGroupName] = React.useState("");

  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;
  const groupProjectIds = new Set(groupProjects.map((project) => project.id));

  async function refreshGroups(preferredGroupId?: number | null) {
    const result = await listProjectGroups();
    const preferred = preferredGroupId ?? activeGroupId;
    const nextActiveGroupId =
      preferred && result.some((group) => group.id === preferred)
        ? preferred
        : (result[0]?.id ?? null);

    setGroups(result);
    setActiveGroupId(nextActiveGroupId);
    return nextActiveGroupId;
  }

  async function refreshManagedProjects() {
    setManagedProjects(await listManagedProjects());
  }

  async function refreshGroupProjects(groupId: number | null) {
    if (!groupId) {
      setGroupProjects([]);
      return;
    }
    setGroupProjects(await listProjectGroupProjects(groupId));
  }

  async function refreshAll() {
    setLoading(true);
    try {
      const nextActiveGroupId = await refreshGroups(activeGroupId);
      await Promise.all([
        refreshManagedProjects(),
        refreshGroupProjects(nextActiveGroupId),
      ]);
    } catch (error) {
      toast.error(`Load project groups failed: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refreshAll();
  }, []);

  React.useEffect(() => {
    void refreshGroupProjects(activeGroupId);
    setSelectedManagedIds(new Set());
  }, [activeGroupId]);

  async function onCreateGroup() {
    if (!newGroupName.trim()) {
      toast.error("Group name cannot be empty.");
      return;
    }
    try {
      const created = await createProjectGroup(newGroupName.trim());
      setCreateOpen(false);
      setNewGroupName("");
      await refreshGroups();
      setActiveGroupId(created.id);
      toast.success("Project group created.");
    } catch (error) {
      toast.error(`Create group failed: ${String(error)}`);
    }
  }

  function openEditGroup(group: ProjectGroup) {
    setEditingGroup(group);
    setEditGroupName(group.name);
    setEditOpen(true);
  }

  async function onSaveEditGroup() {
    if (!editingGroup) return;
    if (!editGroupName.trim()) {
      toast.error("Group name cannot be empty.");
      return;
    }

    try {
      await updateProjectGroup(editingGroup.id, editGroupName.trim());
      setEditOpen(false);
      setEditingGroup(null);
      await refreshGroups();
      toast.success("Project group updated.");
    } catch (error) {
      toast.error(`Update group failed: ${String(error)}`);
    }
  }

  async function onDeleteGroup(group: ProjectGroup) {
    if (!confirm(`Delete project group "${group.name}"?`)) return;
    try {
      await deleteProjectGroup(group.id);
      await refreshGroups();
      toast.success("Project group deleted.");
    } catch (error) {
      toast.error(`Delete group failed: ${String(error)}`);
    }
  }

  function toggleSelectManaged(id: number, checked: boolean) {
    setSelectedManagedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function addSelectedProjects() {
    if (!activeGroupId) {
      toast.error("Select a project group first.");
      return;
    }
    const idsToAdd = Array.from(selectedManagedIds).filter((id) => !groupProjectIds.has(id));
    if (idsToAdd.length === 0) {
      toast.error("No projects selected to add.");
      return;
    }

    try {
      await addProjectsToGroup(activeGroupId, idsToAdd);
      setSelectedManagedIds(new Set());
      await Promise.all([refreshGroups(), refreshGroupProjects(activeGroupId)]);
      toast.success(`Added ${idsToAdd.length} project(s) to group.`);
    } catch (error) {
      toast.error(`Add projects failed: ${String(error)}`);
    }
  }

  async function removeProjectFromActiveGroup(projectId: number) {
    if (!activeGroupId) return;
    try {
      await removeProjectsFromGroup(activeGroupId, [projectId]);
      await Promise.all([refreshGroups(), refreshGroupProjects(activeGroupId)]);
      toast.success("Project removed from group.");
    } catch (error) {
      toast.error(`Remove project failed: ${String(error)}`);
    }
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Project Groups</h2>
            <p className="text-sm text-muted-foreground">
              Organize managed projects into local groups for batch operations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void refreshAll()} disabled={loading}>
              Refresh
            </Button>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>New Group</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Project Group</DialogTitle>
                  <DialogDescription>Use local project groups to drive batch actions.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="e.g. release-train"
                    autoFocus
                  />
                </div>
                <DialogFooter>
                  <Button variant="secondary" onClick={() => setNewGroupName("")}>
                    Clear
                  </Button>
                  <Button onClick={() => void onCreateGroup()}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </PanelHeader>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel className="xl:col-span-2">
          <PanelHeader>
            <h3 className="font-semibold">Groups</h3>
          </PanelHeader>
          <PanelBody>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Projects</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow
                    key={group.id}
                    className={activeGroupId === group.id ? "bg-muted/50" : ""}
                    onClick={() => setActiveGroupId(group.id)}
                  >
                    <TableCell className="font-mono">{group.id}</TableCell>
                    <TableCell>{group.name}</TableCell>
                    <TableCell>{group.projectsCount}</TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => openEditGroup(group)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => void onDeleteGroup(group)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {groups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No project groups yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </PanelBody>
        </Panel>

        <div className="space-y-4 xl:col-span-3">
          <Panel>
            <PanelHeader>
              <div className="space-y-1">
                <h3 className="font-semibold">
                  Group Projects {activeGroup ? `- ${activeGroup.name}` : ""}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {activeGroup ? `Updated ${formatDateTime(activeGroup.updatedAt)}` : "Select a group to view projects."}
                </p>
              </div>
            </PanelHeader>
            <PanelBody>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>GitLab ID</TableHead>
                    <TableHead>Path With Namespace</TableHead>
                    <TableHead>Repository Path</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupProjects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell className="font-mono">{project.gitlabProjectId}</TableCell>
                      <TableCell className="font-mono text-xs">{project.pathWithNamespace}</TableCell>
                      <TableCell className="font-mono text-xs">{project.repoPath}</TableCell>
                      <TableCell>{project.enabled ? "Enabled" : "Disabled"}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => void removeProjectFromActiveGroup(project.id)}
                        >
                          Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {groupProjects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        {activeGroup ? "This group has no projects yet." : "No group selected."}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader className="flex-wrap gap-2">
              <h3 className="font-semibold">Add Managed Projects</h3>
              <Button
                size="sm"
                onClick={() => void addSelectedProjects()}
                disabled={!activeGroup || selectedManagedIds.size === 0}
              >
                Add Selected ({selectedManagedIds.size})
              </Button>
            </PanelHeader>
            <PanelBody>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Select</TableHead>
                    <TableHead>GitLab ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Path</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managedProjects.map((project) => {
                    const alreadyInGroup = groupProjectIds.has(project.id);
                    return (
                      <TableRow key={project.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedManagedIds.has(project.id)}
                            disabled={alreadyInGroup || !activeGroup}
                            onCheckedChange={(value) => toggleSelectManaged(project.id, Boolean(value))}
                          />
                        </TableCell>
                        <TableCell className="font-mono">{project.gitlabProjectId}</TableCell>
                        <TableCell>
                          {project.name}
                          {alreadyInGroup && (
                            <span className="ml-2 text-xs text-muted-foreground">(already added)</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{project.pathWithNamespace}</TableCell>
                      </TableRow>
                    );
                  })}
                  {managedProjects.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No managed projects found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </PanelBody>
          </Panel>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Project Group</DialogTitle>
            <DialogDescription>Update the local project group name.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input
              value={editGroupName}
              onChange={(e) => setEditGroupName(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onSaveEditGroup()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
