import * as React from "react";
import { Toaster } from "sonner";

import { Sidebar } from "@/components/ui/sidebar";
import { CommandBar, CommandBarSection, CommandBarTitle } from "@/components/ui/command-bar";
import { SettingsPage } from "@/pages/SettingsPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { MembersPage } from "@/pages/MembersPage";
import { LocalMembersPage } from "@/pages/LocalMembersPage";
import { GroupsPage } from "@/pages/GroupsPage";
import { ManagedProjectsPage } from "@/pages/ManagedProjectsPage";
import { ProjectGroupsPage } from "@/pages/ProjectGroupsPage";
import { WorkflowsPage } from "@/pages/WorkflowsPage";
import { WorkflowRunsPage } from "@/pages/WorkflowRunsPage";

type WorkflowRunFocusTarget = {
  runId: number;
  nonce: number;
};

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
              <WorkflowRunsPage
                focusTarget={workflowRunFocusTarget}
                onFocusHandled={handleWorkflowRunFocusHandled}
              />
            )}
            {activeTab === "local" && <LocalMembersPage />}
            {activeTab === "groups" && <GroupsPage />}
          </div>
        </div>
      </main>

      <Toaster richColors position="bottom-right" />
    </div>
  );
}
