import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relativa: funciona en GitHub Pages y dentro de Capacitor (Android / iOS)
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { host: true },
})
