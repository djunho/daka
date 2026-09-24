interface ProfileFieldProps {
    id: string
    label: string
    value: string
    type?: string
    placeholder?: string
    readOnly?: boolean
}

export default function ProfileField({
    id,
    label,
    value,
    type = 'text',
    placeholder,
    readOnly = true,
}: ProfileFieldProps) {
    const inputClass =
      'w-full px-4 py-2.5 bg-paper/60 border border-line rounded-xl text-ink text-sm placeholder:text-muted ' +
      'caret-transparent cursor-default hover:border-brand/50 hover:bg-paper focus:outline-none focus:border-brand ' +
      //TODO: Remove this once we have edit profile functionality, this is to prevent the user from selecting the text in the input field
      'selection:bg-transparent'
    return (
        <div>
            <label htmlFor={id} className="block text-xs font-medium text-muted mb-1.5">
                {label}
            </label>
            <input
                id={id}
                type={type}
                value={value}
                readOnly={readOnly}
                placeholder={placeholder}
                className={inputClass}
            />
        </div>
    )
}
