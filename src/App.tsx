import * as React from "react";
import { Toaster } from "sonner";

import { Sidebar } from "@/components/ui/sidebar";
import { CommandBar, CommandBarSection, CommandBarTitle } from "@/components/ui/command-bar";
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

          <CommandBarSection className="flex-1 justify-center">
            {pickedProject ? (
              <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">当前项目</span>
                <span className="font-medium">
                  {pickedProject.pathWithNamespace}
                </span>
                <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] text-background">
                  #{pickedProject.id}
                </span>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">未选择项目</div>
            )}
          </CommandBarSection>

          <CommandBarSection className="justify-end">
            <div className="hidden items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1 text-xs text-muted-foreground md:flex">
              <span className="h-2 w-2 rounded-full bg-[color:var(--brand)]" />
              工作区已就绪
            </div>
          </CommandBarSection>
        </CommandBar>

        <div className="flex-1 overflow-auto px-8 py-6">
          <div className="animate-fade-up">
            {activeTab === "settings" && <SettingsPage />}
            {activeTab === "projects" && (
              <ProjectsPage onPickProject={setPickedProject} />
            )}
            {activeTab === "members" && <MembersPage />}
            {activeTab === "local" && <LocalMembersPage />}
            {activeTab === "groups" && <GroupsPage />}
          </div>
        </div>
      </main>

      <Toaster richColors position="bottom-right" />
    </div>
  );
}