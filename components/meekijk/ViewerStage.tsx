"use client";

import * as React from "react";

export default function ViewerStage({ children }: { children: React.ReactNode }) {
  return (
    // ✅ overflow-hidden is de kernfix
    <div className="absolute inset-0 bg-black overflow-hidden">
      {/* Center + contain behavior */}
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className="relative w-full h-full overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
