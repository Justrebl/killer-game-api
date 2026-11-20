import assert from "node:assert/strict";
import { decryptPhotoBytes, encryptPhotoBytes } from "../docs/crypto.js";

const baseUrl = process.env.SMOKE_WORKER_URL ?? "http://127.0.0.1:8787";
const origin = "https://justrebl.github.io";
const password = "local-smoke-password";

async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${body.error ?? "request failed"}`);
  return body;
}

const login = await json(await fetch(`${baseUrl}/api/login`, {
  method: "POST",
  headers: {
    Origin: origin,
    "Content-Type": "application/json",
    "CF-Connecting-IP": "192.0.2.10"
  },
  body: JSON.stringify({ credential: password })
}));
assert.equal(login.session.kdfIterations, 100000);
assert.equal(login.session.targets.length, 1);
const target = login.session.targets[0];
const authorization = `Bearer ${login.token}`;

const victory = await json(await fetch(`${baseUrl}/api/victories/${target.id}`, {
  method: "POST",
  headers: {
    Origin: origin,
    Authorization: authorization,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ confirmed: true })
}));
const plaintext = Uint8Array.from([1, 2, 3, 5, 8, 13]);
const payload = await encryptPhotoBytes(plaintext, password, login.session, victory.victoryId);
const upload = await fetch(`${baseUrl}/api/photos/${victory.victoryId}`, {
  method: "PUT",
  headers: {
    Origin: origin,
    Authorization: authorization,
    "Content-Type": "application/octet-stream",
    "Content-Length": String(payload.byteLength)
  },
  body: payload
});
await json(upload);

const download = await fetch(`${baseUrl}/api/photos/${victory.victoryId}`, {
  headers: {
    Origin: origin,
    Authorization: authorization
  },
  cache: "no-store"
});
assert.equal(download.status, 200);
assert.equal(download.headers.get("Cache-Control"), "private, no-store");
const decrypted = await decryptPhotoBytes(
  await download.arrayBuffer(),
  password,
  login.session,
  victory.victoryId
);
assert.deepEqual(new Uint8Array(await decrypted.arrayBuffer()), plaintext);

console.log("Local Worker smoke passed: login, victory, upload, and decryption.");
