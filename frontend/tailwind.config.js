/** Tailwind 配置：承载设计令牌（主色 #3370FF、难度分级色、8px 栅格）。
 *
 * 说明：关闭 preflight，避免 Tailwind 的全局重置覆盖 MUI 组件样式；
 * 组件样式以 MUI 为主，Tailwind 用于布局与设计令牌。
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        primary: '#3370FF',
        // 难度分级色（M6 裁定：易=绿 / 中=橙 / 难=红）
        difficulty: {
          easy: '#22C55E',
          medium: '#F59E0B',
          hard: '#EF4444',
        },
        badge: {
          review: '#F59E0B',
          confirmed: '#22C55E',
          rejected: '#9CA3AF',
          missing: '#E5E7EB',
        },
      },
      spacing: {
        // 8px 栅格
        1: '8px',
        2: '16px',
        3: '24px',
        4: '32px',
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
}
