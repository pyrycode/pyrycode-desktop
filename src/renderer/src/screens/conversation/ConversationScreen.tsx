import './conversation.css'
import { placeholderMessages, type Message } from './placeholderMessages'

// The conversation shell: a scrollable message thread above a pinned composer,
// styled from the mobile Conversation Thread screen (Figma node 16-8) stretched
// to the window. Static this ticket — no store, no network, no input state.
//
// MessageThread and Composer are in-file for now: they are tiny and static. #12
// extracts MessageThread when it binds a store selector; #2 extracts Composer
// when it gains controlled input + a send dispatch. The load-bearing seams are
// the props/types below, not the file boundaries.
export function ConversationScreen(): JSX.Element {
  return (
    <div className="conversation">
      <MessageThread messages={placeholderMessages} />
      <Composer />
    </div>
  )
}

function MessageThread({ messages }: { messages: Message[] }): JSX.Element {
  // Seam for #12: swap this prop for a narrow store selector. An empty array
  // renders a valid (empty) scroll region — no crash, no placeholder fallback.
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
  // INERT this ticket: uncontrolled textarea (no onChange), inert send button
  // (no onClick). #2 wires controlled input state, auto-grow, and a send action.
  return (
    <div className="composer">
      <textarea className="composer__input" placeholder="Message…" rows={1} />
      <button type="button" className="composer__send" aria-label="Send">
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
