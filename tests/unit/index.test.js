/**
 * Unit tests for index.js modules
 */

import { fetchCareersPage, mapToJobModel } from "../../index.js";

describe("fetchCareersPage", () => {
  it("should return job types and locations", async () => {
    const result = await fetchCareersPage();
    expect(result.jobTypes).toBeDefined();
    expect(result.locations).toBeDefined();
    expect(result.jobTypes.length).toBeGreaterThan(0);
    expect(result.locations.length).toBeGreaterThan(0);
  });
});

describe("mapToJobModel", () => {
  it("should map raw job to Solr model", () => {
    const rawJob = {
      url: "https://18gym.ro/cariere/",
      title: "Club manager",
      location: ["Cluj Napoca", "București"],
      workmode: "on-site"
    };

    const result = mapToJobModel(rawJob, "9829933", "EIGHTEENGYM SRL");

    expect(result.url).toBe(rawJob.url);
    expect(result.title).toBe(rawJob.title);
    expect(result.company).toBe("EIGHTEENGYM SRL");
    expect(result.cif).toBe("9829933");
    expect(result.location).toContain("Cluj Napoca");
    expect(result.status).toBe("activ");
    expect(result.date).toBeDefined();
  });
});
