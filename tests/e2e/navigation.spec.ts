import { test, expect } from "@playwright/test";

const lead = { id: "lead-e2e-1", externalId: "lead-e2e-1", company: "Entreprise E2E", location: "Brabant wallon", city: "Wavre", region: "Brabant wallon", country: "BE", category: "Parc d'affaires", kind: "Parc d'affaires", score: 82, priorityScore: 86, confidence: 90, status: "enriched", pipelineStage: "negotiation", dealStatus: "negotiation", temperature: "chaud", recommendedOffer: "Pluq", phone: "+321234567", email: "contact@example.test", website: "https://example.test", linkedinUrl: "https://www.linkedin.com/in/example", latitude: 50.66, longitude: 4.61, googlePlaceId: "ChIJe2e-test", googleMapsUrl: "https://maps.google.com/?q=50.66,4.61", rating: 4.6, reviewCount: 27, address: "1 rue E2E, 1300 Wavre", description: "Entreprise de test Playwright", scoreBreakdown: { positive: ["Coordonnées complètes"], negative: [], missing: [], signals: ["Croissance"], fit: { pluq: 82 } }, workspace: { slug: "pluq", label: "Pluq" }, nextAction: "Préparer le rendez-vous", nextActionAt: new Date(Date.now() + 86400000).toISOString() };
const detail = { ...lead, contacts: [{ id: "contact-e2e", full_name: "Alice Exemple", title: "Direction", department: "Direction", confidence_score: 92, linkedin_url: lead.linkedinUrl, profile_photo_url: null }], evidence: [{ id: "proof-e2e", fact: "Fiche Google Business vérifiée", confidence: "verified", source_url: lead.googleMapsUrl, collected_at: new Date().toISOString() }], sources: [], activities: [], messages: [], enrichmentJobs: [], searchRun: { id: "e2e-run" } };

async function mockApis(page: import("@playwright/test").Page) {
  await page.route("https://maps.googleapis.com/maps/api/js**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "window.google = undefined;" }));
  let completed = false;
  await page.route("**/api/opportunities**", async (route) => {
    if (route.request().method() === "POST") { completed = true; await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ runId: "e2e-run", status: "running", desiredLimit: 10 }) }); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { id: "e2e-run", status: completed ? "completed" : "completed", desiredLimit: 10, resultCount: 1 }, items: [lead], meta: { totalFound: 1, returned: 1, chargingStationsChecked: 3, chargingSource: "Open Charge Map", businessSource: "Apify", fetchedAt: new Date().toISOString() } }) });
  });
  await page.route("**/api/enrich", async (route) => await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ jobId: "job-e2e", status: "queued", progress: 0 }) }));
  await page.route("**/api/enrich/job-e2e", async (route) => await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ job: { id: "job-e2e", status: "completed", progress: 100, result: { company: true, contact: true } } }) }));
  await page.route("**/api/leads/lead-e2e-1", async (route) => await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ item: detail }) }));
  await page.route("**/api/leads?**", async (route) => await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [lead], page: 1, pageSize: 50, total: 1, pageCount: 1, counts: { authorized: 1, hot: 1, pending: 1, overdue: 1, meeting: 0, negotiation: 1, won: 0, "workspace-pluq": 1 }, pipelineValue: 12000 }) }));
  await page.route("**/api/email/connections**", async (route) => await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) }));
  await page.route("**/api/email/internal-draft*", async (route) => { const base={ id:"draft-e2e", lead_id:lead.id, account_id:null, recipient:lead.email, subject:"Brouillon restauré", icebreaker:"Votre développement à Wavre est documenté dans la fiche du lead.", body:"Je vous contacte au sujet d’une opportunité vérifiée.", signature:"Net.AI OS", source_evidence:[{fact:"Localisation à Wavre",source:"Fiche lead"}], version:2 }; if(route.request().method()==="POST"){const input=route.request().postDataJSON();await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({draft:{...base,recipient:input.to,subject:input.subject,icebreaker:input.icebreaker,body:input.body,signature:input.signature,version:Number(input.expectedVersion||2)+1}})});return;}await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ draft:base, versions:[{id:"v2",version:2,subject:"Brouillon restauré",body:"Je vous contacte au sujet d’une opportunité vérifiée.",change_reason:"autosave",created_at:new Date().toISOString()}] }) }); });
  await page.route("**/api/calls", async (route) => await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok:true }) }));
  await page.route("**/api/leads/lead-e2e-1/reviews", async (route) => await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cached:false, attribution:"Google", limit:5, costUsd:null, insight:{summary:"Qualité et service — à valider."}, reviews:[{rating:5,text:"Service professionnel.",author:"Compte contrôlé"}] }) }));
}

test.describe("navigation réelle Chromium", () => {
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => { (window as Window & { __e2eConsoleErrors?: string[] }).__e2eConsoleErrors = []; });
    await mockApis(page);
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("nav a[href]").first().waitFor({ state: "visible" });
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
      await page.locator(`nav a[href="${route}"]`).first().click();
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
    await page.getByRole("button", { name: /générer .* leads/i }).click();
    await expect(page.getByText(/Recherche de 50 leads lanc/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Collecte Apify en cours|générer/i }).first()).toBeVisible();
    await page.getByRole("link", { name: "Leads" }).click();
    await page.getByRole("button", { name: /générer des leads/i }).click();
    await expect(page).toHaveURL(/\/radar$/);
  });

  test("ouvre une ligne de lead, enrichit et revient à la file d’appels", async ({ page }) => {
    await page.getByRole("link", { name: "Leads" }).click();
    await page.getByRole("link", { name: /Entreprise E2E/i }).first().click();
    await expect(page).toHaveURL(/\/leads\/lead-e2e-1$/);
    await expect(page.locator("h1")).toContainText("Alice Exemple");
    await page.getByRole("button", { name: /Rechercher plus d’informations/i }).click();
    await expect(page.getByText(/Job créé|Enrichissement terminé/i).first()).toBeVisible({timeout:5000});
    await page.getByRole("link", { name: /Retour aux leads/i }).click();
    await expect(page).toHaveURL(/\/leads$/);
  });

  test("onglets, filtres URL et KPI cliquables", async ({ page }) => {
    await page.getByRole("link", { name: "Leads" }).click();
    await expect(page.getByRole("link", { name: /Chauds/i })).toHaveAttribute("href", "/leads?temperature=chaud");
    await expect(page.getByRole("link", { name: /À enrichir/i })).toHaveAttribute("href", "/leads?enrichment=pending");
    await page.getByRole("tab", { name: "Chauds" }).click();
    await expect(page).toHaveURL(/temperature=chaud/);
    await page.getByRole("button", { name: "Tous les filtres" }).click();
    await page.getByLabel("Email").selectOption("true");
    await expect(page).toHaveURL(/hasEmail=true/);
    await page.getByRole("button", { name: /Lexicon/ }).click();
    await expect(page).toHaveURL(/workspace=lexicon/);
    await page.screenshot({ path: "test-results/leads-page.png", fullPage: true });
  });

  test("fiche complète, décideur et carte Google avec marqueur", async ({ page }) => {
    await page.goto("/leads/lead-e2e-1");
    await expect(page.getByRole("heading", { name: "Alice Exemple", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Décideurs" })).toBeVisible();
    await expect(page.getByTitle(/Carte Google/i)).toHaveAttribute("src", /50\.66,4\.61/);
    await expect(page.getByRole("link", { name: /Ouvrir dans Google Maps/i })).toHaveAttribute("href", /maps\.google/);
    await expect(page.getByText("Photo non publique").first()).toBeVisible();
    await page.screenshot({ path: "test-results/lead-detail.png", fullPage: true });
  });

  test("carte locale reste cliquable même si Google Maps est refusé", async ({ page }) => {
    await page.getByRole("link", { name: "Radar" }).click();
    const map = page.locator(".google-map-canvas");
    const errors = (page as unknown as { __errors?: string[] }).__errors || [];
    await expect(map).toBeVisible();
    await map.click({ position: { x: 250, y: 180 } });
    await expect(page.getByText(/Zone pointée sur la carte/i)).toBeVisible();
  });

  test("enrichissement tolère des champs fournisseur null et produit les captures CRM", async ({ page }) => {
    await page.route("**/api/opportunities**", route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({items:[{...lead,company:null,decisionMaker:undefined,email:null}],meta:{totalFound:1,returned:1,chargingStationsChecked:0,chargingSource:"Non utilisé",businessSource:"fixture",fetchedAt:new Date().toISOString()}})}));
    await page.goto("/enrichissement");
    await expect(page.locator(".nextjs-portal")).toHaveCount(0);
    await expect(page.getByRole("heading",{name:/Chaque appel/i})).toBeVisible();
    await page.screenshot({path:"test-results/email-crm/enrichissement-null-safe.png",fullPage:true});
    await page.goto("/appels");
    await expect(page.getByRole("heading",{name:/Le bon prospect/i})).toBeVisible();
    await page.screenshot({path:"test-results/email-crm/appels-persistants.png",fullPage:true});
  });

  test("restaure le brouillon durable et capture l’éditeur", async ({ page }) => {
    await page.goto("/leads/lead-e2e-1");
    await expect(page.locator('input[value="Brouillon restauré"]')).toBeVisible();
    await expect(page.getByText(/Enregistré · v[23]/i)).toBeVisible();
    await page.screenshot({path:"test-results/email-crm/editeur-brouillon-restaure.png",fullPage:true});
  });

  test("ouvre le formulaire manuel et le mode Grands Comptes", async ({ page }) => {
    await page.goto("/leads");await page.getByRole("button",{name:/Ajouter un lead/i}).click();
    await expect(page.getByRole("dialog",{name:/Ajouter un lead manuellement/i})).toBeVisible();
    await page.screenshot({path:"test-results/email-crm/formulaire-lead-manuel.png",fullPage:true});
    await page.getByRole("button",{name:"Fermer"}).click();await page.goto("/radar");await page.getByRole("button",{name:/Grands Comptes/i}).click();
    await expect(page.getByText(/organisations complexes/i)).toBeVisible();
    await expect(page.getByText(/Open Charge Map/i)).toHaveCount(0);
    await page.screenshot({path:"test-results/email-crm/radar-grands-comptes.png",fullPage:true});
  });
});
