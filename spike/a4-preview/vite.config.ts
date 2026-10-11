import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 探针用相对 base，便于直接以 file:// 或任意静态服务器打开 dist。
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 8777, strictPort: false },
  build: { outDir: 'dist', sourcemap: false, emptyOutDir: false },
})
