"use client";

import { memo, useMemo } from "react";
import { encode } from "uqr";

import { cn } from "@/lib/utils/cn";

/** uqr's QrCodeDataType.Position (finder patterns). */
const POSITION_TYPE = 2;
const QUIET_ZONE = 4;
const BANDS = 8;

export interface QrGeometry {
  /** Modules per side, including the quiet zone. */
  size: number;
  /** Rounded-module paths grouped in radial bands (centre first) for the materialize reveal. */
  bands: string[];
  /** Top-left corners (in modules) of the three finder patterns. */
  finders: Array<[number, number]>;
}

function modulePath(x: number, y: number): string {
  // 0.9-module rounded square centred in its cell.
  const inset = 0.05;
  const s = 1 - inset * 2;
  const r = 0.28;
  const x0 = x + inset;
  const y0 = y + inset;
  return `M${x0 + r} ${y0}h${s - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${s - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${s - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${s - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`;
}

/** Pure: QR matrix → drawable geometry (exported for tests). ECC M, 4-module quiet zone. */
export function buildQrGeometry(value: string): QrGeometry {
  const qr = encode(value, { ecc: "M", border: QUIET_ZONE });
  const size = qr.size;
  const center = (size - 1) / 2;
  const maxDistance = Math.hypot(center, center) || 1;
  const bands: string[][] = Array.from({ length: BANDS }, () => []);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!qr.data[y][x] || qr.types[y][x] === POSITION_TYPE) {
        continue;
      }
      const distance = Math.hypot(x - center, y - center) / maxDistance;
      const band = Math.min(BANDS - 1, Math.floor(distance * BANDS));
      bands[band].push(modulePath(x, y));
    }
  }
  const far = size - QUIET_ZONE - 7;
  return {
    size,
    bands: bands.map((paths) => paths.join("")),
    finders: [
      [QUIET_ZONE, QUIET_ZONE],
      [far, QUIET_ZONE],
      [QUIET_ZONE, far]
    ]
  };
}

/**
 * Join QR code: always dark-on-light on its own card (even in dark themes), ≥ 4-module quiet zone,
 * rounded modules and brand-coloured finders. It "materializes" in radial bands (≈600 ms) and is
 * static afterwards; reduced motion renders it at once.
 */
export const QrCode = memo(function QrCode({
  value,
  label,
  className,
  animate = true
}: {
  value: string;
  /** Accessible name, e.g. "QR code para entrar em …". */
  label: string;
  className?: string;
  animate?: boolean;
}) {
  const geometry = useMemo(() => buildQrGeometry(value), [value]);
  const ink = "#0b1020";
  const finderInk = "#1e2a78";
  return (
    <svg
      viewBox={`0 0 ${geometry.size} ${geometry.size}`}
      role="img"
      aria-label={label}
      shapeRendering="geometricPrecision"
      className={cn("block aspect-square h-auto w-full rounded-[6%] bg-[#ffffff]", className)}
    >
      <rect width={geometry.size} height={geometry.size} fill="#ffffff" />
      {geometry.bands.map((d, index) =>
        d ? (
          <path
            key={index}
            d={d}
            fill={ink}
            className={animate ? "lq-qr-band" : undefined}
            style={animate ? { animationDelay: `${index * 30}ms` } : undefined}
          />
        ) : null
      )}
      {geometry.finders.map(([x, y], index) => (
        <g key={`${x}-${y}`} className={animate ? "lq-qr-band" : undefined} style={animate ? { animationDelay: `${index * 40}ms` } : undefined}>
          <rect x={x + 0.5} y={y + 0.5} width={6} height={6} rx={1.6} fill="none" stroke={finderInk} strokeWidth={1} />
          <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} fill={finderInk} />
        </g>
      ))}
    </svg>
  );
});
