import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api/leads/google-sheet': {
          target: 'http://127.0.0.1:3003',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api\/leads\/google-sheet/, ''),
        },
        '/api/claude': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api\/claude/, ''),
          headers: {
            'x-api-key': env.VITE_ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY || '',
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        },
      },
    },
  }
})
