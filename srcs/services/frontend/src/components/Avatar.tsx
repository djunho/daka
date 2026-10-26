interface AvatarProps {
    avatar?: string | null
    user_name?: string
    size?: 'sm' | 'lg'
}

// Tailwind only generates the classes it finds written out in full in the
// code, so the sizes are spelled out here instead of built as `w-${n}`.
const SIZES = {
    sm: 'w-12 h-12 text-lg',
    lg: 'w-20 h-20 text-2xl',
}

export default function Avatar({
    avatar,
    user_name = "",
    size = 'lg',
}: AvatarProps) {
    {/* Avatar: Photo if available, fallback to initial letter */}
    return (
      avatar ? (
        <img
          src={avatar}
          alt={ user_name ? user_name : "" }
          className={`${SIZES[size]} rounded-full object-cover border border-line shrink-0`}
        />
      ) : (
        <div className={`${SIZES[size]} rounded-full bg-paper border border-line flex items-center justify-center font-bold text-brand shrink-0`}>
        { user_name ?
            user_name.charAt(0).toUpperCase() :
            "?"
        }
        </div>
      )
    )
}
