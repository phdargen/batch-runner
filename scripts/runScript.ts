import { closeStorage } from "../lib/server/storage.js";

export async function runScript(job: () => Promise<void>): Promise<void> {
  try {
    await job();
    await closeStorage();
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    await closeStorage().catch(() => {});
    process.exit(1);
  }
}
