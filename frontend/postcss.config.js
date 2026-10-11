// 仅保留 autoprefixer：负责标准浏览器前缀，去掉会改变 CSS 产出。
// Tailwind 已移除（全库 0 处使用其工具类），设计 token 统一收敛到 src/theme.ts。
export default {
  plugins: {
    autoprefixer: {},
  },
}
