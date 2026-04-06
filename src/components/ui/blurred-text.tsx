"use client";

import { useTrial } from "@/lib/trial-context";

interface BlurredTextProps {
  children: string | null | undefined;
  className?: string;
  /** Fraction of text shown in clear (0-1). Default 0.33 */
  visibleRatio?: number;
}

export function BlurredText({ children, className = "", visibleRatio = 0.33 }: BlurredTextProps) {
  const { isExpired } = useTrial();
  const text = children || "";

  if (!isExpired || !text) {
    return <span className={className}>{text}</span>;
  }

  const cutoff = Math.max(1, Math.floor(text.length * visibleRatio));
  const visible = text.slice(0, cutoff);
  const hidden = text.slice(cutoff);

  return (
    <span className={className}>
      {visible}<span className="select-none blur-[4px]">{hidden}</span>
    </span>
  );
}
