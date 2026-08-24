module.exports = {
  apps: [
    {
      name: 'dashboard-anthropic-proxy',
      script: 'server/anthropic-proxy.mjs',
      cwd: '/opt/dashboard-dyo-app',
      interpreter: '/home/fahad/.nvm/versions/node/v22.23.2/bin/node',
      node_args: '--env-file=/opt/dashboard-dyo-app/.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      env: {
        NODE_ENV: 'production',
        ANTHROPIC_PROXY_PORT: '3002',
      },
    },
    {
      name: 'dashboard-task-email-worker',
      script: 'server/task-email-worker.mjs',
      cwd: '/opt/dashboard-dyo-app',
      interpreter: '/home/fahad/.nvm/versions/node/v22.23.2/bin/node',
      node_args: '--env-file=/opt/dashboard-dyo-app/.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '192M',
      env: { NODE_ENV: 'production' },
    },
  ],
}
