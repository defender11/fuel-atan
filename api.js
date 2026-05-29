const { runApi } = require("./apps/api/src/main");

runApi().catch((error) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "fatal",
      message: "API crashed",
      extra: { error: error instanceof Error ? error.message : String(error) }
    })
  );
  process.exitCode = 1;
});
