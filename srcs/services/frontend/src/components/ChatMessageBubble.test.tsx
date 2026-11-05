import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChatMessageBubble from './ChatMessageBubble'

describe('ChatMessageBubble', () => {
  it('renders own message aligned to the right with brand styling and no sender name', () => {
    const { container } = render(
      <ChatMessageBubble
        content="Olá, ainda tens o livro?"
        createdAt="2026-10-28T14:30:00Z"
        isOwn={true}
        senderName="Daniel"
      />,
    )

    expect(screen.getByText('Olá, ainda tens o livro?')).toBeInTheDocument()
    // Should NOT show sender name for own messages
    expect(screen.queryByText('Daniel')).not.toBeInTheDocument()

    // Outer container has right alignment
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('items-end', 'self-end')

    // Bubble has brand styling
    const bubble = screen.getByText('Olá, ainda tens o livro?')
    expect(bubble).toHaveClass('bg-brand', 'text-white')
  })

  it('renders incoming message aligned to the left with interlocutor name and neutral styling', () => {
    const { container } = render(
      <ChatMessageBubble
        content="Sim, está disponível para troca!"
        createdAt="2026-10-28T14:32:00Z"
        isOwn={false}
        senderName="Beatriz"
      />,
    )

    expect(screen.getByText('Sim, está disponível para troca!')).toBeInTheDocument()
    expect(screen.getByText('Beatriz')).toBeInTheDocument()

    // Outer container has left alignment
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('items-start')

    // Bubble has surface neutral styling
    const bubble = screen.getByText('Sim, está disponível para troca!')
    expect(bubble).toHaveClass('bg-surface', 'border', 'border-line', 'text-ink')
  })

  it('supports pre-formatted HH:mm time and fallback on invalid date', () => {
    render(
      <ChatMessageBubble
        content="Mensagem com hora HH:mm"
        createdAt="15:45"
        isOwn={true}
      />,
    )
    expect(screen.getByText('15:45')).toBeInTheDocument()

    render(
      <ChatMessageBubble
        content="Mensagem com data inválida"
        createdAt="data-invalida"
        isOwn={false}
      />,
    )
    expect(screen.getByText('data-invalida')).toBeInTheDocument()
  })
})
