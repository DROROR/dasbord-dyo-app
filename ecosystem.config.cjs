module.exports = {
  apps: [
    {
      name: 'dashboard-anthropic-proxy',
      script: 'server/anthropic-proxy.mjs',
      cwd: '/opt/dashboard-dyo-app',
      interpreter: '/home/fahad/.nvm/versions/node/v22.23.2/bin/node',
      node_args: '--env-file=/opt/dashboard-dyo-app/.env',
      // Two of them, sharing port 3002 through pm2's cluster mode. This is the
      // only service the browser waits on — every translation and every ticket
      // chat goes through it — so one worker dying, or a deploy reloading it,
      // should not be something anybody notices. The second instance also
      // makes the reload zero-downtime: pm2 brings one up before taking the
      // other down.
      //
      // Safe to run twice: it keeps no state that matters. The ticket-state
      // cache is per-worker, which costs at most one extra upstream read.
      // The workers below stay at one instance each on purpose — two copies
      // of a sender would send everything twice.
      instances: 2,
      exec_mode: 'cluster',
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
    {
      // Pulls new leads out of the two Google Sheets every five minutes.
      //
      // Its configuration does NOT live in the project's .env: the sheet ids,
      // the service-account file and the Supabase keys are all in
      // ~/.config/dyo-planner/google-sheets-sync.env, which is why this one
      // carries its own --env-file. It was started by hand and was missing
      // from this file for months, so `pm2 start ecosystem.config.cjs` brought
      // up every worker except this one — and a leads board that quietly stops
      // filling looks like nothing at all.
      name: 'dashboard-google-sheets-sync',
      script: 'server/google-sheets-sync.mjs',
      cwd: '/opt/dashboard-dyo-app',
      interpreter: '/home/fahad/.nvm/versions/node/v22.23.2/bin/node',
      node_args: '--env-file=/home/fahad/.config/dyo-planner/google-sheets-sync.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
    },
    {
      // Sends the WhatsApp follow-up chain to leads nobody could reach by
      // phone. Starts in dry run: it logs what it would send and writes
      // nothing until LEAD_SEQUENCE_SEND=on is set in .env.
      name: 'dashboard-lead-sequence-worker',
      script: 'server/lead-sequence-worker.mjs',
      cwd: '/opt/dashboard-dyo-app',
      interpreter: '/home/fahad/.nvm/versions/node/v22.23.2/bin/node',
      node_args: '--env-file=/opt/dashboard-dyo-app/.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '192M',
      env: { NODE_ENV: 'production' },
    },
    {
      // Slack posts for team meetings — on the server so the warning arrives
      // even when nobody has the planner open.
      name: 'dashboard-meeting-reminders',
      script: 'server/meeting-reminders.mjs',
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
