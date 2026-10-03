import type { Config } from 'tailwindcss';

/**
 * Tailwind 配置。
 * content 只扫描 src 下的代码，避免把 knowledge/ 里的 Markdown 当作类名来源拖慢构建。
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 品牌主色，用在用户气泡、发送按钮、快捷问题按钮上
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
      keyframes: {
        // 打字机光标闪烁
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        // 消息上浮淡入
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        blink: 'blink 1s step-end infinite',
        'fade-up': 'fade-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
