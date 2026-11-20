const encoder = new TextEncoder();
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PLAINTEXT_PHOTO_BYTES = MAX_PHOTO_BYTES - AES_GCM_IV_BYTES - AES_GCM_TAG_BYTES;

export async function deriveEncryptionKey(password, session) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: Uint8Array.from(atob(session.encryptionSalt), (char) => char.charCodeAt(0)),
      iterations: session.kdfIterations,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptPhotoBytes(plaintext, password, session, victoryId) {
  const plainBytes = new Uint8Array(plaintext);
  if (plainBytes.byteLength > MAX_PLAINTEXT_PHOTO_BYTES) {
    throw new Error("La photo dépasse la taille maximale chiffrée.");
  }
  const key = await deriveEncryptionKey(password, session);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(victoryId) },
    key,
    plainBytes
  );
  const payload = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(ciphertext), iv.byteLength);
  return payload;
}

export async function decryptPhotoBytes(payload, password, session, victoryId) {
  const bytes = new Uint8Array(payload);
  const minimumLength = AES_GCM_IV_BYTES + AES_GCM_TAG_BYTES;
  if (bytes.byteLength < minimumLength) throw new Error("Photo chiffrée invalide.");
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error("Photo chiffrée trop volumineuse.");
  const iv = bytes.subarray(0, AES_GCM_IV_BYTES);
  const ciphertext = bytes.subarray(AES_GCM_IV_BYTES);
  const key = await deriveEncryptionKey(password, session);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(victoryId) },
    key,
    ciphertext
  );
  return new Blob([plaintext], { type: "image/jpeg" });
}
