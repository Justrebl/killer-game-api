const encoder = new TextEncoder();
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_KDF_ITERATIONS = 100000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors }
  });
}

function requestCors(request, env) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.ALLOWED_ORIGIN;
  if (!origin || origin === allowedOrigin) {
    return {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin"
    };
  }
  return null;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: Uint8Array.from(atob(salt), (char) => char.charCodeAt(0)), iterations, hash: "SHA-256" },
    key,
    256
  );
  return [...new Uint8Array(bits)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticate(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const session = await env.DB.prepare(
    "SELECT event_id, expires_at FROM sessions WHERE token_hash = ?"
  ).bind(tokenHash).first();
  if (!session || session.expires_at <= new Date().toISOString()) return null;
  return session;
}

async function consumeRateLimit(env, key, maximum) {
  const keyHash = await sha256Hex(key);
  const now = Date.now();
  const row = await env.DB.prepare(
    "SELECT window_start, attempts FROM rate_limits WHERE key_hash = ?"
  ).bind(keyHash).first();
  if (!row) {
    await env.DB.prepare(
      "INSERT INTO rate_limits(key_hash, window_start, attempts) VALUES (?, ?, 1)"
    ).bind(keyHash, now).run();
    return true;
  }
  if (now - row.window_start >= RATE_LIMIT_WINDOW_MS) {
    await env.DB.prepare(
      "UPDATE rate_limits SET window_start = ?, attempts = 1 WHERE key_hash = ?"
    ).bind(now, keyHash).run();
    return true;
  }
  if (row.attempts >= maximum) return false;
  await env.DB.prepare(
    "UPDATE rate_limits SET attempts = attempts + 1 WHERE key_hash = ?"
  ).bind(keyHash).run();
  return true;
}

async function getSessionPayload(env, eventId) {
  const event = await env.DB.prepare(
    "SELECT encryption_salt, kdf_iterations FROM events WHERE id = ?"
  ).bind(eventId).first();
  const rows = await env.DB.prepare(`
    SELECT t.id, t.name, t.condition, v.id AS victory_id, v.created_at AS completed_at,
           v.photo_key
    FROM targets t
    LEFT JOIN victories v ON v.target_id = t.id
    WHERE t.event_id = ?
    ORDER BY t.position
  `).bind(eventId).all();
  return {
    encryptionSalt: event.encryption_salt,
    kdfIterations: event.kdf_iterations,
    targets: (rows.results || []).map((target) => ({
      id: target.id,
      name: target.name,
      condition: target.condition,
      victoryId: target.victory_id,
      completedAt: target.completed_at,
      photoPresent: Boolean(target.photo_key)
    }))
  };
}

async function login(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body?.credential || typeof body.credential !== "string") {
    return json({ error: "Mot de passe requis" }, 400, cors);
  }
  const event = await env.DB.prepare(
    "SELECT id, credential_verifier, auth_salt, kdf_iterations FROM events LIMIT 1"
  ).first();
  if (!event) return json({ error: "Événement introuvable" }, 404, cors);
  if (event.kdf_iterations > MAX_KDF_ITERATIONS) {
    return json({ error: "Configuration de sécurité non prise en charge" }, 503, cors);
  }
  const clientIp = request.headers.get("CF-Connecting-IP") || "local";
  if (!await consumeRateLimit(env, `login:${clientIp}`, 10)) {
    return json({ error: "Trop de tentatives; réessaie plus tard" }, 429, cors);
  }
  const verifier = await pbkdf2(body.credential, event.auth_salt, event.kdf_iterations);
  if (verifier !== event.credential_verifier) {
    return json({ error: "Mot de passe incorrect" }, 401, cors);
  }

  const token = crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare(
    "INSERT INTO sessions(token_hash, event_id, expires_at) VALUES (?, ?, ?)"
  ).bind(tokenHash, event.id, expiresAt).run();

  return json({
    token,
    session: await getSessionPayload(env, event.id)
  }, 200, cors);
}

export default {
  async fetch(request, env) {
    const cors = requestCors(request, env);
    if (!cors) return json({ error: "Origine interdite" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === "/api/login" && request.method === "POST") return login(request, env, cors);

    const session = await authenticate(request, env);
    if (!session) return json({ error: "Session invalide" }, 401, cors);

    if (url.pathname === "/api/session" && request.method === "GET") {
      return json({ session: await getSessionPayload(env, session.event_id) }, 200, cors);
    }

    const victoryMatch = url.pathname.match(/^\/api\/victories\/([^/]+)$/);
    if (victoryMatch && request.method === "POST") {
      const targetId = victoryMatch[1];
      const body = await request.json().catch(() => null);
      if (body?.confirmed !== true) return json({ error: "Confirmation requise" }, 400, cors);
      const target = await env.DB.prepare(
        "SELECT id FROM targets WHERE id = ? AND event_id = ?"
      ).bind(targetId, session.event_id).first();
      if (!target) return json({ error: "Cible introuvable" }, 404, cors);

      const existing = await env.DB.prepare(
        "SELECT id, created_at FROM victories WHERE target_id = ? AND event_id = ?"
      ).bind(targetId, session.event_id).first();
      if (existing) return json({ victoryId: existing.id, createdAt: existing.created_at }, 200, cors);

      const victoryId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO victories(id, event_id, target_id, created_at) VALUES (?, ?, ?, ?)"
      ).bind(victoryId, session.event_id, targetId, createdAt).run();
      return json({ victoryId, createdAt }, 201, cors);
    }

    const photoMatch = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
    if (photoMatch && ["GET", "PUT", "DELETE"].includes(request.method)) {
      const victory = await env.DB.prepare(
        "SELECT id, photo_key FROM victories WHERE id = ? AND event_id = ?"
      ).bind(photoMatch[1], session.event_id).first();
      if (!victory) return json({ error: "Victoire introuvable" }, 404, cors);

      if (request.method === "GET") {
        if (!victory.photo_key) return json({ error: "Photo introuvable" }, 404, cors);
        const object = await env.PHOTOS.get(victory.photo_key);
        if (!object) return json({ error: "Photo introuvable" }, 404, cors);
        return new Response(object.body, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Cache-Control": "private, no-store",
            ...cors
          }
        });
      }
      if (request.method === "DELETE") {
        if (victory.photo_key) await env.PHOTOS.delete(victory.photo_key);
        await env.DB.prepare(
          "UPDATE victories SET photo_key = NULL WHERE id = ? AND event_id = ?"
        ).bind(victory.id, session.event_id).run();
        return new Response(null, { status: 204, headers: cors });
      }

      if (!await consumeRateLimit(env, `photos:${session.event_id}`, 20)) {
        return json({ error: "Trop d'envois; réessaie plus tard" }, 429, cors);
      }
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > MAX_PHOTO_BYTES) return json({ error: "Photo trop volumineuse" }, 413, cors);
      const ciphertext = await request.arrayBuffer();
      if (ciphertext.byteLength > MAX_PHOTO_BYTES) return json({ error: "Photo trop volumineuse" }, 413, cors);
      const key = victory.photo_key || `${crypto.randomUUID()}.bin`;
      await env.PHOTOS.put(key, ciphertext, { httpMetadata: { contentType: "application/octet-stream" } });
      await env.DB.prepare(
        "UPDATE victories SET photo_key = ? WHERE id = ? AND event_id = ?"
      ).bind(key, victory.id, session.event_id).run();
      return json({ stored: true }, 200, cors);
    }

    return json({ error: "Route introuvable" }, 404, cors);
  }
};
