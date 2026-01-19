import * as React from "react";
import { Toaster } from "sonner";

import { Sidebar } from "@/components/ui/sidebar";
import { SettingsPage } from "@/pages/SettingsPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { MembersPage } from "@/pages/MembersPage";
import { LocalMembersPage } from "@/pages/LocalMembersPage";
import { GroupsPage } from "@/pages/GroupsPage";
import type { ProjectSummary } from "@/lib/types";

const pageTitles: Record<string, string> = {
  settings: "配置",
  projects: "项目搜索",
  members: "项目成员",
  local: "本地成员",
  groups: "本地分组",
};

export default function App() {
  const [pickedProject, setPickedProject] =
    React.useState<ProjectSummary | null>(null);
  const [activeTab, setActiveTab] = React.useState("settings");
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />

      {/* Main Content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-border px-8">
          <h1 className="text-xl font-semibold tracking-tight">
            {pageTitles[activeTab]}
          </h1>
          {pickedProject && (
            <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2">
              <span className="text-xs text-muted-foreground">当前项目</span>
              <span className="text-sm font-medium">
                {pickedProject.pathWithNamespace}
              </span>
              <span className="rounded bg-foreground px-1.5 py-0.5 text-xs text-background">
                #{pickedProject.id}
              </span>
            </div>
          )}
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-8">
          {activeTab === "settings" && <SettingsPage />}
          {activeTab === "projects" && (
            <ProjectsPage onPickProject={setPickedProject} />
          )}
          {activeTab === "members" && <MembersPage />}
          {activeTab === "local" && <LocalMembersPage />}
          {activeTab === "groups" && <GroupsPage />}
        </div>
      </main>

      <Toaster richColors position="bottom-right" />
    </div>
  );
}
