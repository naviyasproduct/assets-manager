/**
 * pm2 process definition for the office PC.
 *
 * Start once with:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup          # prints the command that survives a reboot
 *
 * On Windows, `pm2 startup` is not supported. Use pm2-installer or the Task
 * Scheduler recipe in README.md instead - both are documented there.
 */
module.exports = {
  apps: [
    {
      name: 'assets-manager',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3000',
      cwd: __dirname,

      // Next.js is single-process here on purpose. Cluster mode would spawn one
      // Chromium per worker for PDF rendering, which the office PC does not need
      // for a handful of concurrent users.
      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'production',
        // Bind to every interface so department heads can reach it by LAN IP.
        HOSTNAME: '0.0.0.0',
        PORT: 3000,
      },

      // Chromium plus the Node heap. Raise if reports of very large departments
      // start getting killed.
      max_memory_restart: '1500M',

      autorestart: true,
      watch: false,
      // If it crash-loops, back off rather than hammering Postgres.
      restart_delay: 4000,
      max_restarts: 10,
      min_uptime: '30s',

      // Give in-flight PDF generation a chance to finish before a restart.
      kill_timeout: 15000,

      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
