/* ==========================================================================
   ICONS — one inline SVG sprite as a component.

   All strokes, no fills, so `color` drives them and they inherit hover states
   for free. `vectorEffect` is left off deliberately: these are never scaled
   far enough for stroke scaling to matter.
   ========================================================================== */

import type { ReactNode } from "react";

export type IconName =
  | "plus"
  | "search"
  | "globe"
  | "library"
  | "files"
  | "history"
  | "collapse"
  | "logout"
  | "more"
  | "link"
  | "export"
  | "caret"
  | "sparkle"
  | "atom"
  | "image"
  | "bulb"
  | "chip"
  | "mic"
  | "send"
  | "stop"
  | "clip"
  | "translate"
  | "help"
  | "menu"
  | "copy"
  | "retry"
  | "pie"
  | "pen"
  | "mark"
  | "close"
  | "shield"
  | "check"
  | "trash"
  | "brain"
  | "folder"
  | "alert"
  | "gauge"
  | "archive"
  | "persona"
  | "plug";

const PATHS: Record<IconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20.2 20.2 16.4 16.4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.9 3.1 2.9 14.9 0 18M12 3c-2.9 3.1-2.9 14.9 0 18" />
    </>
  ),
  library: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </>
  ),
  files: (
    <>
      <path d="M3 13.5h5l1.4 2.4h5.2L16 13.5h5" />
      <path d="M3 13.5 5.7 6.2A2 2 0 0 1 7.6 4.9h8.8a2 2 0 0 1 1.9 1.3L21 13.5v3.6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>
  ),
  history: (
    <>
      <path d="M3.4 9.3A9 9 0 1 1 3 12" />
      <path d="M3 4.6v4.7h4.7" />
      <path d="M12 7.6V12l3.1 1.9" />
    </>
  ),
  collapse: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.6" />
      <path d="M10 4v16" />
      <path d="M16.6 9.6 14.2 12l2.4 2.4" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4h2.9A2.6 2.6 0 0 1 20 6.6v10.8a2.6 2.6 0 0 1-2.6 2.6h-2.9" />
      <path d="M10.4 8.2 14.2 12l-3.8 3.8" />
      <path d="M14.2 12H4" />
    </>
  ),
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18.5" cy="12" r="1.6" />
    </g>
  ),
  link: (
    <>
      <path d="M10.4 13.6a4.2 4.2 0 0 0 6 0l2.3-2.4a4.2 4.2 0 0 0-6-6l-1.3 1.4" />
      <path d="M13.6 10.4a4.2 4.2 0 0 0-6 0l-2.3 2.4a4.2 4.2 0 0 0 6 6l1.3-1.4" />
    </>
  ),
  export: (
    <>
      <path d="M12 3.6v10.6" />
      <path d="M8.2 10.6 12 14.3l3.8-3.7" />
      <path d="M4.2 16.2v2.1A2.3 2.3 0 0 0 6.5 20.6h11a2.3 2.3 0 0 0 2.3-2.3v-2.1" />
    </>
  ),
  caret: <path d="M6.2 9.4 12 15.1l5.8-5.7" />,
  sparkle: (
    <g fill="currentColor" stroke="none">
      <path d="M11.3 2.6a.5.5 0 0 1 .95 0l1.3 3.9a.5.5 0 0 0 .32.32l3.9 1.3a.5.5 0 0 1 0 .95l-3.9 1.3a.5.5 0 0 0-.32.32l-1.3 3.9a.5.5 0 0 1-.95 0l-1.3-3.9a.5.5 0 0 0-.32-.32l-3.9-1.3a.5.5 0 0 1 0-.95l3.9-1.3a.5.5 0 0 0 .32-.32z" />
      <path d="M17.6 14.2a.4.4 0 0 1 .76 0l.66 1.98a.4.4 0 0 0 .26.26l1.98.66a.4.4 0 0 1 0 .76l-1.98.66a.4.4 0 0 0-.26.26l-.66 1.98a.4.4 0 0 1-.76 0l-.66-1.98a.4.4 0 0 0-.26-.26l-1.98-.66a.4.4 0 0 1 0-.76l1.98-.66a.4.4 0 0 0 .26-.26z" />
    </g>
  ),
  atom: (
    <>
      <circle cx="12" cy="12" r="2.1" />
      <ellipse cx="12" cy="12" rx="9.4" ry="3.9" />
      <ellipse cx="12" cy="12" rx="9.4" ry="3.9" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9.4" ry="3.9" transform="rotate(120 12 12)" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.4" width="18" height="15.2" rx="2.6" />
      <circle cx="8.6" cy="9.8" r="1.5" />
      <path d="M3.6 17.6l4.6-4.2a2 2 0 0 1 2.7 0l5.3 4.8" />
      <path d="M14.4 14.5l1.6-1.5a2 2 0 0 1 2.7 0l2 1.8" />
    </>
  ),
  bulb: (
    <>
      <path d="M9.4 18h5.2M10.2 20.8h3.6" />
      <path d="M12 3.2a6.1 6.1 0 0 0-3.7 10.95c.65.5 1.05 1.3 1.05 2.15h5.3c0-.85.4-1.65 1.05-2.15A6.1 6.1 0 0 0 12 3.2z" />
    </>
  ),
  chip: (
    <>
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3" />
      <rect x="8.6" y="8.6" width="6.8" height="6.8" rx="1.6" />
      <path d="M9.4 1.8v2.4M14.6 1.8v2.4M9.4 19.8v2.4M14.6 19.8v2.4M1.8 9.4h2.4M1.8 14.6h2.4M19.8 9.4h2.4M19.8 14.6h2.4" />
    </>
  ),
  mic: (
    <>
      <rect x="9.2" y="2.8" width="5.6" height="10.6" rx="2.8" />
      <path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0" />
      <path d="M12 17.8v3.4" />
    </>
  ),
  send: (
    <>
      <path d="M12 20.2V4.4" />
      <path d="M5.9 10.5 12 4.4l6.1 6.1" />
    </>
  ),
  stop: <rect x="7.2" y="7.2" width="9.6" height="9.6" rx="2.6" fill="currentColor" stroke="none" />,
  clip: (
    <path d="M19.6 11.3 12 18.9a4.9 4.9 0 0 1-6.9-6.9l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.75 1.75 0 0 1-2.5-2.5l7.4-7.4" />
  ),
  translate: (
    <>
      <path d="M3.2 6.3h8.4M7.4 4.1v2.2" />
      <path d="M10.1 6.3c0 3.7-2.8 7.2-6.5 8.8" />
      <path d="M5 10.6c1.3 2.3 3.3 4 5.7 4.7" />
      <path d="M12.6 20.3 16.7 9.9l4.1 10.4" />
      <path d="M13.9 17.1h5.6" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.3A2.6 2.6 0 0 1 14.6 10c0 1.75-2.6 2.3-2.6 3.95" />
      <circle cx="12" cy="17.2" r="0.95" fill="currentColor" stroke="none" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2.6" />
      <path d="M15 6.6V6.2A2.2 2.2 0 0 0 12.8 4H6.2A2.2 2.2 0 0 0 4 6.2v6.6A2.2 2.2 0 0 0 6.2 15h.4" />
    </>
  ),
  retry: (
    <>
      <path d="M20.4 12a8.4 8.4 0 1 1-2.75-6.2" />
      <path d="M20.4 3.4v4.9h-4.9" />
    </>
  ),
  pie: (
    <>
      <path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8H12z" />
      <path d="M15.2 3.9A8.8 8.8 0 0 1 20.1 8.8h-4.9z" />
    </>
  ),
  pen: (
    <>
      <path d="M4 20.2l1.1-4.2L16.6 4.5a2.15 2.15 0 0 1 3.05 3.05L8.2 19.1z" />
      <path d="M15.2 5.9 18.2 8.9" />
    </>
  ),
  mark: (
    <g fill="currentColor" stroke="none">
      <path d="M12 3.6c.9 0 1.6.7 1.6 1.6v2.1a4.6 4.6 0 0 1 1.5.86l1.82-1.05a1.6 1.6 0 1 1 1.6 2.77L16.7 10.9a4.7 4.7 0 0 1 0 1.73l1.82 1.05a1.6 1.6 0 1 1-1.6 2.77l-1.82-1.05a4.6 4.6 0 0 1-1.5.86v2.1a1.6 1.6 0 0 1-3.2 0v-2.1a4.6 4.6 0 0 1-1.5-.86l-1.82 1.05a1.6 1.6 0 1 1-1.6-2.77L7.3 12.63a4.7 4.7 0 0 1 0-1.73L5.48 9.85a1.6 1.6 0 1 1 1.6-2.77L8.9 8.13a4.6 4.6 0 0 1 1.5-.86V5.2c0-.9.7-1.6 1.6-1.6zm0 6.3a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2z" />
    </g>
  ),
  close: <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />,
  shield: (
    <>
      <path d="M12 3.2 5 6v5.4c0 4.1 2.8 7.6 7 9.4 4.2-1.8 7-5.3 7-9.4V6z" />
      <path d="M9.3 12.1 11.3 14l3.5-3.9" />
    </>
  ),
  check: <path d="M5 12.6 9.6 17 19 7.4" />,
  trash: (
    <>
      <path d="M4.6 6.8h14.8M9.5 6.8V5.2a1.4 1.4 0 0 1 1.4-1.4h2.2a1.4 1.4 0 0 1 1.4 1.4v1.6" />
      <path d="M7 6.8 7.8 19a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 6.8" />
    </>
  ),
  brain: (
    <>
      <path d="M12 5.2a2.6 2.6 0 0 0-4.9-1.2 2.5 2.5 0 0 0-2.3 3.6A2.7 2.7 0 0 0 4.4 12a2.6 2.6 0 0 0 1.1 3.9 2.6 2.6 0 0 0 3.3 3.3A2.5 2.5 0 0 0 12 18.4z" />
      <path d="M12 5.2a2.6 2.6 0 0 1 4.9-1.2 2.5 2.5 0 0 1 2.3 3.6A2.7 2.7 0 0 1 19.6 12a2.6 2.6 0 0 1-1.1 3.9 2.6 2.6 0 0 1-3.3 3.3A2.5 2.5 0 0 1 12 18.4z" />
    </>
  ),
  folder: (
    <path d="M3.6 7.2a1.6 1.6 0 0 1 1.6-1.6h3.4l1.8 2.2h8a1.6 1.6 0 0 1 1.6 1.6v8.4a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z" />
  ),
  alert: (
    <>
      <path d="M12 3.8 2.8 19.6h18.4z" />
      <path d="M12 9.6v3.9M12 16.6h.01" />
    </>
  ),
  gauge: (
    <>
      <path d="M4.2 17.4a8.4 8.4 0 1 1 15.6 0" />
      <path d="M12 17.4 15.6 11" />
    </>
  ),
  archive: (
    <>
      <rect x="3.2" y="4.4" width="17.6" height="4.2" rx="1.3" />
      <path d="M5 8.6v9.1a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.6" />
      <path d="M10 12.4h4" />
    </>
  ),
  persona: (
    <>
      <circle cx="12" cy="8.3" r="3.9" />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  plug: (
    <>
      <path d="M9.2 3.4v4.2M14.8 3.4v4.2" />
      <path d="M6.6 7.6h10.8v3.1a5.4 5.4 0 0 1-10.8 0z" />
      <path d="M12 16.1v4.5" />
    </>
  ),
};

interface Props {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 18, className, strokeWidth = 1.7 }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
