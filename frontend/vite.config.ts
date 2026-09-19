import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev/preview servers must bind on all interfaces so the hosted preview
// can proxy them; the default 127.0.0.1 binding is unreachable from outside
// the container. `allowedHosts: true` permits the preview's generated
// hostname, which is not known ahead of time.
//
// `/api` is proxied to the FastAPI backend so the browser always talks to its
// own origin. This keeps the app working behind any host name and means the
// frontend never needs an absolute backend URL (or CORS) in the browser.
const API_TARGET = 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: 3000,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
})
