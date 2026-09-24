interface AvatarProps {
    avatar?: string | null
    user_name?: string
}

export default function Avatar({
    avatar,
    user_name = "",
}: AvatarProps) {
    {/* Avatar: Photo if available, fallback to initial letter */}
    return (
      avatar ? (
        <img
          src={avatar}
          alt={ user_name ? user_name : "" }
          className="w-20 h-20 rounded-full object-cover border border-line"
        />
      ) : (
        <div className="w-20 h-20 rounded-full bg-paper border border-line flex items-center justify-center text-2xl font-bold text-brand shrink-0">
        { user_name ?
            user_name.charAt(0).toUpperCase() :
            "?"
        }
        </div>
      )
    )
}
