import type { SVGProps } from "react";

/**
 * Minimal stroke icon set (16px grid, currentColor). Icons are decorative by default: pair them with
 * visible text or pass `aria-label` + `aria-hidden={false}` when an icon stands alone.
 */
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

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);
export const XIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
export const FlagIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 14V2.5M3.5 3h8l-1.8 3 1.8 3h-8" />
  </svg>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  </svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </svg>
);
export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 6l4.5 4.5L12.5 6" />
  </svg>
);
export const ArrowLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13 8H3M7 4L3 8l4 4" />
  </svg>
);
export const MenuIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </svg>
);
export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
  </svg>
);
export const MoonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8z" />
  </svg>
);
export const MonitorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="12" height="8.5" rx="1.2" />
    <path d="M5.5 14h5M8 11v3" />
  </svg>
);
export const LogOutIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11l3-3-3-3M13.5 8H6" />
  </svg>
);
export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.8V8l2.2 1.4" />
  </svg>
);
export const PauseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5.8 3.5v9M10.2 3.5v9" />
  </svg>
);
export const PlayIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 3.3v9.4L12.5 8z" />
  </svg>
);
export const LightbulbIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 12h4M6.5 14h3M8 2a4 4 0 0 0-2.4 7.2c.4.3.7.8.7 1.3V11h3.4v-.5c0-.5.3-1 .7-1.3A4 4 0 0 0 8 2z" />
  </svg>
);
export const NoteIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3M5.5 8.5h5M5.5 11h3" />
  </svg>
);
export const BookmarkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 2.5h8v11L8 10.5l-4 3z" />
  </svg>
);
export const AlertIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.6v.1" />
  </svg>
);
export const InfoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2v4M8 4.9v.1" />
  </svg>
);
export const CircleCheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.3 8.2l1.9 1.9 3.6-4" />
  </svg>
);
export const CircleXIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" />
  </svg>
);
export const MessageIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" />
  </svg>
);
export const SparkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2L12 12M4 12l1.8-1.8M10.2 5.8L12 4" />
  </svg>
);
export const FocusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
  </svg>
);
export const PanelIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M10 2.5v11" />
  </svg>
);
export const KeyboardIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
    <path d="M4 6.5h.1M6.5 6.5h.1M9 6.5h.1M11.5 6.5h.1M5 9.5h6" />
  </svg>
);
export const StrikeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 8h11M10.8 5.2C10.4 4 9.3 3.3 8 3.3c-1.6 0-2.8.9-2.8 2.1 0 .9.5 1.5 1.5 1.9M5.2 10.7c.4 1.2 1.5 2 2.8 2 1.6 0 2.8-.9 2.8-2.2 0-.4-.1-.8-.3-1.1" />
  </svg>
);
export const HomeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 7L8 2.5 13.5 7v6.5h-4v-4h-3v4h-4z" />
  </svg>
);
export const PlayCircleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.8 5.6v4.8L10.4 8z" />
  </svg>
);
export const RepeatIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 7V6a2 2 0 0 1 2-2h8M10.5 2l2 2-2 2M13.5 9v1a2 2 0 0 1-2 2h-8M5.5 14l-2-2 2-2" />
  </svg>
);
export const ListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1" />
  </svg>
);
export const SettingsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </svg>
);
export const ShieldIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 1.8l5 1.9v4c0 3.2-2.1 5.4-5 6.5-2.9-1.1-5-3.3-5-6.5v-4z" />
  </svg>
);
export const BookIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 4.2C6.8 3.2 5 2.8 2.5 3v9.5c2.5-.2 4.3.2 5.5 1.2 1.2-1 3-1.4 5.5-1.2V3C11 2.8 9.2 3.2 8 4.2zM8 4.2v9.5" />
  </svg>
);
export const ExternalIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v3.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3.5" />
  </svg>
);
export const SpinnerIcon = ({ className, ...p }: IconProps) => (
  <svg {...base(p)} className={`animate-spin ${className ?? ""}`}>
    <path d="M8 2a6 6 0 1 0 6 6" />
  </svg>
);
