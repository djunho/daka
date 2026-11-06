import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

export interface ActiveChat {
  negotiationId: number
  interlocutorId: number
  interlocutorName: string
  isReadOnly?: boolean
}

// The other participant, as any ApiPublicUser (owner, interested user, other_participant).
export interface ChatInterlocutor {
  id: number
  user_name: string
}

interface ChatContextType {
  activeChat: ActiveChat | null
  openChat: (negotiationId: number, interlocutor: ChatInterlocutor, isReadOnly?: boolean) => void
  closeChat: () => void
  isChatOpen: (negotiationId: number) => boolean
}

const defaultContext: ChatContextType = {
  activeChat: null,
  openChat: () => {},
  closeChat: () => {},
  isChatOpen: () => false,
}

const ChatContext = createContext<ChatContextType>(defaultContext)

/**
 * Global Chat Context:
 * Manages the floating docked chat widget state across page transitions.
 * When a user opens a chat in /negotiations/:id or the dock, the widget stays docked
 * at the bottom-right corner even if the user navigates to the home feed,
 * a listing page, or their profile.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null)

  // Whenever the user logs out, dismiss any active chat
  useEffect(() => {
    if (!user) {
      setActiveChat(null)
    }
  }, [user])

  const openChat = useCallback((negotiationId: number, interlocutor: ChatInterlocutor, isReadOnly?: boolean) => {
    setActiveChat({
      negotiationId,
      interlocutorId: interlocutor.id,
      interlocutorName: interlocutor.user_name,
      isReadOnly,
    })
  }, [])

  const closeChat = useCallback(() => {
    setActiveChat(null)
  }, [])

  const isChatOpen = useCallback((negotiationId: number) => {
    return activeChat?.negotiationId === negotiationId
  }, [activeChat])

  // A stable value: the provider re-renders with AuthProvider (heartbeat,
  // profile updates) and every useChat() consumer would re-render with it.
  const value = useMemo(
    () => ({ activeChat, openChat, closeChat, isChatOpen }),
    [activeChat, openChat, closeChat, isChatOpen],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatContextType {
  return useContext(ChatContext)
}
