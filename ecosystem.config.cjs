module.exports = {
  apps: [
    {
      name: "fuel-atan-monitor",
      script: "dist/monitor.js",
      cwd: ".",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "fuel-atan-api",
      script: "dist/api.js",
      cwd: ".",
      env: {
        NODE_ENV: "production",
        DASHBOARD_FILE: "./dist/index.html"
      }
    }
  ]
};
