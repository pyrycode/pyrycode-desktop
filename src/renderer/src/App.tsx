import { ConversationScreen } from './screens/conversation/ConversationScreen'
import { useDaemonEventBridge } from './store/daemonEventBridge'

function App(): JSX.Element {
  useDaemonEventBridge()
  return <ConversationScreen />
}

export default App
