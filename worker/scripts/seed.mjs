import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildSeed } from "./seed-lib.mjs";

const inputPath = new URL("../event.local.json", import.meta.url);
const outputPath = new URL("../../.private/seed.sql", import.meta.url);
const event = JSON.parse(await readFile(inputPath, "utf8"));
const seed = await buildSeed(event);

await mkdir(new URL("../../.private/", import.meta.url), { recursive: true });
await writeFile(outputPath, seed.sql, "utf8");
console.log(`Seed SQL généré dans .private/seed.sql avec ${seed.targets.length} cibles.`);
console.log("Le SQL ignoré par Git contient les noms et défis; le mot de passe brut est remplacé par son empreinte.");
