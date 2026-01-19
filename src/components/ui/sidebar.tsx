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
        "relative flex flex-col border-r border-border bg-background transition-all duration-300 ease-in-out",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo / Brand */}
      <div className="flex h-16 items-center border-b border-border px-4">
        {!collapsed && (
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground">
              <span className="text-sm font-bold text-background">GL</span>
            </div>
            <span className="text-sm font-semibold tracking-tight">
              成员管理
            </span>
          </div>
        )}
        {collapsed && (
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-foreground">
            <span className="text-sm font-bold text-background">GL</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onTabChange(item.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeTab === item.id
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <span className="flex-shrink-0">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Collapse Toggle */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="flex w-full items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronLeft className="h-5 w-5" />
          )}
        </button>
      </div>
    </aside>
  );
}
