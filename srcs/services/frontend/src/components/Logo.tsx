// Daka wordmark, recreated as inline SVG so it stays crisp at any size and
// adapts to dark mode. Colors come from the site's palette:
// "da" uses the ink color, "ka" the brand teal, and the two arrows in the
// middle are the swap signature (teal on top, coral on the bottom).
export default function Logo({ height = 34 }: { height?: number }) {
  return (
    <svg
      height={height}
      viewBox="0 0 132 44"
      role="img"
      aria-label="Daka"
      style={{ display: 'block' }}
    >
      {/* "da" — the side the person gives */}
      <text
        x="52"
        y="34"
        textAnchor="end"
        fontFamily="'Bricolage Grotesque', system-ui, sans-serif"
        fontWeight="700"
        fontSize="40"
        letterSpacing="-0.03em"
        fill="var(--color-ink)"
      >
        da
      </text>

      {/* the swap: top arrow points right (teal), bottom arrow points left (coral) */}
      <path d="M58 17 L78 17" stroke="var(--color-brand)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M72 11 L78 17 L72 23" stroke="var(--color-brand)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M78 30 L58 30" stroke="var(--color-accent)" strokeWidth="4" strokeLinecap="round" fill="none" />
      <path d="M64 24 L58 30 L64 36" stroke="var(--color-accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* "ka" — the side the person receives */}
      <text
        x="84"
        y="34"
        fontFamily="'Bricolage Grotesque', system-ui, sans-serif"
        fontWeight="700"
        fontSize="40"
        letterSpacing="-0.03em"
        fill="var(--color-brand)"
      >
        ka
      </text>
    </svg>
  )
}
