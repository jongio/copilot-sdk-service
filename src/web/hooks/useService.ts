import { useState, useRef } from 'react'
import type { Message } from '../types'

export function useService() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const messagesRef = useRef<Message[]>([])

  const sendMessage = async (text: string) => {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' }

    messagesRef.current = [...messagesRef.current, userMsg, assistantMsg]
    setMessages([...messagesRef.current])
    setIsLoading(true)

    // Build history from previous messages (exclude current)
    const history = messagesRef.current
      .filter(m => m.id !== assistantId && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({ role: m.role, content: m.content }))
    // Remove last entry (it's the current user message, we pass it as `message`)
    history.pop()

    try {
      const res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.length > 0 ? history : undefined }),
      })

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let content = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                if (parsed.content) {
                  content += parsed.content
                  messagesRef.current = messagesRef.current.map(m =>
                    m.id === assistantId ? { ...m, content } : m,
                  )
                  setMessages([...messagesRef.current])
                }
              } catch {
                // skip malformed lines
              }
            } else if (line.startsWith('event: error')) {
              // Next data line has the error
            }
          }
        }
      }

      // If no content was streamed, set a fallback
      if (!content) {
        messagesRef.current = messagesRef.current.map(m =>
          m.id === assistantId ? { ...m, content: '(empty response)' } : m,
        )
        setMessages([...messagesRef.current])
      }
    } catch (err) {
      messagesRef.current = messagesRef.current.map(m =>
        m.id === assistantId ? {
          ...m,
          role: 'error' as const,
          content: err instanceof Error ? err.message : 'Unknown error',
        } : m,
      )
      setMessages([...messagesRef.current])
    } finally {
      setIsLoading(false)
    }
  }

  return { messages, isLoading, sendMessage }
}
