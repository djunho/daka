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
  const userId = user?.id ?? null
  // The chat remembers which account opened it. It is shown only while that
  // account is the current one, decided during render: the AuthContext
  // heartbeat can swap in another account (signed in from another tab)
  // without a null in between, and an effect would clear the chat one commit
  // too late, after the widget had already rendered and refetched as the new
  // account. Profile updates keep the id, so they do not close it.
  const [state, setState] = useState<{ chat: ActiveChat; ownerId: number | null } | null>(null)
  const activeChat = state && state.ownerId === userId ? state.chat : null

  // Drop a chat that belongs to a previous account, so it cannot come back
  // if that account signs in again later.
  useEffect(() => {
    if (state && state.ownerId !== userId) setState(null)
  }, [state, userId])

  // A read-only lock is one-way: re-opening the same negotiation from an
  // older list (the dock, a stale page) never makes it writable again, since
  // closed negotiations never reopen.
  const openChat = useCallback((negotiationId: number, interlocutor: ChatInterlocutor, isReadOnly?: boolean) => {
    setState((previous) => {
      const sameChat = previous?.ownerId === userId && previous.chat.negotiationId === negotiationId
      return {
        ownerId: userId,
        chat: {
          negotiationId,
          interlocutorId: interlocutor.id,
          interlocutorName: interlocutor.user_name,
          isReadOnly: Boolean(isReadOnly) || (sameChat && Boolean(previous.chat.isReadOnly)),
        },
      }
    })
  }, [userId])

  const closeChat = useCallback(() => {
    setState(null)
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
