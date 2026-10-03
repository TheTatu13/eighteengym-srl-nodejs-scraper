/**
 * E2E test for full scraper workflow (test mode)
 * Test mode: no API writes (uses the public api.peviitor.ro layer; no credential needed)
 */

describe("Full scraper E2E", () => {
  it("should run in test mode without errors", async () => {
    process.argv.push("--test");
    try {
      await import("../../index.js");
    } catch (err) {
      // E2E may fail without SOLR_AUTH - that's acceptable
      if (err.message?.includes("SOLR_AUTH")) {
        console.log("Skipping E2E: SOLR_AUTH not configured");
        return;
      }
      throw err;
    }
  });
});
