import "./loadEnv.js";

const { runScript } = await import("./runScript.js");

await runScript(async () => {
  const { settleFunds } = await import("../lib/server/cronJobs.js");
  const result = await settleFunds();
  console.log(JSON.stringify(result, null, 2));

  if (result.skipped) {
    console.log(result.error ? `Settle skipped: ${result.error}` : "Nothing to settle.");
  }
});
