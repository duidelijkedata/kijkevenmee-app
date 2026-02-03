"use client";

import * as React from "react";

type Props = {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  sidebarTitle?: string;
  sidebarSubtitle?: string;
  sidebarWidth?: number; // default 320
};

export default function FullscreenShell({
  sidebar,
  children,
  sidebarTitle = "Meekijken",
  sidebarSubtitle = "Controls",
  sidebarWidth = 320,
}: Props) {
  return (
    // ✅ fixed aan viewport
    <div className="fixed inset-0 z-[50] overflow-hidden bg-black">
      <div className="h-full w-full flex">
        {/* ✅ Sidebar: fixed width, altijd zichtbaar */}
        <aside
          className="h-full shrink-0 border-r border-white/10 bg-slate-950 text-white"
          style={{ width: sidebarWidth }}
        >
          <div className="h-14 flex items-center px-3 border-b border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-white/60" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{sidebarTitle}</div>
                <div className="text-xs text-white/60 truncate">{sidebarSubtitle}</div>
              </div>
            </div>
          </div>

          <div className="h-[calc(100%-3.5rem)] overflow-y-auto">
            <div className="p-3">{sidebar}</div>
          </div>
        </aside>

        {/* ✅ Main: overflow-hidden => pannen kan nooit over sidebar heen */}
        <main className="relative flex-1 min-w-0 bg-black overflow-hidden">
          <div className="absolute inset-0">{children}</div>
        </main>
      </div>
    </div>
  );
}
