interface ProfileFieldProps {
    id: string
    label: string
    value: string
    type?: string
    placeholder?: string
    readOnly?: boolean
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export default function ProfileField({
    id,
    label,
    value,
    type = 'text',
    placeholder,
    readOnly = true,
    onChange,
}: ProfileFieldProps) {
    const inputClass =
      'w-full px-4 py-2.5 border border-line rounded-xl text-ink text-sm placeholder:text-muted ' +
      'hover:border-brand/50 hover:bg-paper focus:outline-none focus:border-brand ' +
      ( readOnly
          ? 'bg-paper/60 cursor-default caret-transparent selection:bg-transparent ' 
          : 'cursor-text bg-surface ' )
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
                onChange={onChange}
            />
        </div>
    )
}
