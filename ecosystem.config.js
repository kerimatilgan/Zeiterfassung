// PM2 Prozess-Konfiguration für Zeiterfassung.
// Start: pm2 start ecosystem.config.js
// Backend läuft unter dem System-User "zeiterfassung" (nicht root),
// damit ein Compromise nicht direkt zu Root-RCE eskaliert.
module.exports = {
  apps: [
    {
      name: 'zeiterfassung-backend',
      script: '/opt/Zeiterfassung/node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: 'node',
      cwd: '/opt/Zeiterfassung/backend',
      uid: 'zeiterfassung',
      gid: 'zeiterfassung',
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
