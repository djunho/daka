import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import MessageCard from './MessageCard'

describe('MessageCard', () => {
  it('shows the title as the page heading, the text and the action', () => {
    render(<MessageCard title="Anúncio não encontrado" text="Não existe." action={<a href="/">Voltar ao início</a>} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Anúncio não encontrado' })).toBeInTheDocument()
    expect(screen.getByText('Não existe.')).not.toHaveAttribute('role')
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toBeInTheDocument()
  })

  it('announces an error and has no heading without a title', () => {
    render(<MessageCard alert text="Falhou." action={<button type="button">Tentar outra vez</button>} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Falhou.')
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar outra vez' })).toBeInTheDocument()
  })
})
