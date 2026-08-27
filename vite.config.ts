import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base + HashRouter means the built site works from any path —
  // GitHub Pages project sites included — with no server rewrite rules.
  base: './',
  // The dep optimizer rewrites @ffmpeg/ffmpeg/worker?url to a prebundled path
  // that is never emitted, so the worker fails to construct in dev.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  worker: { format: 'es' },
})
