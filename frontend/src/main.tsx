import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

// Truco clásico para iOS Safari: sin un listener de touchstart en el documento,
// WebKit no activa el pseudo-selector :active al tocar (solo lo hace con clicks
// de mouse), así que todo el feedback táctil de .tap-btn/.tap-card quedaría
// mudo en iPhone. Un listener pasivo y vacío alcanza para que lo dispare.
document.addEventListener('touchstart', () => {}, { passive: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
