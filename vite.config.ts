import { existsSync } from 'node:fs'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Vite only exposes `VITE_`-prefixed variables to the bundle; the server half
// of the dev process reads `process.env` like any Node application, and in
// production the container supplies it. This is the development convenience,
// and nothing in the repository reads a secret any other way.
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  server: { port: 3000 },
  plugins: [tanstackStart(), viteReact()],
})
