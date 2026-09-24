import test from "node:test";
import assert from "node:assert/strict";

const base = process.env.NETAI_TEST_BASE_URL || "http://127.0.0.1:3000";
const routes = ["/", "/radar", "/leads", "/enrichissement", "/appels", "/campagnes", "/suivis", "/content", "/analyses", "/settings/email", "/settings"];

test("navigation exposes real route links for every workspace section", async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const route of routes) assert.match(html, new RegExp(`href=\\"${route.replace("/", "\\/")}\\"`), `missing navigation link ${route}`);
});

test("workspace routes render their own visible section title", async () => {
  const expected = new Map([
    ["/", "Votre revenu"], ["/radar", "Radar territorial"], ["/leads", "Vos opportunités"],
    ["/enrichissement", "Chaque appel"], ["/appels", "Le bon prospect"], ["/campagnes", "Des emails"],
    ["/suivis", "Aucune conversation"], ["/content", "Une présence"], ["/analyses", "Comprendre"],
    ["/settings/email", "Des emails"], ["/settings", "Paramètres"],
  ]);
  for (const [route, title] of expected) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), new RegExp(title), route);
  }
});
