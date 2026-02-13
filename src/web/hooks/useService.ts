import { useState } from 'react'
import type { Message } from '../types'

export function useService() {
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const sendMessage = async (text: string) => {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' }
    setMessages(prev => [...prev, assistantMsg])

    try {
      const res = await fetch('/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`)
      }

      const data = await res.json()
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, content: data.summary ?? '(empty response)' } : m),
      )
    } catch (err) {
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? {
          ...m,
          role: 'error',
          content: err instanceof Error ? err.message : 'Unknown error',
        } : m),
      )
    } finally {
      setIsLoading(false)
    }
  }

  return { messages, isLoading, sendMessage }
}
