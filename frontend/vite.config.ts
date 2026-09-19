import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const API_TARGET = 'http://127.0.0.1:8000'

// Enter's preview launcher expects a conventional root-level Vite app and a
// root `dist/` artifact. Source code remains organised under frontend/src;
// the root index.html imports that entry directly.
export default defineConfig({
  root: projectRoot,
  publicDir: path.resolve(here, 'public'),
  plugins: [react()],
  build: {
    outDir: path.resolve(projectRoot, 'dist'),
    emptyOutDir: true,
  },
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
