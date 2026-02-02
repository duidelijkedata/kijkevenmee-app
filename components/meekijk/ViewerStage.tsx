"use client";

import * as React from "react";

export default function ViewerStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 bg-black">
      {/* Center + contain behavior */}
      <div className="absolute inset-0 flex items-center justify-center">
        {/* Alles binnenin moet w-full/h-full kunnen gebruiken */}
        <div className="relative w-full h-full">
          {children}
        </div>
      </div>
    </div>
  );
}
