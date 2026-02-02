"use client";

import * as React from "react";

type Props = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  sidebarTitle?: string;
};

export default function FullscreenShell({ sidebar, children, sidebarTitle }: Props) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    // ✅ Fix: altijd aan viewport, ongeacht parent layout (items-center etc.)
    <div className="fixed inset-0 z-[50] overflow-hidden bg-black">
      <div className="h-full w-full flex">
        {/* Sidebar */}
        <aside
          className={[
            "h-full shrink-0 border-r border-white/10 bg-slate-950 text-white",
            "transition-[width] duration-200 ease-out",
            collapsed ? "w-[72px]" : "w-[280px]",
          ].join(" ")}
        >
          <div className="h-14 flex items-center justify-between px-3 border-b border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-white/60" />
              </div>
              {!collapsed && (
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{sidebarTitle ?? "Meekijken"}</div>
                  <div className="text-xs text-white/60 truncate">Controls</div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="h-9 w-9 rounded-lg hover:bg-white/10 active:bg-white/15 flex items-center justify-center"
              aria-label={collapsed ? "Open menu" : "Sluit menu"}
              title={collapsed ? "Open menu" : "Sluit menu"}
            >
              <span className="text-white/70">{collapsed ? "›" : "‹"}</span>
            </button>
          </div>

          <div className="h-[calc(100%-3.5rem)] overflow-y-auto">
            <div className={collapsed ? "p-2" : "p-3"}>{sidebar}</div>
          </div>
        </aside>

        {/* Main */}
        <main className="relative flex-1 min-w-0 bg-black">
          <div className="absolute inset-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
