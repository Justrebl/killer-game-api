import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptPhotoBytes,
  encryptPhotoBytes,
  MAX_PLAINTEXT_PHOTO_BYTES
} from "../docs/crypto.js";

const password = "test-password-with-length";
const session = {
  encryptionSalt: Buffer.alloc(16, 4).toString("base64"),
  kdfIterations: 100000
};
const victoryId = "victory-test";

test("photo payload decrypts with the matching password and victory", async () => {
  const plaintext = Uint8Array.from([1, 3, 5, 7, 9]);
  const payload = await encryptPhotoBytes(plaintext, password, session, victoryId);
  const photo = await decryptPhotoBytes(payload, password, session, victoryId);

  assert.equal(photo.type, "image/jpeg");
  assert.deepEqual(
    new Uint8Array(await photo.arrayBuffer()),
    plaintext
  );
});

test("photo payload rejects a different victory ID", async () => {
  const payload = await encryptPhotoBytes(
    Uint8Array.from([1, 2, 3]),
    password,
    session,
    victoryId
  );

  await assert.rejects(
    () => decryptPhotoBytes(payload, password, session, "different-victory"),
    /OperationError|decrypt/
  );
});

test("photo payload rejects tampering and truncation", async () => {
  const payload = await encryptPhotoBytes(
    Uint8Array.from([1, 2, 3, 4]),
    password,
    session,
    victoryId
  );
  const tampered = new Uint8Array(payload);
  tampered[tampered.length - 1] ^= 1;

  await assert.rejects(
    () => decryptPhotoBytes(tampered, password, session, victoryId),
    /OperationError|decrypt/
  );
  await assert.rejects(
    () => decryptPhotoBytes(payload.slice(0, 10), password, session, victoryId),
    /Photo chiffrée invalide/
  );
});

test("photo plaintext reserves space for IV and authentication tag", async () => {
  await assert.rejects(
    () => encryptPhotoBytes(
      new Uint8Array(MAX_PLAINTEXT_PHOTO_BYTES + 1),
      password,
      session,
      victoryId
    ),
    /taille maximale chiffrée/
  );
});
