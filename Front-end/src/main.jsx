import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import StartupGate from './components/StartupGate.jsx'

// Rendered immediately. StartupGate owns the order: session check and login (production
// and demo), then loading the letters from Memories/dialogue/, then the App (game +
// overlays). With auth off (npm run dev) it just loads the letters, then starts the App.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StartupGate>
      <App />
    </StartupGate>
  </StrictMode>,
)
