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
    /**
     * 产出**构建清单**（`webui/static/.vite/manifest.json`），供 `scripts/prune-stale-assets.mjs`
     * 准确判定「本次构建到底产出了哪些文件」。
     *
     * 为什么需要它：代码分割（P5-1）之后，**懒加载的页面 chunk 不在 `index.html` 里**
     * （它们是运行时动态 import 的），因此不能再用「是否被 index.html 引用」判断新旧。
     * 有了 manifest 就能拿到本次构建的**完整产物集**（含 dynamicImports 与 css），
     * 从而安全清理历史残留。
     *
     * 注：该文件位于静态目录内、无敏感信息，被 FastAPI 顺带托管也无影响（无人请求它）。
     */
    manifest: true,
    rollupOptions: {
      output: {
        // 只归入下面明确列出的模块，禁止业务块贪婪吸收主入口共用依赖而提前预加载。
        onlyExplicitManualChunks: true,
        /**
         * 阶段 5 性能优化（P5-1）——**vendor 分包**。
         *
         * 动机：配合 `router.tsx` 的路由级 `React.lazy`，把体积大、**几乎不变**的第三方
         * 依赖从业务代码里剥出来，单独成 chunk。收益是浏览器缓存粒度更细：老师下次访问
         * 时，只要业务代码（入口 chunk）变了就重新下载入口，而这些 vendor chunk 命中缓存
         * 直接复用，不必重复下载 1 MB。
         *
         * 分组（按「变更频率 / 使用场景」聚合，而非按包逐个拆，避免碎片化请求）：
         * - `vendor-react`：React 运行时（react / react-dom / scheduler / react-router-dom）——全站必需，最稳定；
         * - `vendor-mui`  ：MUI + Emotion（含 @mui/icons-material）——体积最大的一组；
         * - `vendor-katex`：KaTeX 公式渲染引擎——仅公式组件用到；
         * - `vendor-data` ：数据层与拖拽（@tanstack/react-query / zustand / @dnd-kit/*）；
         * - `vendor-misc` ：其余 node_modules 兜底（notistack / zod / react-error-boundary 等）。
         *
         * ⚠️ 判断顺序有讲究：`@emotion/react`、`@mui/*` 的路径里也含 `/react/` 片段，
         * 必须先匹配 MUI / Emotion，再匹配 React，否则 React 分组会误吞 Emotion。
         *
         * ⚠️ **CSS 一律不参与 vendor 分包**：`main.tsx` 只 import 了 `katex/dist/katex.min.css`
         * （纯样式）。若把该 CSS 归到 `vendor-katex` chunk，入口会因这个静态 import 连带把
         * 整个 258 kB 的 KaTeX **JS** 预加载进首屏。让 CSS 跟随它的 import 方（入口）自然归属，
         * KaTeX 的 JS 就仍只在懒加载页面里按需下载。
         */
        manualChunks(id) {
          // B3：结构分页与共享预览门禁原本同时用于组卷，合为业务共享块以减少
          // 路由预加载映射和碎片请求；只延迟抽屉 UI，不把业务塞入预加载 vendor。
          // KaTeX 组件仍自然独立，避免找题/详情被迫加载分页实现。
          if (id.endsWith('/components/LivePreviewPanel.tsx') ||
              id.includes('/components/livePreview/') ||
              id.endsWith('/hooks/useExportGate.ts') ||
              id.endsWith('/hooks/exportGateShared.ts') ||
              id.endsWith('/hooks/useJob.ts') ||
              id.endsWith('/api/export.ts')) return 'preview'
          // 显式分包后，恢复原有共用业务依赖的聚合，避免拆成多个极小请求。
          // 这些模块在旧首屏均已加载；不包含页面、分页或公式业务。
          if (['/store/paperStore.ts', '/store/settingsStore.ts', '/lib/glossary.ts', '/components/ErrorState.tsx',
               '/api/client.ts', '/api/queryKeys.ts', '/api/errors.ts', '/api/papers.ts',
               '/components/LoadingState.tsx'].some(path => id.endsWith(path))) return 'app-common'
          // Rollup 的 CommonJS 互操作助手恢复至原 React 运行时分组，无业务代码进入 vendor。
          if (id.includes('commonjsHelpers')) return 'vendor-react'
          if (!id.includes('node_modules')) return undefined
          if (id.endsWith('.css')) return undefined
          // AutoAnimate独立lazy，不落入首屏已预加载的vendor-misc。
          if (id.includes('@formkit/auto-animate')) return 'auto-animate'
          if (id.includes('@mui') || id.includes('@emotion')) return 'vendor-mui'
          if (id.includes('katex')) return 'vendor-katex'
          if (id.includes('@tanstack') || id.includes('zustand') || id.includes('@dnd-kit')) {
            return 'vendor-data'
          }
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-router') ||
            id.includes('@remix-run') ||
            id.includes('scheduler')
          ) {
            return 'vendor-react'
          }
          return 'vendor-misc'
        },
      },
    },
  },
})
