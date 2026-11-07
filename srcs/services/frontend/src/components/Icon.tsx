import { type ReactNode } from 'react'

// Daka's own icon set (docs/design/design-system.md, "Icons").
//
// Every icon follows the same drawing rules, so they look like one family:
//   - a 24x24 viewBox, outline only (fill="none");
//   - stroke="currentColor", so an icon takes the color of the text around
//     it and every color comes from the design tokens (text-brand, text-accent…);
//   - a 1.8 stroke with round caps and joins.
//
// Decorative by default: next to a text, or inside a button that already has
// an aria-label, an icon adds nothing for screen readers, so it is hidden from
// them. Give it a `label` only when the icon alone carries the meaning.

export const ICON_NAMES = [
  'close',
  'check',
  'plus',
  'minus',
  'chevron-up',
  'chevron-down',
  'swap',
  'chat',
  'inbox',
  'document',
  'location',
  'warning',
  'refresh',
  'arrow-right',
  'eye',
  'eye-off',
  'user',
  'heart',
] as const

export type IconName = (typeof ICON_NAMES)[number]

const PATHS: Record<IconName, ReactNode> = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  'chevron-up': <path d="M6 15l6-6 6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  // The brand's signature: what you have goes one way, what you want comes
  // back the other (the same two arrows as the logo).
  swap: (
    <>
      <path d="M4 8h15" />
      <path d="M15.5 4.5 19 8l-3.5 3.5" />
      <path d="M20 16H5" />
      <path d="M8.5 12.5 5 16l3.5 3.5" />
    </>
  ),
  chat: <path d="M20.5 11.5a8.5 8.5 0 0 1-12.3 7.6L3.5 20.5l1.4-4.6a8.5 8.5 0 1 1 15.6-4.4Z" />,
  inbox: (
    <>
      <path d="M3 13h5l1.5 3h5l1.5-3h5" />
      <path d="M5.6 5.5h12.8L21 13v5.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V13Z" />
    </>
  ),
  document: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  location: (
    <>
      <path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 4.2 2.7 17.5a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4M12 17h.01" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a13.4 13.4 0 0 1-2.4 3.1M6.5 6.5A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.1-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </>
  ),
  // Favorites. Outline when not saved; a saved listing fills it with the
  // fill-current class (see FavoriteButton), so there is one heart, not two.
  heart: (
    <path d="M12 20s-7.5-4.6-9.2-9.4C1.7 7.4 3.9 4.5 7.2 4.5c2 0 3.7 1.1 4.8 2.8 1.1-1.7 2.8-2.8 4.8-2.8 3.3 0 5.5 2.9 4.4 6.1C19.5 15.4 12 20 12 20Z" />
  ),
}

type IconProps = {
  name: IconName
  // Width and height in pixels.
  size?: number
  // Extra classes, e.g. a text-* color or a margin. Layout classes such as
  // shrink-0 keep the icon from being squeezed in a flex row.
  className?: string
  // Only for an icon that carries meaning on its own: it is then announced
  // as an image with this name.
  label?: string
}

export default function Icon({ name, size = 20, className = '', label }: IconProps) {
  const a11y = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': true as const }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={`shrink-0${className ? ` ${className}` : ''}`}
      {...a11y}
    >
      {PATHS[name]}
    </svg>
  )
}
