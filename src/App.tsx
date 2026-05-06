import * as React from "react";
import { Toaster } from "sonner";

import { Sidebar } from "@/components/ui/sidebar";
import { CommandBar, CommandBarSection, CommandBarTitle } from "@/components/ui/command-bar";
import { SettingsPage } from "@/pages/SettingsPage";
import { WorkflowRunsPage as WorkflowRunsPageView } from "@/pages/WorkflowRunsPage";

type WorkflowRunFocusTarget = {
  runId: number;
  nonce: number;
};

function lazyPage<TProps>(loader: () => Promise<{ default: React.ComponentType<TProps> }>) {
  return React.lazy(loader);
}

const loadProjectsPage = () =>
  import("@/pages/ProjectsPage").then((module) => ({ default: module.ProjectsPage }));
const loadMembersPage = () =>
  import("@/pages/MembersPage").then((module) => ({ default: module.MembersPage }));
const loadLocalMembersPage = () =>
  import("@/pages/LocalMembersPage").then((module) => ({ default: module.LocalMembersPage }));
const loadGroupsPage = () =>
  import("@/pages/GroupsPage").then((module) => ({ default: module.GroupsPage }));
const loadManagedProjectsPage = () =>
  import("@/pages/ManagedProjectsPage").then((module) => ({ default: module.ManagedProjectsPage }));
const loadProjectGroupsPage = () =>
  import("@/pages/ProjectGroupsPage").then((module) => ({ default: module.ProjectGroupsPage }));
const loadWorkflowsPage = () =>
  import("@/pages/WorkflowsPage").then((module) => ({ default: module.WorkflowsPage }));
const ProjectsPage = lazyPage(loadProjectsPage);
const MembersPage = lazyPage(loadMembersPage);
const LocalMembersPage = lazyPage(loadLocalMembersPage);
const GroupsPage = lazyPage(loadGroupsPage);
const ManagedProjectsPage = lazyPage(loadManagedProjectsPage);
const ProjectGroupsPage = lazyPage(loadProjectGroupsPage);
const WorkflowsPage = lazyPage(loadWorkflowsPage);

const pageTitles: Record<string, string> = {
  settings: "配置",
  projects: "项目搜索",
  members: "项目成员",
  managedProjects: "托管项目",
  projectGroups: "项目分组",
  workflows: "工作流定义",
  workflowRuns: "工作流运行",
  local: "本地成员",
  groups: "本地分组",
};

export default function App() {
  const [activeTab, setActiveTab] = React.useState("settings");
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [workflowRunFocusTarget, setWorkflowRunFocusTarget] =
    React.useState<WorkflowRunFocusTarget | null>(null);

  const handlePipelineRunStarted = React.useCallback((runId: number) => {
    setWorkflowRunFocusTarget((current) => ({
      runId,
      nonce: (current?.nonce ?? 0) + 1,
    }));
    setActiveTab("workflowRuns");
  }, []);

  const handleWorkflowRunFocusHandled = React.useCallback(() => {
    setWorkflowRunFocusTarget(null);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_hsl(0_0%_100%)_0%,_hsl(0_0%_96%)_45%,_hsl(0_0%_94%)_100%)] text-foreground dark:bg-[radial-gradient(circle_at_top,_hsl(0_0%_12%)_0%,_hsl(0_0%_8%)_55%,_hsl(0_0%_6%)_100%)]">
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />

      <main className="flex flex-1 flex-col overflow-hidden">
        <CommandBar className="h-[var(--command-bar-height)]">
          <CommandBarSection className="min-w-[200px]">
            <div className="flex flex-col">
              <CommandBarTitle className="text-[11px] text-muted-foreground">
                当前页面
              </CommandBarTitle>
              <span className="text-lg font-semibold tracking-tight">
                {pageTitles[activeTab]}
              </span>
            </div>
          </CommandBarSection>
        </CommandBar>

        <div className="flex-1 overflow-auto px-8 py-6">
          <React.Suspense
            fallback={
              <div className="animate-fade-up rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
                页面加载中...
              </div>
            }
          >
            <div className="animate-fade-up">
              {activeTab === "settings" && <SettingsPage />}
              {activeTab === "projects" && <ProjectsPage />}
              {activeTab === "members" && <MembersPage />}
              {activeTab === "managedProjects" && <ManagedProjectsPage />}
              {activeTab === "projectGroups" && <ProjectGroupsPage />}
              {activeTab === "workflows" && (
                <WorkflowsPage onRunStarted={handlePipelineRunStarted} />
              )}
              {activeTab === "workflowRuns" && (
                <WorkflowRunsPageView
                  focusTarget={workflowRunFocusTarget}
                  onFocusHandled={handleWorkflowRunFocusHandled}
                />
              )}
              {activeTab === "local" && <LocalMembersPage />}
              {activeTab === "groups" && <GroupsPage />}
            </div>
          </React.Suspense>
        </div>
      </main>

      <Toaster richColors position="bottom-right" />
    </div>
  );
}
