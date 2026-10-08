import path from 'path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import frappeui from 'frappe-ui/vite'

// Built into servepos/public/stock and served by servepos/www/stock.py at /stock.
export default defineConfig({
  plugins: [frappeui({ frontendRoute: '/stock', jinjaBootData: false, buildConfig: false }), vue()],
  base: '/assets/servepos/stock/',
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: '../servepos/public/stock',
    emptyOutDir: true,
    manifest: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
})
