import { memo, useState } from 'react'
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

  it('dismisses the active chat on logout', () => {
    const { rerender } = render(<App />)
    fireEvent.click(screen.getByText('abrir'))
    expect(screen.getByTestId('active')).toHaveTextContent('7:2:Bruno:true')

    setUser(null)
    rerender(<App />)
    expect(screen.getByTestId('active')).toHaveTextContent('none')
  })
})
