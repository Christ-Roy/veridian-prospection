"use client";

import { useState } from "react";

interface PreviewBadgeProps {
  children: React.ReactNode;
}

export function PreviewBadge({ children }: PreviewBadgeProps) {
  const [show, setShow] = useState(false);

  return (
    <div
      className="relative inline-flex"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShow(true); setTimeout(() => setShow(false), 2000); }}
    >
      <div className="opacity-50 pointer-events-none">{children}</div>
      {show && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-gray-900 text-white text-[10px] whitespace-nowrap z-50 animate-in fade-in slide-in-from-bottom-1 duration-200">
          Prochainement...
        </div>
      )}
    </div>
  );
}
