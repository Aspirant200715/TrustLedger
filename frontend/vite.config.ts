import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')

// Enter's preview launcher expects a conventional root-level Vite app and a
// root `dist/` artifact. Source code remains organised under frontend/src;
// the root index.html imports that entry directly. All backend contact goes
// through Enter Cloud backend functions (see frontend/src/api.ts).
export default defineConfig({
  root: projectRoot,
  publicDir: path.resolve(here, 'public'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(projectRoot, 'dist'),
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 3000,
    strictPort: false,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 3000,
    strictPort: false,
    allowedHosts: true,
  },
})
