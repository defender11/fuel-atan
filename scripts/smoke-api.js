const { runApi } = require("../apps/api/src/main");

async function assertOk(response, url) {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Request failed ${response.status} ${url}: ${body}`);
  }
}

async function main() {
  const { server, config } = await runApi({
    apiHost: "127.0.0.1",
    apiPort: 0,
    apiKey: ""
  });

  const base = `http://127.0.0.1:${config.apiPort}`;
  try {
    const health = await fetch(`${base}/health`);
    await assertOk(health, "/health");

    const snapshot = await fetch(`${base}/snapshot/current`);
    await assertOk(snapshot, "/snapshot/current");

    const recent = await fetch(`${base}/events/recent?limit=5`);
    await assertOk(recent, "/events/recent");

    const publicConfig = await fetch(`${base}/config/public`);
    await assertOk(publicConfig, "/config/public");

    const dashboard = await fetch(`${base}/dashboard`);
    await assertOk(dashboard, "/dashboard");

    console.log(
      JSON.stringify({
        ok: true,
        base
      })
    );
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  );
  process.exitCode = 1;
});
