import { randomBytes, randomUUID, webcrypto } from "node:crypto";

export const KDF_ITERATIONS = 100000;

const encoder = new TextEncoder();

function validateEvent(event) {
  if (event.password === "A_REMPLIR_LOCALEMENT" || event.password.length < 12) {
    throw new Error("Renseigne un mot de passe local d'au moins 12 caractères.");
  }
  if (!event.eventId || !event.killer || !Array.isArray(event.targets) || !event.targets.length) {
    throw new Error("Le fichier event.local.json doit définir eventId, killer et au moins une cible.");
  }
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function buildSeed(event, options = {}) {
  validateEvent(event);
  const makeRandomBytes = options.randomBytes ?? randomBytes;
  const makeRandomUUID = options.randomUUID ?? randomUUID;
  const now = options.now ?? new Date().toISOString();
  const authSalt = Buffer.from(makeRandomBytes(16)).toString("base64");
  const encryptionSalt = Buffer.from(makeRandomBytes(16)).toString("base64");
  const baseKey = await webcrypto.subtle.importKey(
    "raw",
    encoder.encode(event.password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const verifierBits = await webcrypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: Uint8Array.from(Buffer.from(authSalt, "base64")),
      iterations: KDF_ITERATIONS,
      hash: "SHA-256"
    },
    baseKey,
    256
  );
  const credentialVerifier = Buffer.from(verifierBits).toString("hex");
  const eventRow = {
    id: event.eventId,
    killerName: event.killer,
    credentialVerifier,
    authSalt,
    encryptionSalt,
    kdfIterations: KDF_ITERATIONS,
    createdAt: now
  };
  const targetRows = event.targets.map((target, index) => {
    if (!target.name || !target.condition) {
      throw new Error(`La cible ${index + 1} doit avoir un nom et une condition.`);
    }
    return {
      id: makeRandomUUID(),
      eventId: event.eventId,
      name: target.name,
      condition: target.condition,
      position: index + 1
    };
  });
  const statements = [
    `INSERT INTO events(id, killer_name, credential_verifier, auth_salt, encryption_salt, kdf_iterations, created_at) VALUES (${quote(eventRow.id)}, ${quote(eventRow.killerName)}, ${quote(eventRow.credentialVerifier)}, ${quote(eventRow.authSalt)}, ${quote(eventRow.encryptionSalt)}, ${eventRow.kdfIterations}, ${quote(eventRow.createdAt)});`
  ];
  for (const target of targetRows) {
    statements.push(
      `INSERT INTO targets(id, event_id, name, condition, position) VALUES (${quote(target.id)}, ${quote(target.eventId)}, ${quote(target.name)}, ${quote(target.condition)}, ${target.position});`
    );
  }
  return {
    sql: `${statements.join("\n")}\n`,
    event: eventRow,
    targets: targetRows
  };
}
