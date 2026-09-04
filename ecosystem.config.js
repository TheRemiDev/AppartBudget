// Configuration PM2 - a lancer depuis la racine du projet avec:
//   pm2 start ecosystem.config.js
//
// Le nom du process ("appartbudget") est unique afin de ne jamais entrer en
// conflit avec d'autres applications Node deja gerees par PM2 sur le VPS.
module.exports = {
  apps: [
    {
      name: "appartbudget",
      cwd: "./server",
      script: "src/index.js",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "300M",
      out_file: "../logs/appartbudget.out.log",
      error_file: "../logs/appartbudget.error.log",
      time: true,
    },
  ],
};
