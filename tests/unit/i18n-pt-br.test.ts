import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { LOCALES, LANGUAGES, DEFAULT_LOCALE, RTL_LOCALES } from "../../src/i18n/config";

describe("i18n UI catalog", () => {
  it("ships only the English UI messages file", () => {
    const messagesDir = path.resolve("src/i18n/messages");
    const files = fs.readdirSync(messagesDir).filter((file) => file.endsWith(".json")).sort();

    assert.deepStrictEqual(files, ["en.json"]);
  });

  it("exposes English as the only UI locale", () => {
    assert.deepStrictEqual([...LOCALES], ["en"]);
    assert.deepStrictEqual(
      LANGUAGES.map((language) => language.code),
      ["en"]
    );
    assert.strictEqual(DEFAULT_LOCALE, "en");
    assert.deepStrictEqual([...RTL_LOCALES], []);
  });

  it("keeps English critical dashboard keys", () => {
    const enPath = path.resolve("src/i18n/messages/en.json");
    const json = JSON.parse(fs.readFileSync(enPath, "utf8"));

    assert.ok(json.settings.routingAntigravitySignatureDesc);
    assert.ok(json.agents.howToUseStep1);
    assert.ok(json.cache.loadingCacheAria);
    assert.ok(json.analytics.usageAnalyticsTitle);
  });
});
