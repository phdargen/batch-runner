import "./loadEnv.js";

const { runScript } = await import("./runScript.js");

await runScript(async () => {
  const { claimVouchers } = await import("../lib/server/cronJobs.js");
  const result = await claimVouchers();
  console.log(JSON.stringify(result, null, 2));

  if (result.vouchers === 0) {
    console.log("No claimable vouchers found.");
  }
});
