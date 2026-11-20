import {
  decryptPhotoBytes,
  encryptPhotoBytes,
  MAX_PHOTO_BYTES,
  MAX_PLAINTEXT_PHOTO_BYTES
} from "./crypto.js";

const config = window.KILLER_GAME_CONFIG;
const loginSection = document.querySelector("#login");
const gameSection = document.querySelector("#game");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const progress = document.querySelector("#progress");
const targetList = document.querySelector("#target-list");
const targetTemplate = document.querySelector("#target-template");
const globalError = document.querySelector("#global-error");
const photoDialog = document.querySelector("#photo-dialog");
const photoTitle = document.querySelector("#photo-title");
const photoImage = document.querySelector("#photo-image");
const photoStatus = document.querySelector("#photo-status");

let password = "";
let sessionToken = "";
let session = null;
let photoObjectUrl = "";
let photoOpenToken = 0;
let photoTrigger = null;
let photoFallbackFocus = null;

async function api(path, options = {}) {
  const { responseType = "json", ...requestOptions } = options;
  const headers = { ...(requestOptions.headers || {}) };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  if (requestOptions.body && !(requestOptions.body instanceof Blob)) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${config.apiOrigin}${path}`, { ...requestOptions, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Erreur serveur");
  }
  if (response.status === 204) return null;
  if (responseType === "arrayBuffer") return response.arrayBuffer();
  return response.json();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  password = document.querySelector("#password").value;
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ credential: password })
    });
    sessionToken = result.token;
    session = result.session;
    loginSection.hidden = true;
    gameSection.hidden = false;
    renderTargets();
  } catch (error) {
    loginError.textContent = error.message;
  }
});

function renderTargets() {
  targetList.replaceChildren();
  session.targets.forEach((target, index) => {
    const fragment = targetTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".target-card");
    const status = fragment.querySelector(".target-status");
    const victoryButton = fragment.querySelector(".victory-button");
    const photoForm = fragment.querySelector(".photo-form");
    const photoViewButton = fragment.querySelector(".photo-view-button");
    const victoryState = fragment.querySelector(".victory-state");
    const targetName = fragment.querySelector(".target-name");

    fragment.querySelector(".target-position").textContent = `Cible ${index + 1}`;
    targetName.textContent = target.name;
    fragment.querySelector(".target-condition").textContent = target.condition;
    updateTargetStatus(card, status, target);
    photoViewButton.textContent = `Voir la photo de ${target.name}`;
    photoViewButton.setAttribute("aria-label", `Voir la photo de ${target.name}`);
    updatePhotoAvailability(target, photoViewButton);

    victoryButton.addEventListener("click", async () => {
      victoryButton.disabled = true;
      globalError.textContent = "";
      try {
        const result = await api(`/api/victories/${target.id}`, {
          method: "POST",
          body: JSON.stringify({ confirmed: true })
        });
        target.victoryId = result.victoryId;
        target.completedAt = result.createdAt;
        updateTargetStatus(card, status, target);
        victoryState.textContent = `Validée le ${new Date(result.createdAt).toLocaleString("fr-FR")}.`;
        photoForm.hidden = false;
        updateProgress();
      } catch (error) {
        victoryState.textContent = error.message;
      } finally {
        victoryButton.disabled = false;
      }
    });

    photoForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      globalError.textContent = "";
      const file = photoForm.querySelector(".photo-input").files[0];
      if (!file || !target.victoryId) return;
      try {
        const ciphertext = await encryptPhoto(file, target.victoryId);
        await api(`/api/photos/${target.victoryId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: ciphertext
        });
        target.photoPresent = true;
        victoryState.textContent = "Photo chiffrée enregistrée.";
        updatePhotoAvailability(target, photoViewButton);
      } catch (error) {
        victoryState.textContent = error.message;
      }
    });

    photoViewButton.addEventListener("click", () => openPhoto(target, photoViewButton, targetName));

    if (target.victoryId) {
      photoForm.hidden = false;
      victoryState.textContent = `Validée le ${new Date(target.completedAt).toLocaleString("fr-FR")}.`;
    }
    targetList.append(fragment);
  });
  updateProgress();
}

function updatePhotoAvailability(target, button) {
  button.hidden = !(target.victoryId && target.photoPresent);
}

function updateTargetStatus(card, status, target) {
  if (target.victoryId) {
    card.classList.add("completed");
    status.textContent = "Validée";
  } else {
    card.classList.remove("completed");
    status.textContent = "En cours";
  }
}

function updateProgress() {
  const completed = session.targets.filter((target) => target.victoryId).length;
  progress.textContent = `${completed}/${session.targets.length} validées`;
}

async function encryptPhoto(file, victoryId) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choisis une image JPEG, PNG ou WebP.");
  }
  if (file.size > MAX_PHOTO_BYTES) throw new Error("La photo dépasse 5 Mo.");
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob || blob.size > MAX_PLAINTEXT_PHOTO_BYTES) {
    throw new Error("Impossible de préparer une photo sous la limite chiffrée.");
  }
  const plaintext = await blob.arrayBuffer();
  const ciphertext = await encryptPhotoBytes(plaintext, password, session, victoryId);
  return new Blob([ciphertext], { type: "application/octet-stream" });
}

async function openPhoto(target, trigger, fallbackFocus) {
  const token = ++photoOpenToken;
  photoTrigger = trigger;
  photoFallbackFocus = fallbackFocus;
  trigger.disabled = true;
  releasePhotoUrl();
  photoImage.hidden = true;
  photoImage.alt = "";
  photoTitle.textContent = `Photo de ${target.name}`;
  photoStatus.textContent = "Chargement de la photo…";
  if (!photoDialog.open) photoDialog.showModal();

  try {
    const payload = await api(`/api/photos/${target.victoryId}`, {
      responseType: "arrayBuffer",
      cache: "no-store"
    });
    if (token !== photoOpenToken) return;
    const blob = await decryptPhotoBytes(payload, password, session, target.victoryId);
    if (token !== photoOpenToken) return;
    photoObjectUrl = URL.createObjectURL(blob);
    photoImage.src = photoObjectUrl;
    photoImage.alt = `Preuve chiffrée pour ${target.name}`;
    photoImage.hidden = false;
    photoStatus.textContent = "";
  } catch (error) {
    if (token === photoOpenToken) {
      photoStatus.textContent = error.message;
    }
  } finally {
    if (token === photoOpenToken) trigger.disabled = false;
  }
}

function releasePhotoUrl() {
  if (!photoObjectUrl) return;
  URL.revokeObjectURL(photoObjectUrl);
  photoObjectUrl = "";
}

photoDialog.addEventListener("close", () => {
  photoOpenToken += 1;
  releasePhotoUrl();
  photoImage.removeAttribute("src");
  photoImage.hidden = true;
  photoStatus.textContent = "";
  if (photoTrigger) photoTrigger.disabled = false;
  const focusTarget = photoTrigger?.isConnected ? photoTrigger : photoFallbackFocus;
  photoTrigger = null;
  photoFallbackFocus = null;
  queueMicrotask(() => focusTarget?.focus());
});

window.addEventListener("pagehide", () => {
  photoOpenToken += 1;
  releasePhotoUrl();
});
