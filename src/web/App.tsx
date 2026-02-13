import './App.css'
import { ChatWindow } from './components/ChatWindow'
import { MessageInput } from './components/MessageInput'
import { ThemeToggle } from './components/ThemeToggle'
import { useService } from './hooks/useService'
import { useTheme } from './hooks/useTheme'

export default function App() {
  const { messages, isLoading, sendMessage } = useService()
  const { theme, toggleTheme } = useTheme()

  return (
    <>
      <header className="app-header">
        <div>
          <h1>Copilot SDK Service</h1>
          <p>Test your service. Try sending text to summarize.</p>
        </div>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </header>
      <div className="chat-container">
        <ChatWindow messages={messages} isStreaming={isLoading} />
        <MessageInput onSend={sendMessage} disabled={isLoading} />
      </div>
      <footer className="footer">
        Built with the <a href="https://github.com/github/copilot-sdk" target="_blank" rel="noopener noreferrer">Copilot SDK</a>
        {' · '}
        <a href="https://github.com/jongio/copilot-sdk-service" target="_blank" rel="noopener noreferrer">View on GitHub</a>
      </footer>
    </>
  )
}
