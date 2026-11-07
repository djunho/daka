import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import UploadProgress from './UploadProgress'

describe('UploadProgress', () => {
  it('shows how much has been sent, as a labelled progress bar', () => {
    render(<UploadProgress label="A enviar documento 1 de 2" fraction={0.456} />)

    const bar = screen.getByRole('progressbar', { name: 'A enviar documento 1 de 2' })
    expect(bar).toHaveAttribute('aria-valuenow', '46')
    expect(screen.getByText('46%')).toBeInTheDocument()
  })

  it('says it is processing once every byte has left the browser', () => {
    render(<UploadProgress label="A enviar a foto de perfil" fraction={1} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'A processar…')
    expect(screen.getByRole('status')).toHaveTextContent('A enviar a foto de perfil: a processar…')
  })

  it('announces the file, not every percentage', () => {
    const { rerender } = render(<UploadProgress label="A enviar fotografia 1 de 3" fraction={0.1} />)
    rerender(<UploadProgress label="A enviar fotografia 1 de 3" fraction={0.7} />)

    expect(screen.getByRole('status')).toHaveTextContent(/^A enviar fotografia 1 de 3$/)
  })
})
