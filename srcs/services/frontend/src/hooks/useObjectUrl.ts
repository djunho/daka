import { useEffect, useState } from 'react'

// Turns a File the user picked into a temporary URL an <img> can show, so
// they can preview an image before it is uploaded.
//
// URL.createObjectURL keeps the file in memory until the URL is revoked, so
// the cleanup below revokes it whenever the file changes or the component
// using this hook goes away. Without it, every preview would leak memory.
export function useObjectUrl(file: File | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  return url
}
