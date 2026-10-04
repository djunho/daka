import { useRef, type ChangeEvent } from 'react'
import { IMAGE_ACCEPT, validateImage } from '../lib/images'

interface ImagePickerProps {
    label: string
    // Called with a file that passed validateImage.
    onPick: (file: File) => void
    // Called with the message to show when the file is not accepted. The
    // parent decides where it appears (a toast, a line under a form...).
    onError: (message: string) => void
    disabled?: boolean
    className?: string
}

// A button that opens the system file picker for one image. It only picks and
// validates; previewing (see hooks/useObjectUrl) and uploading belong to the
// page using it, so the same picker works for avatars and listing photos.
export default function ImagePicker({
    label,
    onPick,
    onError,
    disabled = false,
    className = 'text-xs font-semibold text-brand hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline',
}: ImagePickerProps) {
    // The real <input type="file"> cannot be styled, so it stays hidden and
    // the button below opens it.
    const inputRef = useRef<HTMLInputElement>(null)

    function handleChange(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        // Clear the input so choosing the same file again still fires
        // onChange (for example, after cancelling a preview).
        e.target.value = ''
        if (!file) return

        const problem = validateImage(file)
        if (problem) {
            onError(problem)
            return
        }
        onPick(file)
    }

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept={IMAGE_ACCEPT}
                hidden
                onChange={handleChange}
            />
            <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className={className}
            >
                {label}
            </button>
        </>
    )
}
