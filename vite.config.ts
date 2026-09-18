import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(() => {
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
          target: 'http://127.0.0.1:3002',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api\/claude/, ''),
        },
      },
    },
  }
})
