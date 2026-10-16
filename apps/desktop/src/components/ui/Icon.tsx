import type { JSX } from 'react';

// One offline, 24px outline vocabulary. Decorative icons inherit the accompanying label.
const PATHS = {
  studio: 'M4 7 9 3l5 4v10l-5 4-5-4V7Zm5-4v18m5-14 6-4v14l-6 4',
  projects: 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm0 3h18',
  chat: 'M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0ZM7 10h10M7 14h6',
  web: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
  knowledge: 'M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Zm0 0v15M5 8h3m-3 4h3m8-4h3m-3 4h3',
  gallery: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm-1 14 5-5 4 4 4-6 5 7M8 7h.01',
  cost: 'M4 20V10m5 10V4m5 16v-7m5 7V7M2 21h20',
  workflow: 'M4 3h6v6H4V3Zm10 12h6v6h-6v-6ZM7 9v9h7m3-9V6h-7m4-3h6v6h-6',
  processes: 'M3 12h4l3-8 4 16 3-8h4',
  settings: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  key: 'M14 3a6 6 0 1 1-4 10l-7 7v-4l6-6a6 6 0 0 1 5-7Zm3 4h.01',
  router: 'M12 3v6M4 21v-6h16v6M12 9v12M9 3h6M1 21h6m2 0h6m2 0h6',
  budget: 'M3 6h18v14H3V6Zm0 4h18m-5 4h5M6 6V3h12v3',
  pricing: 'M3 3h9l9 9-9 9-9-9V3Zm5 5h.01',
  fx: 'M4 7h15l-4-4m4 14H4l4 4M19 7v4M4 17v-4',
  palette:
    'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h3a3 3 0 0 0 3-3c0-4-4-7-9-7ZM7 9h.01M11 6h.01M16 8h.01M6 14h.01',
  labs: 'M9 3h6m-5 0v7L4 20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-10V3M7 15h10',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  send: 'm3 3 19 9-19 9 4-9-4-9Zm4 9h15',
  stop: 'M6 6h12v12H6V6Z',
  refresh: 'M20 8a9 9 0 1 0 1 7M20 3v5h-5',
  open: 'M14 3h7v7m0-7L10 14M10 3H4v17h17v-6',
  collapse: 'M3 3h18v18H3V3Zm5 0v18m8-14-4 5 4 5',
  expand: 'M3 3h18v18H3V3Zm5 0v18m4-14 4 5-4 5',
  check: 'm5 12 4 4L19 6',
  warning: 'm12 3 10 18H2L12 3Zm0 6v5m0 3h.01',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-6v6l4 2',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  label,
  className = '',
}: {
  readonly name: IconName;
  readonly label?: string;
  readonly className?: string;
}): JSX.Element {
  return (
    <svg
      className={`studio-icon ${className}`}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
