import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// AdsPilot's API listens on 4020; AP_API_TARGET points the dev server elsewhere without touching dist/.
const target = process.env.AP_API_TARGET || 'http://localhost:4020'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5193, // DevPilot 5173, SEOPilot 5183: all three can run at once
    proxy: {
      '/api': { target, changeOrigin: true },
      '/oauth': { target, changeOrigin: true },
    },
  },
  build: { outDir: 'dist' },
})
