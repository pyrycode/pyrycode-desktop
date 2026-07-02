import { NOISE_PROTOCOL } from '@shared/wire/types'

function App(): JSX.Element {
  return (
    <div className="app">
      <h1>Pyrycode Desktop</h1>
      <p>Desktop remote head for the pyry daemon. Skeleton only.</p>
      <p className="muted">Handshake target: {NOISE_PROTOCOL}</p>
    </div>
  )
}

export default App
