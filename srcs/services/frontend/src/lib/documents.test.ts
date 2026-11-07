import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import {
  MAX_DOCUMENT_BYTES,
  formatFileSize,
  getDocumentErrorMessage,
  validateDocument,
} from './documents'

const pdf = (name = 'manual.pdf', type = 'application/pdf', content = '%PDF-1.7\n') =>
  new File([content], name, { type })

describe('validateDocument', () => {
  it('accepts a real PDF', async () => {
    expect(await validateDocument(pdf())).toBeNull()
  })

  it('accepts a .pdf file whose type the system left empty', async () => {
    expect(await validateDocument(pdf('fatura.PDF', ''))).toBeNull()
  })

  it('refuses another type', async () => {
    expect(await validateDocument(pdf('foto.png', 'image/png'))).toBe('O documento tem de ser um PDF.')
  })

  it('refuses a file over 2 MB', async () => {
    const big = new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], 'grande.pdf', { type: 'application/pdf' })
    expect(await validateDocument(big)).toBe('O PDF não pode ter mais de 2 MB.')
  })

  it('refuses a file named .pdf that is not one', async () => {
    expect(await validateDocument(pdf('falso.pdf', 'application/pdf', '<html></html>'))).toBe(
      'O ficheiro não é um PDF válido.',
    )
  })
})

describe('formatFileSize', () => {
  it('reads like people write sizes in Portugal', () => {
    expect(formatFileSize(500)).toBe('1 KB')
    expect(formatFileSize(830 * 1024)).toBe('830 KB')
    expect(formatFileSize(1.25 * 1024 * 1024)).toBe('1,3 MB')
  })
})

describe('getDocumentErrorMessage', () => {
  it('tells the three 422 reasons apart', () => {
    expect(getDocumentErrorMessage(new ApiError(422, 'The document must open without a password.'), 'x'))
      .toBe('O PDF não pode estar protegido por palavra-passe.')
    expect(getDocumentErrorMessage(new ApiError(422, 'The document must have between 1 and 50 pages.'), 'x'))
      .toBe('O PDF tem de ter entre 1 e 50 páginas.')
    expect(getDocumentErrorMessage(
      new ApiError(422, 'The document must not contain JavaScript, attachments or other active content.'), 'x',
    )).toBe('O PDF não pode conter JavaScript, anexos ou outro conteúdo ativo.')
  })

  it('has its own words for size, type and the limit', () => {
    expect(getDocumentErrorMessage(new ApiError(413, ''), 'x')).toBe('O PDF não pode ter mais de 2 MB.')
    expect(getDocumentErrorMessage(new ApiError(415, ''), 'x')).toBe('O ficheiro tem de ser um PDF válido.')
    expect(getDocumentErrorMessage(new ApiError(409, ''), 'x')).toBe('O anúncio já tem o máximo de 3 documentos.')
  })
})
