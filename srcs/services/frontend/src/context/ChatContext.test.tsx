import { memo, useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ChatProvider, useChat } from './ChatContext'
import { useAuth } from './AuthContext'

vi.mock('./AuthContext', () => ({ useAuth: vi.fn() }))

const USER = { id: 1, user_name: 'Ana', email: 'a@x.io', avatar: null, user_location: null, is_online: false, created_at: '' }

function setUser(user: typeof USER | null) {
  vi.mocked(useAuth).mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>)
}

const consumerRenders = vi.fn()

// memo: re-renders only when the context value changes
const Consumer = memo(function Consumer() {
  const { activeChat, openChat, closeChat, isChatOpen } = useChat()
  consumerRenders()
  return (
    <div>
      <span data-testid="active">
        {activeChat ? `${activeChat.negotiationId}:${activeChat.interlocutorId}:${activeChat.interlocutorName}:${String(activeChat.isReadOnly)}` : 'none'}
      </span>
      <span data-testid="open7">{String(isChatOpen(7))}</span>
      <button onClick={() => openChat(7, { id: 2, user_name: 'Bruno' }, true)}>abrir</button>
      <button onClick={() => openChat(7, { id: 2, user_name: 'Bruno' }, false)}>abrir-escrita</button>
      <button onClick={() => openChat(8, { id: 3, user_name: 'Carla' }, false)}>abrir-outra</button>
      <button onClick={closeChat}>fechar</button>
    </div>
  )
})

function App() {
  const [count, setCount] = useState(0)
  return (
    <ChatProvider>
      <button onClick={() => setCount(count + 1)}>parent {count}</button>
      <Consumer />
    </ChatProvider>
  )
}

describe('ChatProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setUser(USER)
  })

  it('opens, reports and closes the active chat', () => {
    render(<App />)
    expect(screen.getByTestId('active')).toHaveTextContent('none')
    expect(screen.getByTestId('open7')).toHaveTextContent('false')

    fireEvent.click(screen.getByText('abrir'))
    expect(screen.getByTestId('active')).toHaveTextContent('7:2:Bruno:true')
    expect(screen.getByTestId('open7')).toHaveTextContent('true')

    fireEvent.click(screen.getByText('fechar'))
    expect(screen.getByTestId('active')).toHaveTextContent('none')
  })

  it('does not re-render consumers when the provider re-renders for unrelated reasons', () => {
    render(<App />)
    const before = consumerRenders.mock.calls.length

    fireEvent.click(screen.getByText(/parent/))
    fireEvent.click(screen.getByText(/parent/))

    expect(consumerRenders.mock.calls.length).toBe(before)
  })

  it('keeps a read-only lock when the same negotiation is reopened as writable', () => {
    render(<App />)
    fireEvent.click(screen.getByText('abrir'))
    fireEvent.click(screen.getByText('abrir-escrita'))
    expect(screen.getByTestId('active')).toHaveTextContent('7:2:Bruno:true')

    // Another negotiation starts from its own state
    fireEvent.click(screen.getByText('abrir-outra'))
    expect(screen.getByTestId('active')).toHaveTextContent('8:3:Carla:false')
  })

  it('dismisses the active chat when another account takes over without a logout', () => {
    const { rerender } = render(<App />)
    fireEvent.click(screen.getByText('abrir'))
    expect(screen.getByTestId('active')).toHaveTextContent('7:2:Bruno:true')

    // A profile update keeps the account: the chat stays
    setUser({ ...USER, user_name: 'Ana Maria' })
    rerender(<App />)
    expect(screen.getByTestId('active')).toHaveTextContent('7:2:Bruno:true')

    // Another account signed in from another tab, picked up by the heartbeat
    setUser({ ...USER, id: 2, user_name: 'Bruno', email: 'b@x.io' })
    rerender(<App />)
    expect(screen.getByTestId('active')).toHaveTextContent('none')
  })

  it('never renders the previous account\'s chat, not even for one commit', () => {
    // Records what each committed render saw
    const seen: string[] = []
    function Probe() {
      const { activeChat } = useChat()
      const { user } = useAuth()
      useEffect(() => {
        seen.push(`${user?.id}:${activeChat?.negotiationId ?? 'none'}`)
      })
      return null
    }
    const tree = () => (
      <ChatProvider>
        <Consumer />
        <Probe />
      </ChatProvider>
    )
    const { rerender } = render(tree())
    fireEvent.click(screen.getByText('abrir'))
    seen.length = 0

    setUser({ ...USER, id: 2, user_name: 'Bruno', email: 'b@x.io' })
    rerender(tree())
    expect(seen).not.toContain('2:7')
    expect(seen).toContain('2:none')
  })

  it('dismisses the active chat on logout', () => {
    const { rerender } = render(<App />)
    fireEvent.click(screen.getByText('abrir'))
    expect(screen.getByTestId('active')).toHaveTextContent('7:2:Bruno:true')

    setUser(null)
    rerender(<App />)
    expect(screen.getByTestId('active')).toHaveTextContent('none')
  })
})
