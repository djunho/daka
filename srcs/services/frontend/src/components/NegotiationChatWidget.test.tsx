import { StrictMode } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NegotiationChatWidget from './NegotiationChatWidget'
import { useNegotiationChat } from '../hooks/useNegotiationChat'
import { useUserPresence } from '../hooks/useUserPresence'
import { formatDate } from '../types/negotiation'
import type { UseNegotiationChatReturn } from '../hooks/useNegotiationChat'

vi.mock('../hooks/useNegotiationChat', () => ({
  useNegotiationChat: vi.fn(),
}))
vi.mock('../hooks/useUserPresence', () => ({
  useUserPresence: vi.fn(),
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
    isSending: false,
    confirmedSends: 0,
    incoming: { seq: 0, messages: [] },
    errorSeq: 0,
    errorIsNotice: false,
    historyFailed: false,
    retryHistory: vi.fn(),
    connectionRefused: false,
    olderFailed: false,
    hasOlder: false,
    isLoadingOlder: false,
    loadOlder: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('NegotiationChatWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useUserPresence).mockReturnValue(undefined)
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  it('renders header with interlocutor name, negotiation ID and action buttons', () => {
    const handleClose = vi.fn()
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())
    vi.mocked(useUserPresence).mockReturnValue(true)

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
        onClose={handleClose}
      />,
    )

    expect(useUserPresence).toHaveBeenCalledWith(10)
    expect(screen.getByRole('heading', { level: 3, name: 'Beatriz' })).toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.getByLabelText('Minimizar chat')).toBeInTheDocument()

    const closeBtn = screen.getByLabelText('Fechar chat')
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('shows no presence badge while the presence is unknown', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    // A dot would be a guess before the first poll answers (or when it fails)
    expect(screen.queryByText('Offline')).not.toBeInTheDocument()
    expect(screen.queryByText('Online')).not.toBeInTheDocument()
  })

  it('toggles minimize and expand modes', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
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
        interlocutorId={10}
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
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByText('Sem mensagens ainda')).toBeInTheDocument()
    expect(screen.getByText('Inicia a conversa com Beatriz!')).toBeInTheDocument()
  })

  it('shows a retry notice instead of the empty state when the history could not be loaded', () => {
    const retryHistory = vi.fn()
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ historyFailed: true, retryHistory }))

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('Não foi possível carregar as mensagens.')
    // Outside the live log: it holds a control and must not be read as a log addition
    expect(screen.getByRole('log')).not.toContainElement(notice)
    expect(notice).not.toHaveClass('sr-only')
    expect(screen.queryByText('Sem mensagens ainda')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(retryHistory).toHaveBeenCalledTimes(1)
  })

  it('shows neither the empty state nor a retry when the socket was refused', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({ status: 'disconnected', connectionRefused: true, error: 'Não tens permissão para participar nesta conversa ou a origem não é permitida.' }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.queryByText('Sem mensagens ainda')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/Não tens permissão/)
  })

  it('keeps the invitation on an empty thread when a send error is shown', () => {
    // Disconnected without a refusal (e.g. a normal close) and a send attempt failed
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({ status: 'disconnected', error: 'O chat não está ligado. Aguarda a reconexão e tenta novamente.' }),
    )
    render(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)

    expect(screen.getByText('Sem mensagens ainda')).toBeInTheDocument()
  })

  it('reports a failed older page and offers to try again', () => {
    const loadOlder = vi.fn().mockResolvedValue(undefined)
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({
        hasOlder: true,
        olderFailed: true,
        loadOlder,
        messages: [{ id: 30, negotiationId: 42, senderId: 10, content: 'Mais antiga carregada', createdAt: '2026-10-28T14:30:00Z', isOwn: false }],
      }),
    )
    render(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)

    // Announced from the status region, outside the live log
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('Não foi possível carregar as mensagens anteriores. Tenta novamente.')
    expect(screen.getByRole('log')).not.toContainElement(notice)
    fireEvent.click(screen.getByRole('button', { name: 'Ver mensagens anteriores' }))
    expect(loadOlder).toHaveBeenCalledTimes(1)
  })

  it('announces each error, the same one again included, and notices politely', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())
    const view = () => <NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />
    const { container, rerender } = render(view())
    const alert = screen.getByRole('alert')
    expect(alert).toBeEmptyDOMElement()

    const failed = 'Não foi possível guardar a mensagem. Tenta novamente.'
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ error: failed, errorSeq: 1 }))
    rerender(view())
    expect(screen.getByRole('alert')).toBe(alert)
    const first = alert.firstElementChild
    expect(alert).toHaveTextContent(failed)

    // The same failure again: a new node, so it is read again
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ error: failed, errorSeq: 2 }))
    rerender(view())
    expect(alert.firstElementChild).not.toBe(first)

    // A notice goes to the polite region, not the alert
    const notice = 'A mensagem foi guardada, mas não foi entregue em tempo real.'
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ error: notice, errorSeq: 3, errorIsNotice: true }))
    rerender(view())
    expect(alert).toBeEmptyDOMElement()
    const polite = Array.from(container.querySelectorAll('[aria-live="polite"]')).find((el) => el.textContent === notice)
    expect(polite).toBeDefined()
  })

  it('does not invite to start a conversation in an empty read-only chat', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ isReadOnly: true }))
    render(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" isReadOnly />)

    expect(screen.getByText('Sem mensagens nesta negociação')).toBeInTheDocument()
    expect(screen.queryByText(/Inicia a conversa/)).not.toBeInTheDocument()
  })

  it('gives the composer a fixed accessible name', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ status: 'connecting' }))
    render(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toBeInTheDocument()
  })

  it('keeps the status region mounted and empty while the history is fine', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    // Announced on change only if it already exists in the accessibility tree
    const region = screen.getByRole('status')
    expect(region).toBeEmptyDOMElement()
    expect(region).toHaveClass('sr-only')
  })

  it('keeps the retry notice above live messages that arrived without history', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({
        historyFailed: true,
        isLoadingHistory: true,
        messages: [
          { id: 7, negotiationId: 42, senderId: 10, content: 'Chegou ao vivo', createdAt: '2026-10-28T14:30:00Z', isOwn: false },
        ],
      }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByText('Chegou ao vivo')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    // The hook keeps historyFailed during a retry, so the notice stays and the button locks
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeDisabled()
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
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByText('Primeira mensagem recebida')).toBeInTheDocument()
    expect(screen.getByText('Minha resposta enviada')).toBeInTheDocument()
    // Both on the same day: a single day separator above the first one
    expect(screen.getAllByText(formatDate('2026-10-28T14:30:00Z'))).toHaveLength(1)
  })

  it('separates messages from different days with the date', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({
        messages: [
          { id: 1, negotiationId: 42, senderId: 10, content: 'De ontem', createdAt: '2026-10-27T14:30:00Z', isOwn: false },
          { id: 2, negotiationId: 42, senderId: 1, content: 'De hoje', createdAt: '2026-10-28T14:31:00Z', isOwn: true },
          { id: 3, negotiationId: 42, senderId: 10, content: 'Também de hoje', createdAt: '2026-10-28T15:00:00Z', isOwn: false },
        ],
      }),
    )

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByText(formatDate('2026-10-27T14:30:00Z'))).toBeInTheDocument()
    expect(screen.getAllByText(formatDate('2026-10-28T14:31:00Z'))).toHaveLength(1)
  })

  it('offers to load older messages only while the server has more', () => {
    const loadOlder = vi.fn().mockResolvedValue(undefined)
    const thread = [
      { id: 30, negotiationId: 42, senderId: 10, content: 'Mais antiga carregada', createdAt: '2026-10-28T14:30:00Z', isOwn: false },
    ]
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ messages: thread, hasOlder: true, loadOlder }))

    const { rerender } = render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Ver mensagens anteriores' }))
    expect(loadOlder).toHaveBeenCalledTimes(1)

    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ messages: thread, hasOlder: true, isLoadingOlder: true, loadOlder }))
    rerender(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)
    expect(screen.getByRole('button', { name: 'A carregar…' })).toBeDisabled()

    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ messages: thread, hasOlder: false, loadOlder }))
    rerender(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)
    expect(screen.queryByRole('button', { name: 'Ver mensagens anteriores' })).not.toBeInTheDocument()
  })

  it('submits text and clears the composer only once the server confirms it', () => {
    const sendMessage = vi.fn().mockReturnValue(true)
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage }))

    const { rerender } = render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
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

    // Submit message: the text stays while the server has not answered
    fireEvent.click(submitBtn)
    expect(sendMessage).toHaveBeenCalledWith('Boa tarde!')
    expect(input).toHaveValue('Boa tarde!')

    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage, isSending: true }))
    rerender(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)
    expect(screen.getByRole('button', { name: 'A enviar…' })).toHaveAttribute('aria-disabled', 'true')

    // Confirmed by message.created
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage, confirmedSends: 1 }))
    rerender(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)
    expect(input).toHaveValue('')
  })

  it('keeps the text when the server rejects the send, and keeps a draft edited meanwhile', () => {
    const sendMessage = vi.fn().mockReturnValue(true)
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage }))
    const { rerender } = render(
      <NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />,
    )
    const input = screen.getByPlaceholderText('Escreve uma mensagem...')

    // Rejected (e.g. rate_limited): no confirmation, the text stays for a retry
    fireEvent.change(input, { target: { value: 'Posso passar amanhã?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage, error: 'Demasiadas mensagens enviadas.' }))
    rerender(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)
    expect(input).toHaveValue('Posso passar amanhã?')

    // Sent again, then edited before the confirmation: the new draft is kept
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage }))
    rerender(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    fireEvent.change(input, { target: { value: 'Outra coisa' } })
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage, confirmedSends: 1 }))
    rerender(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)
    expect(input).toHaveValue('Outra coisa')
  })

  it('counts the limit on the trimmed text, like the backend', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())
    render(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />)

    fireEvent.change(screen.getByPlaceholderText('Escreve uma mensagem...'), { target: { value: `${'a'.repeat(250)} ` } })
    expect(screen.getByText('250/250')).not.toHaveClass('text-accent')
    expect(screen.getByRole('button', { name: 'Enviar' })).not.toBeDisabled()
  })

  it('keeps send button disabled when input contains only whitespace', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
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
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    // Read-only rather than disabled, so a focused input keeps the focus
    const input = screen.getByPlaceholderText('Chat desligado')
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  })

  it('keeps the keyboard focus in the composer while the chat reconnects', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())
    const view = () => <NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />
    const { rerender } = render(view())
    const input = screen.getByRole('textbox', { name: 'Mensagem' })
    input.focus()

    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ status: 'connecting' }))
    rerender(view())
    // A disabled control would drop the focus in a browser (jsdom does not), so
    // the guarantee is that it is read-only, not disabled
    expect(input).not.toBeDisabled()
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAttribute('aria-disabled', 'true')
    expect(document.activeElement).toBe(input)
  })

  it('keeps the focus on "Enviar" while the send is in flight', () => {
    const sendMessage = vi.fn().mockReturnValue(true)
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage }))
    const view = () => <NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />
    const { rerender } = render(view())
    fireEvent.change(screen.getByRole('textbox', { name: 'Mensagem' }), { target: { value: 'Olá' } })
    const button = screen.getByRole('button', { name: 'Enviar' })
    button.focus()
    fireEvent.click(button)

    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ sendMessage, isSending: true }))
    rerender(view())
    // aria-disabled, not disabled: a disabled button would drop the focus in a browser
    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(document.activeElement).toBe(button)
    // Pressing it again while in flight does nothing
    fireEvent.click(button)
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })

  it('treats a socket error like a disconnect', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ status: 'error' }))

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByPlaceholderText('Chat desligado')).toHaveAttribute('readonly')
  })

  it('lets text exceed the limit and flags it instead of truncating with maxLength', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    const input = screen.getByPlaceholderText('Escreve uma mensagem...')
    // maxLength counts UTF-16 units (an emoji is 2), so it would block or truncate this
    expect(input).not.toHaveAttribute('maxlength')

    fireEvent.change(input, { target: { value: '😀'.repeat(251) } })
    expect(screen.getByText('251/250')).toHaveClass('text-accent')
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
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/Demasiadas mensagens enviadas\./)

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
        interlocutorId={10}
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
        interlocutorId={10}
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
        interlocutorId={10}
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
        interlocutorId={10}
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
        interlocutorId={10}
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

  it('does not read the thread aloud in bulk: the log is not a live region', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    const logRegion = screen.getByRole('log', { name: 'Mensagens da negociação #42' })
    expect(logRegion).toHaveAttribute('aria-live', 'off')
  })

  it('announces each batch of new messages from the other person, repeated text included', () => {
    const msg = (id: number, content: string) => ({ id, negotiationId: 42, senderId: 10, content, createdAt: '2026-10-28T14:30:00Z', isOwn: false })
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())
    const view = () => <NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" />
    const { container, rerender } = render(view())
    const announcer = container.querySelector('[aria-live="polite"]') as HTMLElement
    // Nothing new yet (also: nothing from the history is announced)
    expect(announcer).toBeEmptyDOMElement()

    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ messages: [msg(5, 'Ok')], incoming: { seq: 1, messages: [msg(5, 'Ok')] } }))
    rerender(view())
    const first = announcer.firstElementChild
    expect(announcer).toHaveTextContent('Nova mensagem de Beatriz: Ok')

    // Same text again: a new node, so screen readers read it again
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat({ messages: [msg(5, 'Ok'), msg(6, 'Ok')], incoming: { seq: 2, messages: [msg(6, 'Ok')] } }))
    rerender(view())
    expect(announcer).toHaveTextContent('Nova mensagem de Beatriz: Ok')
    expect(announcer.firstElementChild).not.toBe(first)

    // Several at once (a reconnect backfill)
    vi.mocked(useNegotiationChat).mockReturnValue(
      mockChat({ incoming: { seq: 3, messages: [msg(7, 'Ainda tens?'), msg(8, 'Diz-me algo')] } }),
    )
    rerender(view())
    expect(announcer).toHaveTextContent('2 novas mensagens de Beatriz. A última: Diz-me algo')
  })

  it.each([false, true])('takes the focus and gives it back to its opener on close (StrictMode: %s)', (strict) => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())
    const opener = document.createElement('button')
    opener.textContent = 'Conversar'
    document.body.appendChild(opener)
    try {
      opener.focus()
      const onClose = vi.fn()
      const widget = <NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" onClose={onClose} />
      render(strict ? <StrictMode>{widget}</StrictMode> : widget)
      expect(document.activeElement).toBe(screen.getByRole('complementary', { name: 'Chat da negociação #42' }))

      fireEvent.click(screen.getByLabelText('Fechar chat'))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(opener)
    } finally {
      opener.remove()
    }
  })

  it('gives the focus to the dock trigger on close when its opener is gone', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())
    const trigger = document.createElement('button')
    trigger.id = 'negotiations-dock-trigger'
    const card = document.createElement('button')
    document.body.append(trigger, card)
    try {
      card.focus()
      render(<NegotiationChatWidget negotiationId={42} interlocutorId={10} interlocutorName="Beatriz" onClose={vi.fn()} />)
      // The drawer collapsed: the card that opened the chat no longer exists
      card.remove()
      fireEvent.click(screen.getByLabelText('Fechar chat'))
      expect(document.activeElement).toBe(trigger)
    } finally {
      trigger.remove()
      card.remove()
    }
  })

  it('keeps the message thread selectable so users can copy text', () => {
    vi.mocked(useNegotiationChat).mockReturnValue(mockChat())

    render(
      <NegotiationChatWidget
        negotiationId={42}
        interlocutorId={10}
        interlocutorName="Beatriz"
      />,
    )

    // user-select is inherited: a select-none on the root would block copying messages
    const widget = screen.getByRole('complementary', { name: 'Chat da negociação #42' })
    expect(widget).not.toHaveClass('select-none')
    expect(screen.getByRole('log')).not.toHaveClass('select-none')
  })
})
