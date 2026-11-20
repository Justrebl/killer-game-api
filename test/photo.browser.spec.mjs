import { expect, test } from "@playwright/test";
import { encryptPhotoBytes } from "../docs/crypto.js";

const password = "test-password-with-length";
const victoryId = "victory-test";
const session = {
  encryptionSalt: Buffer.alloc(16, 4).toString("base64"),
  kdfIterations: 100000,
  targets: [{
    id: "target-test",
    name: "Alice",
    condition: "Faire rire Bob",
    victoryId,
    completedAt: "2026-11-20T00:00:00.000Z",
    photoPresent: true
  }]
};
const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
  "base64"
);

async function preparePage(page, photoRoute) {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    window.__revokedUrls = 0;
    URL.revokeObjectURL = (url) => {
      window.__revokedUrls += 1;
      original(url);
    };
  });
  await page.route("**/api/login", (route) => route.fulfill({
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    },
    json: { token: "session-token", session }
  }));
  await page.route("**/api/photos/victory-test", photoRoute);
  await page.goto("/");
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Ouvrir les dossiers" }).click();
}

test("photo viewer decrypts, is keyboard accessible, and revokes its URL", async ({ page }) => {
  const payload = await encryptPhotoBytes(jpeg, password, session, victoryId);
  await preparePage(page, (route) => route.fulfill({
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "private, no-store",
      "Content-Type": "application/octet-stream"
    },
    body: Buffer.from(payload)
  }));
  const trigger = page.getByRole("button", { name: "Voir la photo de Alice" });

  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("img", { name: "Preuve chiffrée pour Alice" })).toBeVisible();
  await expect(page.getByRole("img")).toHaveJSProperty("complete", true);
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__revokedUrls)).toBeGreaterThan(0);
});

test("photo viewer reports API failures inside the dialog", async ({ page }) => {
  await preparePage(page, (route) => route.fulfill({
    status: 404,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    },
    json: { error: "Photo introuvable" }
  }));

  await page.getByRole("button", { name: "Voir la photo de Alice" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("Photo introuvable");
  await page.keyboard.press("Escape");
});

test("closing before photo decryption prevents a stale image assignment", async ({ page }) => {
  const payload = await encryptPhotoBytes(jpeg, password, session, victoryId);
  await preparePage(page, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/octet-stream"
      },
      body: Buffer.from(payload)
    });
  });

  const trigger = page.getByRole("button", { name: "Voir la photo de Alice" });
  await trigger.click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await expect(page.locator("#photo-image")).toBeHidden();
  await expect(page.locator("#photo-image")).not.toHaveAttribute("src");
  await expect(trigger).toBeFocused();
});

test("photo dialog returns focus to the target when its trigger is detached", async ({ page }) => {
  const payload = await encryptPhotoBytes(jpeg, password, session, victoryId);
  await preparePage(page, (route) => route.fulfill({
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "private, no-store",
      "Content-Type": "application/octet-stream"
    },
    body: Buffer.from(payload)
  }));
  const trigger = page.getByRole("button", { name: "Voir la photo de Alice" });
  const targetHeading = page.getByRole("heading", { name: "Alice" });

  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await trigger.evaluate((element) => element.remove());
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(targetHeading).toBeFocused();
});
