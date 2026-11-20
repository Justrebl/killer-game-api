import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/src/index.js";

const origin = "https://justrebl.github.io";
const eventId = "event-test";

function createPhotoEnvironment({ authenticated = true, photoKey = "photo-key.bin" } = {}) {
  const victory = {
    id: "victory-test",
    eventId,
    photoKey
  };
  const rateLimits = new Map();
  const storage = new Map([[photoKey, Uint8Array.from([7, 8, 9])]]);
  const counters = { get: 0, put: 0, delete: 0, updates: 0 };
  const database = {
    prepare(sql) {
      let args = [];
      const statement = {
        bind(...values) {
          args = values;
          return statement;
        },
        async first() {
          if (sql.includes("FROM sessions")) {
            return authenticated
              ? { event_id: eventId, expires_at: "2099-01-01T00:00:00.000Z" }
              : null;
          }
          if (sql.includes("FROM victories")) {
            return { id: victory.id, photo_key: victory.photoKey };
          }
          if (sql.includes("SELECT window_start")) return rateLimits.get(args[0]) ?? null;
          return null;
        },
        async run() {
          if (sql.startsWith("INSERT INTO rate_limits")) {
            rateLimits.set(args[0], { window_start: args[1], attempts: args[2] });
          }
          if (sql.startsWith("UPDATE victories SET photo_key")) {
            counters.updates += 1;
            victory.photoKey = args[0];
          }
          return { success: true };
        }
      };
      return statement;
    }
  };
  const photos = {
    async get(key) {
      counters.get += 1;
      const body = storage.get(key);
      return body ? { body } : null;
    },
    async put(key, body) {
      counters.put += 1;
      storage.set(key, new Uint8Array(body));
    },
    async delete(key) {
      counters.delete += 1;
      storage.delete(key);
    }
  };
  return {
    env: { ALLOWED_ORIGIN: origin, DB: database, PHOTOS: photos },
    victory,
    storage,
    counters
  };
}

function request(path, init = {}) {
  return new Request(`https://worker.test${path}`, {
    ...init,
    headers: {
      Origin: origin,
      Authorization: "Bearer session-token",
      ...(init.headers ?? {})
    }
  });
}

test("photo GET returns private ciphertext with no-store response headers", async () => {
  const fixture = createPhotoEnvironment();
  const response = await worker.fetch(
    request("/api/photos/victory-test"),
    fixture.env
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    Uint8Array.from([7, 8, 9])
  );
  assert.equal(fixture.counters.get, 1);
});

test("photo routes reject unauthenticated requests before touching R2", async () => {
  const fixture = createPhotoEnvironment({ authenticated: false });
  const response = await worker.fetch(
    request("/api/photos/victory-test"),
    fixture.env
  );

  assert.equal(response.status, 401);
  assert.equal(fixture.counters.get, 0);
  assert.equal(fixture.counters.put, 0);
  assert.equal(fixture.counters.delete, 0);
});

test("photo PUT stores ciphertext and updates D1 metadata", async () => {
  const fixture = createPhotoEnvironment();
  const ciphertext = Uint8Array.from([1, 2, 3, 4]);
  const response = await worker.fetch(
    request("/api/photos/victory-test", {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(ciphertext.byteLength)
      },
      body: ciphertext
    }),
    fixture.env
  );

  assert.equal(response.status, 200);
  assert.equal(fixture.counters.put, 1);
  assert.equal(fixture.counters.updates, 1);
  assert.deepEqual(
    fixture.storage.get(fixture.victory.photoKey),
    ciphertext
  );
});

test("photo PUT rejects ciphertext above the Worker limit before writing", async () => {
  const fixture = createPhotoEnvironment();
  const response = await worker.fetch(
    request("/api/photos/victory-test", {
      method: "PUT",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(5 * 1024 * 1024 + 1)
      },
      body: "unneeded"
    }),
    fixture.env
  );

  assert.equal(response.status, 413);
  assert.equal(fixture.counters.put, 0);
  assert.equal(fixture.counters.updates, 0);
});
