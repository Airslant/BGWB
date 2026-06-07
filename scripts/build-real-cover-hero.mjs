import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT_DIR, ".data/bgwb.sqlite");
const COVER_DIR = join(ROOT_DIR, ".data/covers");
const OUTPUT_DIR = join(ROOT_DIR, "public/assets/brand/candidates");
const BGG_XML_BASE_URL = "https://boardgamegeek.com/xmlapi2";

const HALL_OF_FAME_GAMES = [
  ["13", "Catan"],
  ["822", "Carcassonne"],
  ["31260", "Agricola"],
  ["36218", "Dominion"],
  ["30549", "Pandemic"],
  ["9209", "Ticket to Ride"],
  ["2651", "Power Grid"],
  ["93", "El Grande"],
  ["42", "Tigris & Euphrates"],
  ["12333", "Twilight Struggle"],
  ["28720", "Brass: Lancashire"],
  ["120677", "Terra Mystica"],
  ["182028", "Through the Ages"],
  ["124361", "Concordia"],
  ["84876", "The Castles of Burgundy"],
  ["68448", "7 Wonders"],
  ["5", "Acquire"],
  ["14105", "Commands & Colors: Ancients"],
  ["12", "Ra"],
  ["28143", "Race for the Galaxy"],
  ["3076", "Puerto Rico"],
  ["12942", "No Thanks!"],
  ["38453", "Space Hulk"],
  ["39856", "Dixit"],
  ["129622", "Love Letter"],
  ["172", "For Sale"],
  ["10630", "Memoir '44"],
  ["167791", "Terraforming Mars"]
];

const CANVASES = [
  {
    name: "a",
    title: "名人堂收藏墙",
    output: "bgwb-real-covers-hall-of-fame-option-a.png",
    games: ["13", "822", "31260", "36218", "30549", "9209", "2651", "93", "42", "12333", "28720", "120677", "182028", "124361", "84876"]
  },
  {
    name: "b",
    title: "名人堂全明星",
    output: "bgwb-real-covers-hall-of-fame-option-b.png",
    games: ["28720", "120677", "182028", "124361", "84876", "68448", "5", "3076", "28143", "12", "13", "822", "31260", "36218", "30549", "167791"]
  },
  {
    name: "c",
    title: "收藏墙与桌面拼局",
    output: "bgwb-real-covers-hall-of-fame-option-c.png",
    games: ["9209", "2651", "93", "42", "12333", "129622", "172", "10630", "167791", "39856", "38453", "14105", "13", "822", "30549", "28720"]
  }
];

function loadEnvFile(path) {
  if (!existsSync(path)) {
    return;
  }

  const content = readFileSync(path, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function getLocalCoverPath(bggId) {
  const dir = join(COVER_DIR, bggId);
  const candidates = ["image.jpg", "image.png", "image.webp", "thumbnail.jpg", "thumbnail.png", "thumbnail.webp"];
  const hit = candidates.find((name) => existsSync(join(dir, name)));
  return hit ? join(dir, hit) : "";
}

function getCoverUrlFromDb(db, bggId) {
  const row = db.prepare("SELECT payload_json FROM games WHERE bgg_id = ?").get(bggId);

  if (!row?.payload_json) {
    return "";
  }

  try {
    const payload = JSON.parse(row.payload_json);
    return payload.image || payload.thumbnail || "";
  } catch {
    return "";
  }
}

function normalizeBggImageUrl(url) {
  return String(url ?? "").replace(/__small\/img\/.*?\/fit-in\/200x150\/filters:strip_icc\(\)\//, "__original/img/");
}

async function fetchWithRetry(url, options = {}) {
  let lastError;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, options);

      if (response.status === 202 || response.status === 429 || response.status === 503) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        await new Promise((resolve) => setTimeout(resolve, Math.max(2500, retryAfter * 1000, 2000 * (attempt + 1))));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

async function getCoverUrlFromBggApi(bggId) {
  const token = process.env.BGG_API_TOKEN;
  const headers = { Accept: "application/xml" };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchWithRetry(`${BGG_XML_BASE_URL}/thing?id=${encodeURIComponent(bggId)}&type=boardgame&stats=0`, {
    headers
  });
  const xml = await response.text();
  const image = xml.match(/<image>(.*?)<\/image>/s)?.[1]?.trim();
  const thumbnail = xml.match(/<thumbnail>(.*?)<\/thumbnail>/s)?.[1]?.trim();

  return normalizeBggImageUrl(image || thumbnail || "");
}

function contentTypeToExt(contentType, url) {
  if (contentType.includes("png")) {
    return ".png";
  }

  if (contentType.includes("webp")) {
    return ".webp";
  }

  const urlExt = extname(new URL(url).pathname).toLowerCase();
  return [".png", ".webp", ".jpg", ".jpeg"].includes(urlExt) ? urlExt : ".jpg";
}

async function ensureCover(db, [bggId, name]) {
  const existing = getLocalCoverPath(bggId);

  if (existing) {
    return { bggId, name, path: existing, source: "local" };
  }

  const url = normalizeBggImageUrl(getCoverUrlFromDb(db, bggId)) || (await getCoverUrlFromBggApi(bggId));

  if (!url) {
    throw new Error(`No BGG cover URL found for ${bggId} ${name}`);
  }

  const response = await fetchWithRetry(url, {
    headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,*/*" }
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "";
  const ext = contentTypeToExt(contentType, url);
  const dir = join(COVER_DIR, bggId);
  const targetPath = join(dir, `image${ext}`);

  mkdirSync(dir, { recursive: true });
  writeFileSync(targetPath, buffer);
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        bggId,
        name,
        image: basename(targetPath),
        sourceUrl: url,
        cachedAt: new Date().toISOString()
      },
      null,
      2
    )
  );

  return { bggId, name, path: targetPath, source: "download" };
}

async function main() {
  loadEnvFile(join(ROOT_DIR, ".env.local"));
  loadEnvFile(join(ROOT_DIR, ".env"));
  mkdirSync(OUTPUT_DIR, { recursive: true });

  if (!existsSync(DB_PATH)) {
    throw new Error(`Database not found at ${DB_PATH}`);
  }

  const db = new DatabaseSync(DB_PATH);
  const coverMap = new Map();

  for (const game of HALL_OF_FAME_GAMES) {
    const cover = await ensureCover(db, game);
    coverMap.set(cover.bggId, cover);
    console.log(`${cover.source.toUpperCase()} ${cover.bggId} ${cover.name}`);
    await new Promise((resolve) => setTimeout(resolve, cover.source === "download" ? 1200 : 40));
  }

  const spec = {
    outputDir: OUTPUT_DIR,
    canvases: CANVASES.map((canvas) => ({
      ...canvas,
      covers: canvas.games.map((bggId) => coverMap.get(bggId)).filter(Boolean)
    }))
  };
  const specPath = join(OUTPUT_DIR, "bgwb-real-covers-hall-of-fame-spec.json");
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  console.log(`SPEC ${specPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
