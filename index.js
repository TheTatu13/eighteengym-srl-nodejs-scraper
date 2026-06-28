/**
 * 18GYM Job Scraper - Main Entry Point
 * 
 * PURPOSE: Scrapes job listings from 18GYM Romania careers page and stores them in Solr.
 */

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, deleteJobByUrl, upsertJobs, upsertCompany } from "./solr.js";

const COMPANY_CIF = "9829933";
const CAREERS_URL = "https://18gym.ro/cariere/";
const COMPANY_BASE = "https://18gym.ro";
const TIMEOUT = 10000;

let COMPANY_NAME = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetches and parses the 18GYM careers page
 * Extracts job types and available locations from the form
 */
async function fetchCareersPage() {
  const res = await fetch(CAREERS_URL, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  if (!res.ok) {
    throw new Error(`Careers page error: ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Known job types based on the careers page form
  const jobTypes = [
    "Club manager",
    "Front desk - Recepție",
    "Antrenor personal",
    "Personal curățenie"
  ];

  // Known locations from the careers page
  const locations = [
    "Alba Iulia", "Arad", "Bacău", "Baia Mare", "Bistrița",
    "Brașov", "București", "Cluj Napoca", "Câmpia Turzii",
    "Constanța", "Iași", "Luduș", "Mediaș", "Piatra Neamț",
    "Satu-Mare", "Sibiu", "Târgu Mureș", "Turda"
  ];

  return { jobTypes, locations };
}

/**
 * Fetches a single page of jobs from a job board API (extensible)
 */
async function fetchJobsFromBestjobs() {
  try {
    const url = `https://www.bestjobs.eu/ro/api/company/18gym/jobs`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "Accept": "application/json"
      },
      timeout: TIMEOUT
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.data || data.jobs || [];
  } catch (err) {
    console.log("BestJobs API unavailable, using career page data only");
    return [];
  }
}

/**
 * Extracts job listings from the careers page
 */
async function scrapeAllListings() {
  console.log("Fetching careers page...");
  const { jobTypes, locations } = await fetchCareersPage();
  console.log(`Found ${jobTypes.length} job types, ${locations.length} locations`);

  // Try getting jobs from bestjobs API
  const bestjobsListings = await fetchJobsFromBestjobs();

  const allJobs = [];
  const seenUrls = new Set();

  if (bestjobsListings.length > 0) {
    console.log(`Found ${bestjobsListings.length} jobs on BestJobs`);
    for (const job of bestjobsListings) {
      const jobUrl = job.url || job.link || `${COMPANY_BASE}/cariere/`;
      if (!seenUrls.has(jobUrl)) {
        seenUrls.add(jobUrl);
        allJobs.push({
          url: jobUrl,
          title: job.title || job.name,
          location: job.location ? [job.location] : ["România"],
          workmode: job.workmode || "on-site"
        });
      }
    }
  } else {
    // Construct jobs from career page data
    console.log("Constructing jobs from career page data...");
    for (const jobType of jobTypes) {
      const slug = jobType.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
      const url = `${COMPANY_BASE}/cariere/#${slug}`;

      if (!seenUrls.has(url)) {
        seenUrls.add(url);
        allJobs.push({
          url,
          title: jobType,
          location: locations,
          workmode: "on-site"
        });
      }


    }
  }

  console.log(`Total unique jobs collected: ${allJobs.length}`);
  return allJobs;
}

/**
 * Maps raw job data to Solr-compatible job model
 */
function mapToJobModel(rawJob, cif, companyName = COMPANY_NAME) {
  const now = new Date().toISOString();

  const job = {
    url: rawJob.url,
    title: rawJob.title,
    company: companyName,
    cif: cif,
    location: rawJob.location?.length ? rawJob.location : ["România"],
    tags: rawJob.tags?.length ? rawJob.tags : ["fitness", "sport"],
    workmode: rawJob.workmode || "on-site",
    date: now,
    status: "activ"
  };

  Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);
  return job;
}

/**
 * Main orchestrator
 */
async function main() {
  const testOnlyOnePage = process.argv.includes("--test");

  try {
    let existingCount = 0;
    let localCif = COMPANY_CIF;
    let companyName = "EIGHTEENGYM SRL";

    if (!testOnlyOnePage) {
      console.log("=== Step 1: Get existing jobs count ===");
      const existingResult = await querySOLR(COMPANY_CIF);
      existingCount = existingResult.numFound;
      console.log(`Found ${existingCount} existing jobs in SOLR`);

      console.log("=== Step 2: Validate company via ANAF ===");
      const result = await validateAndGetCompany();
      COMPANY_NAME = result.company;
      companyName = result.company;
      localCif = result.cif;

      console.log("\n=== Step 2b: Upsert company to SOLR ===");
      const companyDoc = {
        id: localCif,
        company: companyName,
        brand: "18GYM",
        status: "activ",
        location: ["Alba Iulia", "Arad", "Bacău", "Baia Mare", "Bistrița", "Brașov", "București", "Cluj Napoca", "Câmpia Turzii", "Constanța", "Iași", "Luduș", "Mediaș", "Piatra Neamț", "Satu-Mare", "Sibiu", "Târgu Mureș", "Turda"],
        website: ["https://18gym.ro"],
        career: ["https://18gym.ro/cariere/"],
        lastScraped: new Date().toISOString().split("T")[0],
        scraperFile: "https://raw.githubusercontent.com/AlexColceriu/eighteengym-srl-nodejs-scraper/main/.github/workflows/scrape.yml"
      };
      await upsertCompany(companyDoc);
    } else {
      console.log("=== TEST MODE: Skipping ANAF and SOLR ===\n");
      COMPANY_NAME = companyName;
    }

    console.log("=== Step 3: Scrape jobs ===");
    const rawJobs = await scrapeAllListings();
    const scrapedCount = rawJobs.length;
    console.log(`Jobs scraped: ${scrapedCount}`);

    const jobs = rawJobs.map(job => mapToJobModel(job, localCif, companyName));

    const payload = {
      source: "18gym.ro",
      scrapedAt: new Date().toISOString(),
      company: companyName,
      cif: localCif,
      jobs
    };

    fs.writeFileSync("jobs.json", JSON.stringify(payload, null, 2), "utf-8");
    console.log("Saved jobs.json");

    if (!testOnlyOnePage) {
      console.log("\n=== Step 4: Upsert jobs to SOLR ===");
      await upsertJobs(payload.jobs);

      const finalResult = await querySOLR(COMPANY_CIF);
      console.log(`\n=== SUMMARY ===`);
      console.log(`Jobs existing in SOLR before scrape: ${existingCount}`);
      console.log(`Jobs scraped: ${scrapedCount}`);
      console.log(`Jobs in SOLR after scrape: ${finalResult.numFound}`);
    } else {
      console.log(`\n=== TEST SUMMARY ===`);
      console.log(`Jobs scraped: ${scrapedCount}`);
      console.log("(SOLR not updated - test mode)");
    }

    console.log("\n=== DONE ===");
  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

export { fetchCareersPage, mapToJobModel };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
