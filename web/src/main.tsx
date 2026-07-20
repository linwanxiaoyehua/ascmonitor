import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { queryClient } from './lib/query'
import { applyTheme } from './lib/theme'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
)
