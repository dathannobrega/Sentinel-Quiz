import type { SVGProps } from "react";

import type { LiveItemType } from "@/types/api";

/** Quiz-builder icons on the same 16px stroke grid as components/ui/icons. Decorative by default. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    ...props
  };
}

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
export const TrashIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 8.5h6.6l.7-8.5M6.8 7v4M9.2 7v4" />
  </svg>
);
export const CopyIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </svg>
);
export const DatabaseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <ellipse cx="8" cy="3.8" rx="5" ry="1.8" />
    <path d="M3 3.8v8.4c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V3.8M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" />
  </svg>
);
export const PresentIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2" />
    <path d="M8 11v2.5M5.5 13.5h5M6.8 5.2v3.3l2.8-1.65z" />
  </svg>
);
/** Self-paced challenge (Incremento 6): a flag on a clock-ish base. */
export const ChallengeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 14V2.5M3.5 3h7.2l-1.5 2.5 1.5 2.5H3.5" />
    <circle cx="11.5" cy="11.5" r="2.8" />
    <path d="M11.5 10.2v1.4l.9.6" />
  </svg>
);
export const UploadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 10.5V2.5M4.8 5.5L8 2.5l3.2 3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
  </svg>
);
export const ArchiveIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.8" y="2.5" width="12.4" height="3" rx=".8" />
    <path d="M3 5.5v7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-7M6.5 8.3h3" />
  </svg>
);
export const PaletteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 1.8a6.2 6.2 0 1 0 0 12.4c.9 0 1.3-.6 1.1-1.3-.3-1 .2-1.9 1.3-1.9h1.5A2.3 2.3 0 0 0 14.2 8.7 6.2 6.2 0 0 0 8 1.8z" />
    <circle cx="5" cy="7" r=".8" fill="currentColor" stroke="none" />
    <circle cx="7.6" cy="4.6" r=".8" fill="currentColor" stroke="none" />
    <circle cx="10.6" cy="5.8" r=".8" fill="currentColor" stroke="none" />
  </svg>
);
export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.3 10.3L14 14" />
  </svg>
);
export const UsersIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="5.5" r="2.3" />
    <path d="M1.8 13.5c.4-2.4 2.1-3.8 4.2-3.8s3.8 1.4 4.2 3.8M10.5 3.4a2.2 2.2 0 0 1 0 4.3M12 9.9c1.2.5 2 1.7 2.2 3.6" />
  </svg>
);
export const QrIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2" width="4.5" height="4.5" rx=".6" />
    <rect x="9.5" y="2" width="4.5" height="4.5" rx=".6" />
    <rect x="2" y="9.5" width="4.5" height="4.5" rx=".6" />
    <path d="M9.5 9.5h1.8v1.8M14 9.5v1.8M9.5 14h1.8M12.8 12.8H14V14" />
  </svg>
);
export const PrinterIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 5.5V2h7v3.5M4.5 11.5H3a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1.5" />
    <rect x="4.5" y="9" width="7" height="5" rx=".6" />
  </svg>
);
export const DownloadIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2.5v8M4.8 7.5L8 10.5l3.2-3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
  </svg>
);

/** AI: one large four-point star and a small one (used for every "Gerado por IA" affordance). */
export const SparklesIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.5 2.2l1.15 3.15L10.8 6.5 7.65 7.65 6.5 10.8 5.35 7.65 2.2 6.5l3.15-1.15z" />
    <path d="M11.8 9.6l.55 1.45 1.45.55-1.45.55-.55 1.45-.55-1.45-1.45-.55 1.45-.55z" />
  </svg>
);
/** Improve with AI (magic wand). */
export const WandIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 13.5l7.3-7.3M8.6 5l2.4 2.4M11.5 1.8v2M10.5 2.8h2M13.8 5.2v1.6M13 6h1.6M5 2.2v1.6M4.2 3h1.6" />
  </svg>
);
/** Before/after comparison. */
export const DiffIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.8" y="2.5" width="5.2" height="11" rx="1" />
    <rect x="9" y="2.5" width="5.2" height="11" rx="1" />
    <path d="M3.4 6h2M10.6 6h2M11.6 5v2M3.4 9.5h2M10.6 9.5h2" />
  </svg>
);

const typeGlyphs: Record<LiveItemType, (p: IconProps) => React.JSX.Element> = {
  single_choice: (p) => (
    <svg {...base(p)}>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  ),
  multi_choice: (p) => (
    <svg {...base(p)}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
      <path d="M3.2 4.6l1.1 1.1 1.8-2.2M10.2 11.6l1.1 1.1 1.8-2.2M9 4.5h5M2 11.5h5" />
    </svg>
  ),
  true_false: (p) => (
    <svg {...base(p)}>
      <path d="M1.8 8.2l2.2 2.2 3.6-4.4M9.5 5.5l4.5 4.5M14 5.5L9.5 10" />
    </svg>
  ),
  type_answer: (p) => (
    <svg {...base(p)}>
      <rect x="1.5" y="4" width="13" height="8" rx="1.4" />
      <path d="M4 6.5v3M4.8 8h-.8M8.2 6.3v3.4" />
    </svg>
  ),
  poll: (p) => (
    <svg {...base(p)}>
      <path d="M2.5 13.5h11M4 13.5V8.5M8 13.5V3.5M12 13.5V6.5" />
    </svg>
  ),
  content: (p) => (
    <svg {...base(p)}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.4" />
      <path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4" />
    </svg>
  ),
  leaderboard: (p) => (
    <svg {...base(p)}>
      <path d="M1.8 13.5h12.4M3 13.5V9.5h3v4M6 13.5V6h4v7.5M10 13.5V8h3v5.5M7.4 3.8L8 2.6l.6 1.2 1.3.2-.95.9.23 1.3L8 5.6l-1.18.6.23-1.3-.95-.9z" />
    </svg>
  ),
  /** Three ranked rows with an up/down arrow. */
  ordering: (p) => (
    <svg {...base(p)}>
      <path d="M6.5 3.5h7M6.5 8h7M6.5 12.5h7M3 2.5v11M1.6 4L3 2.5 4.4 4M1.6 12L3 13.5 4.4 12" />
    </svg>
  ),
  /** A number line with a marker. */
  numeric: (p) => (
    <svg {...base(p)}>
      <path d="M1.8 11h12.4M3 9.6v2.8M8 9.6v2.8M13 9.6v2.8M10.5 3.2l1.5 1.5-1.5 1.5M12 4.7H9a1.5 1.5 0 0 0-1.5 1.5v2.3" />
    </svg>
  ),
  /** A cloud with words of different sizes. */
  word_cloud: (p) => (
    <svg {...base(p)}>
      <path d="M4.5 12.5a3 3 0 0 1-.4-6A4 4 0 0 1 11.8 5.6a3.4 3.4 0 0 1-.3 6.9z" />
      <path d="M5.5 9.3h3.4M6.6 10.9h4M9.9 9.3h.6" />
    </svg>
  )
};

export function ItemTypeIcon({ type, ...props }: IconProps & { type: LiveItemType }) {
  const Glyph = typeGlyphs[type] ?? typeGlyphs.single_choice;
  return <Glyph {...props} />;
}
