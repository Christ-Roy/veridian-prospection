"use client";

import { Button } from "@/components/ui/button";

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

interface DtmfKeypadProps {
  onDigit: (digit: string) => void;
}

export function DtmfKeypad({ onDigit }: DtmfKeypadProps) {
  return (
    <div className="grid grid-cols-3 gap-1.5 px-3 pb-3">
      {KEYS.flat().map((key) => (
        <Button
          key={key}
          variant="outline"
          size="sm"
          className="h-9 text-sm font-mono font-semibold"
          onClick={() => onDigit(key)}
        >
          {key}
        </Button>
      ))}
    </div>
  );
}
