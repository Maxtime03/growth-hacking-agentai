import { test, expect } from "@playwright/test";

const lead = { id: "lead-e2e-1", externalId: "lead-e2e-1", company: "Entreprise E2E", location: "Brabant wallon", kind: "Parc d'affaires", score: 82, confidence: 90, status: "À vérifier", temperature: "Chaud", recommendedOffer: "Pluq", phone: "+321234567", email: "contact@example.test", website: null, decisionMaker: null, operator: null, openingHours: null, description: null, chargers: 0, chargersWithin500m: 1, chargersWithin2km: 4, nearestChargerMeters: 450, sourceUrl: "https://maps.google.com/", coordinates: { lat: 50.66, lon: 4.61 } };

async function mockApis(page: import("@playwright/test").Page) {
  await page.route("https://maps.googleapis.com/maps/api/js**", (route) => route.abort());
  let completed = false;
  await page.route("**/api/opportunities**", async (route) => {
    if (route.request().method() === "POST") { completed = true; await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ runId: "e2e-run", status: "running", desiredLimit: 10 }) }); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { id: "e2e-run", status: completed ? "completed" : "completed", desiredLimit: 10, resultCount: 1 }, items: [lead], meta: { totalFound: 1, returned: 1, chargingStationsChecked: 3, chargingSource: "Open Charge Map", businessSource: "Apify", fetchedAt: new Date().toISOString() } }) });
  });
  await page.route("**/api/enrich", async (route) => await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ linkedinFound: false, lead, enrichment: { summary: "Résumé E2E", icebreaker: "Fait public E2E", whyNow: "Signal E2E", callBrief: ["Étape 1", "Étape 2", "Étape 3"], sources: ["https://example.test/source"] } }) }));
  await page.route("**/api/leads/lead-e2e-1", async (route) => await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: lead }) }));
  await page.route("**/api/leads?**", async (route) => await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [lead], meta: { page: 1, pageSize: 50, total: 1, pageCount: 1 } }) }));
}

test.describe("navigation réelle Chromium", () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => { (window as Window & { __e2eConsoleErrors?: string[] }).__e2eConsoleErrors = []; });
    await mockApis(page);
    await page.goto("/");
    await page.evaluate(() => { (window as Window & { __e2eConsoleErrors?: string[] }).__e2eConsoleErrors = []; });
    (page as unknown as { __errors?: string[] }).__errors = errors;
  });

  const entries = [
    ["/radar", "Radar", "Radar territorial"], ["/leads", "Leads", "Vos opportunités"], ["/enrichissement", "Enrichissement", "Chaque appel"],
    ["/appels", "File d'appels", "Le bon prospect"], ["/campagnes", "Campagnes", "Des emails"], ["/suivis", "Suivis", "Aucune conversation"],
    ["/content", "Content Studio", "Une présence"], ["/analyses", "Analyses", "Comprendre"], ["/settings/email", "Expéditeurs", "Des emails"], ["/settings", "Paramètres", "Paramètres"],
  ] as const;

  for (const [route, _linkName, title] of entries) {
    test(`clique ${route}`, async ({ page }) => {
      await page.locator(`nav a[href="${route}"]`).first().click({ force: true });
      await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}$`));
      await expect(page.locator("h1:visible").first()).toBeVisible();
      await expect(page.locator(".mobile-overlay,.drawer-backdrop")).toBeHidden();
      const errors = (page as unknown as { __errors?: string[] }).__errors || [];
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("clique Générer des leads et Relancer l’analyse sans lancer Apify réel", async ({ page }) => {
    await page.getByRole("link", { name: "Radar" }).click();
    await expect(page).toHaveURL(/\/radar$/);
    await page.getByRole("button", { name: /Générer 50 leads/i }).click();
    await expect(page.getByText(/Recherche de 50 leads lancée/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Collecte Apify en cours|Générer/i }).first()).toBeVisible();
    await page.getByRole("link", { name: "Leads" }).click();
    await page.getByRole("button", { name: /Générer des leads/i }).click();
    await expect(page).toHaveURL(/\/radar$/);
  });

  test("ouvre une ligne de lead, enrichit et revient à la file d’appels", async ({ page }) => {
    await page.getByRole("link", { name: "Leads" }).click();
    await page.locator("tbody tr").first().click();
    await expect(page).toHaveURL(/\/leads\/lead-e2e-1$/);
    await expect(page.locator("h1")).toContainText("Entreprise E2E");
    await page.getByRole("button", { name: /Rechercher plus d'informations/i }).click();
    await expect(page.getByRole("status")).toContainText(/Enrichissement terminé/i);
    await page.getByRole("link", { name: /Retour aux leads/i }).click();
    await expect(page).toHaveURL(/\/leads$/);
  });

  test("carte locale reste cliquable même si Google Maps est refusé", async ({ page }) => {
    await page.getByRole("link", { name: "Radar" }).click();
    const map = page.locator(".google-map-canvas");
    const errors = (page as unknown as { __errors?: string[] }).__errors || [];
    await expect(map).toBeVisible();
    await map.click({ position: { x: 250, y: 180 } });
    await expect(page.getByText(/Zone pointée sur la carte/i)).toBeVisible();
  });
});
