import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { layoutApi } from './server/apiMiddleware.js'

// Serves /api/layout from the same file-backed store in dev as in production,
// so `npm run dev` and a deployed build behave identically.
const layoutApiPlugin = {
  name: 'layout-api',
  configureServer(server) {
    server.middlewares.use(layoutApi)
  },
  configurePreviewServer(server) {
    server.middlewares.use(layoutApi)
  },
}

export default defineConfig({
  plugins: [react(), layoutApiPlugin],
  server: { port: 5173, open: true },
})
