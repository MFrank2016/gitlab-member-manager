import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Settings,
  Search,
  Users,
  UserCircle,
  FolderOpen,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { id: "settings", label: "配置", icon: <Settings className="h-5 w-5" /> },
  { id: "projects", label: "项目搜索", icon: <Search className="h-5 w-5" /> },
  { id: "members", label: "项目成员", icon: <Users className="h-5 w-5" /> },
  { id: "local", label: "本地成员", icon: <UserCircle className="h-5 w-5" /> },
  { id: "groups", label: "本地分组", icon: <FolderOpen className="h-5 w-5" /> },
];

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

export function Sidebar({
  activeTab,
  onTabChange,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "relative flex flex-col border-r border-border bg-background/95 backdrop-blur transition-sidebar",
        collapsed
          ? "w-[var(--sidebar-width-collapsed)]"
          : "w-[var(--sidebar-width)]"
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-border px-4">
        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}> 
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-foreground text-background shadow-sm">
            <span className="text-sm font-semibold">GL</span>
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold tracking-tight">成员管理</div>
              <div className="text-xs text-muted-foreground">GitLab Workspace</div>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              title={item.label}
              data-active={isActive}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                "before:absolute before:left-0 before:top-1/2 before:h-6 before:w-1 before:-translate-y-1/2 before:rounded-r before:bg-[color:var(--brand)] before:opacity-0 before:transition-opacity",
                isActive
                  ? "bg-foreground text-background before:opacity-100"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                collapsed && "justify-center px-2"
              )}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronLeft className="h-5 w-5" />
          )}
          {!collapsed && <span className="text-xs font-medium">收起</span>}
        </button>
      </div>
    </aside>
  );
}