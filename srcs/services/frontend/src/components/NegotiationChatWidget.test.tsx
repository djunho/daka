import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NegotiationChatWidget from './NegotiationChatWidget'
import { useNegotiationChat } from '../hooks/useNegotiationChat'
import type { UseNegotiationChatReturn } from '../hooks/useNegotiationChat'

vi.mock('../hooks/useNegotiationChat', () => ({
  useNegotiationChat: vi.fn(),
}))

function mockChat(overrides: Partial<UseNegotiationChatReturn> = {}): UseNegotiationChatReturn {
  return {
    messages: [],
    status: 'connected',
    isLoadingHistory: false,
    isReadOnly: false,
    error: null,
    clearError: vi.fn(),
    sendMessage: vi.fn().mockReturnValue(true),
    ...overrides,
  }
}

describe('NegotiationChatWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('renders header with interlocutor name, negotiation ID and action buttons', () => {
    const handleClose = vi.fn()
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
        interlocutorOnline={true}
        onClose={handleClose}
      />,
    )

    expect(screen.getByRole('heading', { level: 3, name: 'Beatriz' })).toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(screen.getByLabelText('Minimizar chat')).toBeInTheDocument()

    const closeBtn = screen.getByLabelText('Fechar chat')
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('toggles minimize and expand modes', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
      />,
    )

    // Body is visible by default
    expect(screen.getByPlaceholderText('Escreve uma mensagem...')).toBeInTheDocument()

    // Minimize
    const toggleBtn = screen.getByLabelText('Minimizar chat')
    fireEvent.click(toggleBtn)

    expect(screen.queryByPlaceholderText('Escreve uma mensagem...')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Expandir chat')).toBeInTheDocument()

    // Expand
    fireEvent.click(screen.getByLabelText('Expandir chat'))
    expect(screen.getByPlaceholderText('Escreve uma mensagem...')).toBeInTheDocument()
  })

  it('shows loading spinner when history is loading and there are no messages', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({ isLoadingHistory: true, messages: [] }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByText('A carregar mensagens...')).toBeInTheDocument()
  })

  it('shows empty state placeholder when history loaded with zero messages', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({ isLoadingHistory: false, messages: [] }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByText('Sem mensagens ainda')).toBeInTheDocument()
    expect(screen.getByText('Inicia a conversa com Beatriz!')).toBeInTheDocument()
  })

  it('renders messages thread correctly', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({
        messages: [
          {
            id: 1,
            negotiationId: 42,
            senderId: 10,
            content: 'Primeira mensagem recebida',
            createdAt: '2026-10-28T14:30:00Z',
            isOwn: false,
          },
          {
            id: 2,
            negotiationId: 42,
            senderId: 1,
            content: 'Minha resposta enviada',
            createdAt: '2026-10-28T14:31:00Z',
            isOwn: true,
          },
        ],
      }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByText('Primeira mensagem recebida')).toBeInTheDocument()
    expect(screen.getByText('Minha resposta enviada')).toBeInTheDocument()
  })

  it('submits text and resets input on send', () => {
    const sendMessage = vi.fn().mockReturnValue(true)
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage }))

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
      />,
    )

    const input = screen.getByPlaceholderText('Escreve uma mensagem...')
    const submitBtn = screen.getByRole('button', { name: 'Enviar' })

    // Initially empty -> send button is disabled
    expect(submitBtn).toBeDisabled()

    // Type a message
    fireEvent.change(input, { target: { value: 'Boa tarde!' } })
    expect(screen.getByText('10/250')).toBeInTheDocument()
    expect(submitBtn).not.toBeDisabled()

    // Submit message
    fireEvent.click(submitBtn)
    expect(sendMessage).toHaveBeenCalledWith('Boa tarde!')
    expect(input).toHaveValue('')
  })

  it('keeps send button disabled when input contains only whitespace', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
      />,
    )

    const input = screen.getByPlaceholderText('Escreve uma mensagem...')
    const submitBtn = screen.getByRole('button', { name: 'Enviar' })

    fireEvent.change(input, { target: { value: '    \t   ' } })
    expect(submitBtn).toBeDisabled()
  })

  it('disables input and send button when chat is disconnected', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({ status: 'disconnected' }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
      />,
    )

    const input = screen.getByPlaceholderText('Chat desconectado')
    expect(input).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  })

  it('displays error banner and clears it manually or when typing', () => {
    const clearError = vi.fn()
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({ error: 'Demasiadas mensagens enviadas.', clearError }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByText(/Demasiadas mensagens enviadas\./)).toBeInTheDocument()

    // Manual dismiss button
    const dismissBtn = screen.getByLabelText('Dispensar aviso de erro')
    fireEvent.click(dismissBtn)
    expect(clearError).toHaveBeenCalledTimes(1)

    // Typing into input also triggers clearError
    const input = screen.getByPlaceholderText('Escreve uma mensagem...')
    fireEvent.change(input, { target: { value: 'x' } })
    expect(clearError).toHaveBeenCalledTimes(2)
  })

  it('locks chat in read-only mode for concluded or cancelled negotiations', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({ isReadOnly: true }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
        isReadOnly={true}
      />,
    )

    const input = screen.getByPlaceholderText('Negociação encerrada (modo de leitura)')
    expect(input).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
    expect(screen.getByText('Chat em modo de leitura')).toBeInTheDocument()
    expect(screen.queryByText(/\/250/)).not.toBeInTheDocument()
  })

  it('preserves existing messages thread while in read-only mode', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({
        isReadOnly: true,
        messages: [
          {
            id: 1,
            negotiationId: 42,
            senderId: 10,
            content: 'Mensagem de negociação concluída',
            createdAt: '2026-10-28T14:30:00Z',
            isOwn: false,
          },
        ],
      }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
        isReadOnly={true}
      />,
    )

    // History is still visible and readable
    expect(screen.getByText('Mensagem de negociação concluída')).toBeInTheDocument()
    // But input remains locked
    expect(screen.getByPlaceholderText('Negociação encerrada (modo de leitura)')).toBeDisabled()
  })

  it('switches to read-only dynamically on prop update (rerender)', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ isReadOnly: false }))

    const { rerender } = render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
        isReadOnly={false}
      />,
    )

    expect(screen.getByPlaceholderText('Escreve uma mensagem...')).not.toBeDisabled()

    // Negotiation concluded while chat was open -> mock hook updates to read-only
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ isReadOnly: true }))

    rerender(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
        isReadOnly={true}
      />,
    )

    expect(screen.getByPlaceholderText('Negociação encerrada (modo de leitura)')).toBeDisabled()
    expect(screen.getByText('Chat em modo de leitura')).toBeInTheDocument()
  })

  it('guards form submission so sendMessage is never called when read-only', () => {
    const sendMessage = vi.fn()
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({ isReadOnly: true, sendMessage }),
    )

    const { container } = render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
        isReadOnly={true}
      />,
    )

    const form = container.querySelector('form')
    expect(form).not.toBeNull()

    // Try submitting the form
    if (form) {
      fireEvent.submit(form)
    }

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('renders messages thread with accessibility role="log" and aria-live="polite"', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorName="Beatriz"
      />,
    )

    const logRegion = screen.getByRole('log', { name: 'Mensagens da negociação #42' })
    expect(logRegion).toBeInTheDocument()
    expect(logRegion).toHaveAttribute('aria-live', 'polite')
    expect(logRegion).toHaveAttribute('aria-relevant', 'additions text')
  })
})
