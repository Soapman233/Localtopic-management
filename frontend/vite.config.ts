import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// dev：代理 /api → 后端 127.0.0.1:8720；build：产出到 ../webui/static（供 FastAPI 托管）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8720',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../webui/static',
    // 说明：T01 原为 emptyOutDir:true（构建前清空产物）。本机（WorkBuddy 沙箱）对
    // 「单次删除 >50 个文件」有安全拦截，而 webui/static/assets 含 59 个 KaTeX 字体，
    // 会导致重复构建失败（首次构建产物不存在时正常）。改为 false 后构建可重复执行；
    // 由于产物文件名内容哈希，旧文件只是无害残留，index.html 始终指向最新产物。
    // 如需强制干净构建，可先手动删除 webui/static 再执行 npm run build。
    emptyOutDir: false,
    sourcemap: false,
  },
})
