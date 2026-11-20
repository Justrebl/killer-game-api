import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { buildSeed, KDF_ITERATIONS } from "../worker/scripts/seed-lib.mjs";

const event = {
  eventId: "event-test",
  killer: "Pierrot",
  password: "test-password-with-length",
  targets: [
    { name: "Alice", condition: "Faire rire Bob" }
  ]
};

test("seed uses the selected 100000 iterations and preserves private SQL", async () => {
  let saltIndex = 0;
  const seed = await buildSeed(event, {
    randomBytes: () => {
      saltIndex += 1;
      return Buffer.alloc(16, saltIndex);
    },
    randomUUID: () => "target-test",
    now: "2026-11-20T00:00:00.000Z"
  });

  assert.equal(KDF_ITERATIONS, 100000);
  assert.equal(seed.event.kdfIterations, 100000);
  assert.equal(seed.targets[0].id, "target-test");
  assert.match(seed.sql, /kdf_iterations, created_at/);
  assert.match(seed.sql, /, 100000, /);
  assert.doesNotMatch(seed.sql, new RegExp(event.password));
});

test("generated verifier authenticates the source password", async () => {
  const seed = await buildSeed(event, {
    randomBytes: () => Buffer.alloc(16, 7),
    randomUUID: () => "target-test",
    now: "2026-11-20T00:00:00.000Z"
  });
  const baseKey = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(event.password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await webcrypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: Uint8Array.from(Buffer.from(seed.event.authSalt, "base64")),
      iterations: seed.event.kdfIterations,
      hash: "SHA-256"
    },
    baseKey,
    256
  );
  const verifier = Buffer.from(bits).toString("hex");

  assert.equal(verifier, seed.event.credentialVerifier);
});
