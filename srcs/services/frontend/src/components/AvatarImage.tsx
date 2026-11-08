import { useState, type ReactNode } from 'react'

interface AvatarImageProps {
    src: string | null | undefined
    alt: string
    className?: string
    // Shown when there is no photo, or when it fails to load.
    fallback: ReactNode
}

// The one place that renders a profile photo, so every avatar loads and
// recovers the same way.
export default function AvatarImage({ src, alt, className, fallback }: AvatarImageProps) {
    // The address of a photo that failed to load. Kept as the address, not a
    // boolean, so a new photo (another user, a new upload) is tried again.
    const [failedSrc, setFailedSrc] = useState<string | null>(null)

    if (!src || src === failedSrc) {
        return <>{fallback}</>
    }

    return (
        <img
            src={src}
            alt={alt}
            // Google sign-in avatars are hosted on Google's servers, which refuse
            // (429) pictures requested with our page as Referer.
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(src)}
            className={className}
        />
    )
}
