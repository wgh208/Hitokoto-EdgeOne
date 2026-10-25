#!/usr/bin/env node
/**
 * Download the official Hitokoto sentence bundle and replace ./sentences.
 *
 * Source: https://github.com/hitokoto-osc/sentences-bundle/tree/master/sentences
 *
 * The script is intentionally dependency-free so it can run both locally and
 * inside GitHub Actions.  It also regenerates sentences/index.json, which the
 * EdgeOne function bundles.
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sentencesDir = path.join(root, "sentences");
const baseUrl =
  "https://raw.githubusercontent.com/hitokoto-osc/sentences-bundle/master";

const headers = {
  Accept: "application/json",
  "User-Agent": "hitokoto-edgeone-sentences-sync",
};

async function download(relativePath, attempts = 3) {
  const url = `${baseUrl}/${relativePath}`;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
  }

  throw new Error(`Failed to download ${url}: ${lastError?.message || lastError}`);
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

console.log("Downloading official categories.json ...");
const categoriesText = await download("categories.json");
const categories = parseJson(categoriesText, "categories.json");

if (!Array.isArray(categories)) {
  throw new Error("categories.json did not contain an array");
}

const keys = [
  ...new Set(
    categories
      .map((category) => String(category?.key ?? "").toLowerCase())
      .filter((key) => /^[a-z]$/.test(key)),
  ),
].sort();

if (keys.length === 0) {
  throw new Error("No valid category keys found in categories.json");
}

const versionText = await download("version.json");
parseJson(versionText, "version.json");

// Download and validate everything first, so a network failure cannot leave
// the repository with a half-updated corpus.
const corpus = new Map();
let total = 0;
for (const key of keys) {
  const file = `sentences/${key}.json`;
  const text = await download(file);
  const list = parseJson(text, file);
  if (!Array.isArray(list)) {
    throw new Error(`${file} did not contain an array`);
  }
  corpus.set(key, text);
  total += list.length;
  console.log(`  ${key}.json: ${list.length} sentences`);
}

await writeFile(path.join(root, "categories.json"), categoriesText);
await writeFile(path.join(root, "version.json"), versionText);
for (const [key, text] of corpus) {
  await writeFile(path.join(sentencesDir, `${key}.json`), text);
}

// Drop categories that disappeared upstream, but keep index.json (regenerated
// below) and any non-category files.
const existing = await readdir(sentencesDir);
const keep = new Set(keys.map((key) => `${key}.json`));
for (const name of existing) {
  if (/^[a-z]\.json$/.test(name) && !keep.has(name)) {
    await unlink(path.join(sentencesDir, name));
    console.log(`  removed stale ${name}`);
  }
}

console.log("Rebuilding sentences/index.json ...");
execFileSync(process.execPath, [path.join(root, "scripts", "build-index.mjs")], {
  cwd: root,
  stdio: "inherit",
});

console.log(`Synced ${keys.length} categories, ${total} sentences.`);
