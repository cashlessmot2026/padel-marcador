import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relativa: funciona en GitHub Pages y dentro de Capacitor (Android / iOS)
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1000 },
  base: './',
  server: { host: true },
})
