interface OnlineBadgeProps {
  online: boolean
  showLabel?: boolean
  size?: 'xs' | 'sm' | 'lg'
  className?: string
}

const DOT_SIZES = {
  xs: 'w-2 h-2',
  sm: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
}

export default function OnlineBadge({
  online,
  showLabel = false,
  size = 'sm',
  className = '',
}: OnlineBadgeProps) {
  const label = online ? 'Online' : 'Offline'
  const color = online ? 'bg-emerald-500' : 'bg-zinc-400'

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`.trim()}>
      <span className={`${DOT_SIZES[size]} ${color} rounded-full`} aria-hidden="true" />
      {showLabel ? (
        <span className="text-xs text-muted">{label}</span>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </span>
  )
}
