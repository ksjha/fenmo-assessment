import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the UI hits /api/* on the Vite server and we proxy to the Express
// backend on :3001. In prod the two can be served from the same origin (via
// a reverse proxy) or the frontend can be pointed at a separate API URL via
// VITE_API_BASE at build time.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
