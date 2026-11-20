import { mkdir, writeFile } from "node:fs/promises";
import { buildSeed } from "../worker/scripts/seed-lib.mjs";

const event = {
  eventId: "smoke-event",
  killer: "Smoke Pierrot",
  password: "local-smoke-password",
  targets: [
    { name: "Smoke Target", condition: "Exercise the local Worker flow" }
  ]
};
const seed = await buildSeed(event, {
  randomBytes: () => Buffer.alloc(16, 3),
  randomUUID: () => "smoke-target",
  now: "2026-11-20T00:00:00.000Z"
});

await mkdir(new URL("../.private/", import.meta.url), { recursive: true });
await writeFile(new URL("../.private/smoke-seed.sql", import.meta.url), seed.sql, "utf8");
console.log("Generated .private/smoke-seed.sql.");
