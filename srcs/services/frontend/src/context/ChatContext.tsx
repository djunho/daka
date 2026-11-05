import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

export interface ActiveChat {
  negotiationId: number
  interlocutorName: string
  isReadOnly?: boolean
}

interface ChatContextType {
  activeChat: ActiveChat | null
  openChat: (negotiationId: number, interlocutorName: string, isReadOnly?: boolean) => void
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

  const openChat = (negotiationId: number, interlocutorName: string, isReadOnly?: boolean) => {
    setActiveChat({
      negotiationId,
      interlocutorName,
      isReadOnly,
    })
  }

  const closeChat = () => {
    setActiveChat(null)
  }

  const isChatOpen = (negotiationId: number) => {
    return activeChat?.negotiationId === negotiationId
  }

  return (
    <ChatContext.Provider
      value={{
        activeChat,
        openChat,
        closeChat,
        isChatOpen,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChat(): ChatContextType {
  return useContext(ChatContext)
}
