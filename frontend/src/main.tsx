import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { UpdateWatcher } from './app/update-watcher'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './app/App'
import { rememberReferral } from './shared/lib/referral'
import './styles/global.css'
import './styles/theme.css'
import './styles/mobile.css'

rememberReferral()

// Обращение №39: в числовом поле стоял 0, курсор вставал после него, и вместо «5» выходило «05».
// Правило для всех числовых полей игры: при входе в поле число выделено, новая цифра его заменяет.
document.addEventListener('focusin', event => {
  const field = event.target
  if (field instanceof HTMLInputElement && field.type === 'number') requestAnimationFrame(() => field.select())
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <UpdateWatcher />
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
