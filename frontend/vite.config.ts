import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const apiProxy = {
  '/api': { target: 'http://localhost:4000', changeOrigin: true },
  '/socket.io': { target: 'http://localhost:4000', ws: true },
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: apiProxy,
  },
  // Превью раздаёт собранный dist. Проксирование ему нужно то же самое:
  // на нём гоняются e2e, и проверять они должны тот артефакт, который
  // уезжает на прод, а не сборку dev-сервера.
  preview: {
    port: 3000,
    proxy: apiProxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
