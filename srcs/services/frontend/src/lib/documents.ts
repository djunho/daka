import { ApiError } from './api'
import { getPortugueseErrorMessage } from './errors'

// Rules for the PDF documents attached to a listing (manual, invoice...).
//
// They mirror the backend (app/documents.py and settings.max_document_*).
// Checking here gives instant feedback before anything is sent; the backend
// check is still the one that protects us: it also parses the file, rejects
// password protection and active content, and removes the metadata.

// Value for <input type="file" accept="...">. ".pdf" as well, because some
// systems do not fill in the MIME type.
export const DOCUMENT_ACCEPT = 'application/pdf,.pdf'

// 2 MB, the same limit as the backend.
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

export const MAX_LISTING_DOCUMENTS = 3

// Every PDF starts with these bytes. Reading them checks the format itself,
// not only the name the user gave the file.
const PDF_SIGNATURE = '%PDF-'

// Returns the message to show the user, or null when the file looks fine.
export async function validateDocument(file: File): Promise<string | null> {
  const looksLikePdf =
    file.type === 'application/pdf' || (file.type === '' && file.name.toLowerCase().endsWith('.pdf'))
  if (!looksLikePdf) {
    return 'O documento tem de ser um PDF.'
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return 'O PDF não pode ter mais de 2 MB.'
  }
  if (!(await startsWithPdfSignature(file))) {
    return 'O ficheiro não é um PDF válido.'
  }
  return null
}

// FileReader rather than Blob.arrayBuffer(): it works in every supported
// browser and in the test environment (jsdom) alike.
function startsWithPdfSignature(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const head = new Uint8Array(reader.result as ArrayBuffer)
      resolve(String.fromCharCode(...head) === PDF_SIGNATURE)
    }
    reader.onerror = () => resolve(false)
    reader.readAsArrayBuffer(file.slice(0, PDF_SIGNATURE.length))
  })
}

// "1,2 MB", "830 KB": the size as people read it (pt-PT decimal comma).
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function formatPageCount(pages: number): string {
  return pages === 1 ? '1 página' : `${pages} páginas`
}

// The message for a failed document upload. The backend answers 422 for four
// different reasons, told apart by its (English) detail.
export function getDocumentErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 422) {
    const detail = err.message.toLowerCase()
    if (detail.includes('password')) return 'O PDF não pode estar protegido por palavra-passe.'
    if (detail.includes('pages')) return 'O PDF tem de ter entre 1 e 50 páginas.'
    if (detail.includes('javascript') || detail.includes('active')) {
      return 'O PDF não pode conter JavaScript, anexos ou outro conteúdo ativo.'
    }
    if (detail.includes('complex')) {
      return 'O PDF é demasiado complexo para ser verificado. Experimenta guardá-lo de novo como PDF simples.'
    }
  }
  return getPortugueseErrorMessage(err, fallback, {
    404: 'O anúncio já não existe.',
    409: `O anúncio já tem o máximo de ${MAX_LISTING_DOCUMENTS} documentos.`,
    413: 'O PDF não pode ter mais de 2 MB.',
    415: 'O ficheiro tem de ser um PDF válido.',
  })
}
