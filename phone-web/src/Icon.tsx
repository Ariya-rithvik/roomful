import type { ReactNode } from 'react';

// Inline SVG icons on a 24 x 24 grid, stroke 2, round caps (docs/design/DESIGN.md section 6).
// `d` is always stroked. With `filled`, `solid` is filled in currentColor and `cut` is stroked in
// var(--icon-cut) so the details stay visible on top of the fill (set it to the background colour).

const ICONS = {
  mic: { d: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z M5 11a7 7 0 0 0 14 0 M12 18v3 M8.5 21h7', solid: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z' },
  stop: { d: 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', solid: 'M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z' },
  camera: {
    d: 'M4 8.5a2 2 0 0 1 2-2h2.2L9.8 4h4.4l1.6 2.5H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z M8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
    solid: 'M4 8.5a2 2 0 0 1 2-2h2.2L9.8 4h4.4l1.6 2.5H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
    cut: 'M8.5 13a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0',
  },
  smile: {
    d: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M8 14.5a5 5 0 0 0 8 0 M9 9.5h.01 M15 9.5h.01',
    solid: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0',
    cut: 'M8 14.5a5 5 0 0 0 8 0 M9 9.5h.01 M15 9.5h.01',
  },
  tv: { d: 'M4 7h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z M8 3l4 4 4-4 M9 22h6' },
  shield: { d: 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z M9 12l2 2 4-4' },
  check: { d: 'M5 12.5l4.5 4.5L19 7' },
  close: { d: 'M6 6l12 12 M18 6L6 18' },
  bell: { d: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4' },
  leave: { d: 'M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3 M16 16l4-4-4-4 M20 12H10' },
  sound: { d: 'M4 9h3l5-4v14l-5-4H4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a7.5 7.5 0 0 1 0 11' },
  mute: { d: 'M4 9h3l5-4v14l-5-4H4z M16 9.5l5 5 M21 9.5l-5 5' },
  phone: { d: 'M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z' },
  alert: { d: 'M10.3 4.6a2 2 0 0 1 3.4 0l7.4 12.9A2 2 0 0 1 19.4 20.5H4.6a2 2 0 0 1-1.7-3z M12 9.5v4 M12 17h.01' },
  info: { d: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0 M12 11v5 M12 8h.01' },
  lock: { d: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z M8 11V8a4 4 0 0 1 8 0v3' },
  sparkle: { d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z' },
  trophy: { d: 'M8 4h8v5a4 4 0 0 1-8 0z M8 6H5a3 3 0 0 0 3 4.5 M16 6h3a3 3 0 0 1-3 4.5 M12 13v4 M8 21h8 M10 17h4v4h-4z' },
  arrow: { d: 'M5 12h14 M13 6l6 6-6 6' },
  refresh: { d: 'M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 4v4h4 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 20v-4h-4' },
  hand: { d: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V12 M11 11V5a1.5 1.5 0 0 1 3 0v6 M14 11V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.6 15.2a1.5 1.5 0 0 1 2.3-1.9L8 15' },
  users: { d: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14a6.5 6.5 0 0 1 3.5 6' },
  image: { d: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M3 16l5-5 4 4 3-3 6 6 M15.5 9h.01' },
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24, filled = false, className }: { name: IconName; size?: number; filled?: boolean; className?: string }) {
  const icon: { d: string; solid?: string; cut?: string } = ICONS[name];
  // Stroke 2 at 24 px, growing to 3 px at 40 px and 4 px at 56 px on screen (in viewBox units).
  const stroke = size <= 24 ? 2 : ((2 + (size - 24) / 16) * 24) / size;
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={icon.d} />
      {filled && icon.solid && <path d={icon.solid} fill="currentColor" />}
      {filled && icon.cut && <path d={icon.cut} style={{ stroke: 'var(--icon-cut, #000)' }} />}
    </svg>
  );
}

/** A short message with a leading icon; the tone sets the colours, the icon and words carry the meaning. */
export function Notice({ tone, icon, children, role }: { tone: 'warn' | 'info' | 'ok' | 'speaking'; icon: IconName; children: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div className={`notice ${tone}`} role={role}>
      <Icon name={icon} size={22} />
      <div>{children}</div>
    </div>
  );
}
