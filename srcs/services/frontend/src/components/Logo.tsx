// The Daka logo mark: two arrows going opposite ways on the brand square, the
// trade in one picture (what you have goes out, what you want comes back).
//
// One component for every place the mark appears, so its drawing and colors
// live in one place. Colors are design tokens: the white arrow uses
// --color-surface and the red one --color-logo-accent, the brand's original
// red. The logo keeps that brighter red because it is a graphic, not text, so
// the 4.5:1 text contrast rule does not apply to it (design-system.md).

// Tailwind only generates classes written out in full, so each size is
// spelled out here instead of being built from numbers.
const SIZES = {
  md: { box: 'w-9 h-9 rounded-[10px]', icon: 22 }, // header
  lg: { box: 'w-11 h-11 rounded-xl', icon: 26 },   // login card
}

type LogoMarkProps = {
  size?: keyof typeof SIZES
}

// Decorative: it always sits next to the "daka" name or inside a link that
// is already named, so screen readers skip it.
export default function LogoMark({ size = 'md' }: LogoMarkProps) {
  const { box, icon } = SIZES[size]

  return (
    <span className={`inline-flex items-center justify-center bg-brand shrink-0 ${box}`}>
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M4 9 H17" stroke="var(--color-surface)" />
        <path d="M14 6 L17 9 L14 12" stroke="var(--color-surface)" />
        <path d="M20 15 H7" stroke="var(--color-logo-accent)" />
        <path d="M10 12 L7 15 L10 18" stroke="var(--color-logo-accent)" />
      </svg>
    </span>
  )
}
