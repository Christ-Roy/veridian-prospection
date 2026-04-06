"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEPARTMENT_PATHS, DEPARTMENT_NAMES } from "./france-map-data";
import { REGION_SHORTCUTS } from "@/lib/departments";

interface FranceMapProps {
  selected: string[];
  onSelect: (depts: string[]) => void;
  counts: Record<string, number>;
}

interface Tooltip {
  x: number;
  y: number;
  code: string;
  name: string;
  count: number;
}

const SVG_WIDTH = 800;
const SVG_HEIGHT = 850;

function getHeatColor(count: number, maxCount: number): string {
  if (!count || maxCount === 0) return "#e2e8f0"; // slate-200
  const ratio = Math.min(count / maxCount, 1);
  // White -> Blue gradient (interpolate lightness)
  const l = Math.round(95 - ratio * 55); // 95% -> 40%
  const s = Math.round(30 + ratio * 60); // 30% -> 90%
  return `hsl(217, ${s}%, ${l}%)`;
}

export function FranceMap({ selected, onSelect, counts }: FranceMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  const maxCount = useMemo(() => {
    const vals = Object.values(counts);
    return vals.length ? Math.max(...vals) : 0;
  }, [counts]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const totalSelected = useMemo(() => {
    if (selected.length === 0) return 0;
    return selected.reduce((sum, code) => sum + (counts[code] || 0), 0);
  }, [selected, counts]);

  const handleClick = useCallback(
    (code: string) => {
      if (selectedSet.has(code)) {
        onSelect(selected.filter((c) => c !== code));
      } else {
        onSelect([...selected, code]);
      }
    },
    [selected, selectedSet, onSelect]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent, code: string) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTooltip({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top - 10,
        code,
        name: DEPARTMENT_NAMES[code] || code,
        count: counts[code] || 0,
      });
    },
    [counts]
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const selectRegion = useCallback(
    (codes: string[]) => {
      const allSelected = codes.every((c) => selectedSet.has(c));
      if (allSelected) {
        onSelect(selected.filter((c) => !codes.includes(c)));
      } else {
        const merged = new Set([...selected, ...codes]);
        onSelect(Array.from(merged));
      }
    },
    [selected, selectedSet, onSelect]
  );

  const selectAll = useCallback(() => {
    onSelect(Object.keys(DEPARTMENT_PATHS));
  }, [onSelect]);

  const reset = useCallback(() => {
    onSelect([]);
  }, [onSelect]);

  const codes = useMemo(() => Object.keys(DEPARTMENT_PATHS), []);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative border rounded-lg bg-white overflow-hidden">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="w-full h-auto"
          style={{ maxHeight: "70vh" }}
        >
          {codes.map((code) => {
            const isSelected = selectedSet.has(code);
            const count = counts[code] || 0;
            const fill = isSelected
              ? "hsl(217, 90%, 55%)"
              : getHeatColor(count, maxCount);

            return (
              <path
                key={code}
                id={`dept-${code}`}
                d={DEPARTMENT_PATHS[code]}
                fill={fill}
                stroke={isSelected ? "hsl(217, 90%, 35%)" : "#94a3b8"}
                strokeWidth={isSelected ? 1.5 : 0.5}
                className="cursor-pointer transition-colors duration-150"
                onClick={() => handleClick(code)}
                onMouseMove={(e) => handleMouseMove(e, code)}
                onMouseLeave={handleMouseLeave}
              />
            );
          })}
        </svg>

        {tooltip && (
          <div
            className="absolute pointer-events-none z-10 bg-slate-900 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: "translate(-50%, -100%)",
            }}
          >
            {tooltip.name} ({tooltip.code}) —{" "}
            {tooltip.count.toLocaleString("fr-FR")} prospects
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(REGION_SHORTCUTS).map(([key, region]) => (
          <Button
            key={key}
            variant="outline"
            size="sm"
            onClick={() => selectRegion(region.codes)}
            className={
              region.codes.every((c) => selectedSet.has(c))
                ? "bg-blue-100 border-blue-300"
                : ""
            }
          >
            {region.label}
          </Button>
        ))}
        <Button variant="outline" size="sm" onClick={selectAll}>
          National
        </Button>
        <Button variant="outline" size="sm" onClick={reset}>
          Reset
        </Button>

        {selected.length > 0 && (
          <span className="ml-auto text-sm text-muted-foreground">
            {totalSelected.toLocaleString("fr-FR")} prospects dans{" "}
            {selected.length} dept.
          </span>
        )}
      </div>
    </div>
  );
}
