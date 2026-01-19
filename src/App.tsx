import * as React from "react";
import { Toaster } from "sonner";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsPage } from "@/pages/SettingsPage";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { MembersPage } from "@/pages/MembersPage";
import { LocalMembersPage } from "@/pages/LocalMembersPage";
import { GroupsPage } from "@/pages/GroupsPage";
import type { ProjectSummary } from "@/lib/types";

export default function App() {
  const [pickedProject, setPickedProject] = React.useState<ProjectSummary | null>(null);

  return (
    <div className="min-h-screen p-6">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">GitLab 项目成员管理工具</h1>
          <p className="text-sm text-muted-foreground">Tauri 2 + React 18 + Tailwind v4 + SQLite（本地）</p>
        </div>
        {pickedProject && (
          <div className="text-right">
            <div className="text-xs text-muted-foreground">当前项目</div>
            <div className="text-sm font-medium">{pickedProject.pathWithNamespace} (#{pickedProject.id})</div>
          </div>
        )}
      </div>

      <Tabs defaultValue="settings">
        <TabsList className="mb-4">
          <TabsTrigger value="settings">配置</TabsTrigger>
          <TabsTrigger value="projects">项目搜索</TabsTrigger>
          <TabsTrigger value="members">项目成员</TabsTrigger>
          <TabsTrigger value="local">本地成员</TabsTrigger>
          <TabsTrigger value="groups">本地分组</TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          <SettingsPage />
        </TabsContent>
        <TabsContent value="projects">
          <ProjectsPage onPickProject={setPickedProject} />
        </TabsContent>
        <TabsContent value="members">
          <MembersPage />
        </TabsContent>
        <TabsContent value="local">
          <LocalMembersPage />
        </TabsContent>
        <TabsContent value="groups">
          <GroupsPage />
        </TabsContent>
      </Tabs>

      <Toaster richColors position="bottom-right" />
    </div>
  );
}
