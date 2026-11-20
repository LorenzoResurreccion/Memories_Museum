import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { loadMemories } from './data/loadMemories.js'

// The letters are fetched from Memories/dialogue/ before the game exists, so the
// hallway is sized from the loaded count. loadMemories() never rejects; on failure
// N is 0 and every frame shows a future memory.
loadMemories().then((count) => {
  if (count === 0) console.warn('No dialogue letters loaded from Memories/dialogue/.')
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
