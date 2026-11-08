import { useState } from 'react'
import OnlineBadge from './OnlineBadge'

interface AvatarProps {
    avatar?: string | null
    user_name?: string
    size?: 'xs' | 'sm' | 'lg'
    online?: boolean
}

// Tailwind only generates the classes it finds written out in full in the
// code, so the sizes are spelled out here instead of built as `w-${n}`.
const SIZES = {
    xs: 'w-7 h-7 text-xs',
    sm: 'w-12 h-12 text-lg',
    lg: 'w-20 h-20 text-2xl',
}

export default function Avatar({
    avatar,
    user_name = "",
    size = 'lg',
    online,
}: AvatarProps) {
    // The address of a photo that failed to load. Kept as the address, not a
    // boolean, so a new photo (another user, a new upload) is tried again.
    const [failedSrc, setFailedSrc] = useState<string | null>(null)

    // Photo if available and loadable, fallback to the initial letter.
    const avatarElement = avatar && avatar !== failedSrc ? (
      <img
        src={avatar}
        // Google sign-in avatars are hosted on Google's servers, which refuse
        // (429) pictures requested with our page as Referer.
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(avatar)}
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

    if (online === undefined) {
      return avatarElement
    }

    // The wrapper becomes the root element, so it needs the same shrink-0 as
    // the avatar: otherwise a flex row with long text squeezes it.
    return (
      <span className="relative inline-flex shrink-0">
        {avatarElement}
        <OnlineBadge
          online={online}
          size={size}
          className="absolute right-0 bottom-0 translate-x-1/6 translate-y-1/6 bg-surface rounded-full p-0.5"
        />
      </span>
    )
}
