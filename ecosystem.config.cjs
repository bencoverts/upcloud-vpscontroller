/* global module, __dirname */
module.exports = {
  apps: [{
    name: 'cerdasnet-vps-control',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
