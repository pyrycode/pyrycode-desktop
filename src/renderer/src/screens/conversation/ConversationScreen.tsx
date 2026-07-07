import { useState, type KeyboardEvent } from 'react'
import './conversation.css'
import { toMessageViewModel, type Message } from './messageViewModel'
import { useSessionStore, selectMessages } from '../../store/sessionStore'
import { submitMessage } from './composerSend'

// The conversation shell: a scrollable message thread above a pinned composer,
// styled from the mobile Conversation Thread screen (Figma node 16-8) stretched
// to the window. The thread now reads the live session store (#69); the composer
// stays inert (controlled input + send dispatch are #66).
//
// ConversationScreen is the store-bound container (smoke-tested for "renders without
// throwing"); MessageThread is the pure, props-in/markup-out view that the tests
// server-render with arbitrary Message[] — the same container/view split PairingScreen
// uses. Composer stays in-file. The load-bearing seam is the MessageThread prop.
export function ConversationScreen(): JSX.Element {
  // Read the messages slice and adapt each wire MessagePayload to the shell view model
  // at this boundary (ADR 0004). Selecting only the messages slice keeps connection-status
  // changes from re-rendering the thread.
  const messages = useSessionStore(selectMessages).map(toMessageViewModel)
  return (
    <div className="conversation">
      <MessageThread messages={messages} />
      <Composer />
    </div>
  )
}

export function MessageThread({ messages }: { messages: Message[] }): JSX.Element {
  // Renders the adapted messages in arrival order. An empty array renders a valid
  // (empty) scroll region — no crash, no placeholder fallback.
  return (
    <div className="conversation__thread">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  )
}

function MessageBubble({ message }: { message: Message }): JSX.Element {
  return (
    <div className={`message-row message-row--${message.type}`}>
      <div className={`bubble bubble--${message.type}`} data-message-role={message.type}>
        {message.text}
      </div>
    </div>
  )
}

function Composer(): JSX.Element {
  // Thin controlled container over composerSend.submitMessage (the pairing container/pure-logic
  // split). Input text is ephemeral single-value screen-local state → useState, never the store
  // (ADR 0006). `dispatch` identity is stable, so selecting it adds no re-render churn.
  const [text, setText] = useState('')
  const dispatch = useSessionStore((s) => s.dispatch)

  const handleSubmit = (): void => {
    // `window.pyry` is dereferenced only here, at interaction time — never during render — so the
    // server-rendered container smoke test never touches the bridge.
    const sent = submitMessage(text, {
      sendCommand: window.pyry.sendCommand,
      dispatch,
      newMessageId: () => crypto.randomUUID()
    })
    if (sent) setText('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends; Shift+Enter inserts a newline.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="composer">
      <textarea
        className="composer__input"
        placeholder="Message…"
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button type="button" className="composer__send" aria-label="Send" onClick={handleSubmit}>
        <svg
          className="composer__send-icon"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8z" />
        </svg>
      </button>
    </div>
  )
}
