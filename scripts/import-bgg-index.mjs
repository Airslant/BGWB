import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse/sync";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const CSV_URL = "https://boardgamegeek.com/data_dumps/bg_ranks";
const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DB_PATH = ".data/bgwb.sqlite";
const DEFAULT_CSV_PATH = ".data/bgg/bg_ranks.csv";

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

function resolveProjectPath(path) {
  return isAbsolute(path) ? path : join(ROOT_DIR, path);
}

function normalizeSearchText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function pick(row, candidates) {
  const normalizedCandidates = new Set(candidates.map(normalizeHeader));

  for (const [key, value] of Object.entries(row)) {
    if (normalizedCandidates.has(normalizeHeader(key))) {
      return value;
    }
  }

  return undefined;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRank(value) {
  const parsed = parseNumber(value);
  return parsed && parsed > 0 ? Math.trunc(parsed) : null;
}

function rowToIndexEntry(row) {
  const bggId = String(pick(row, ["id", "objectid", "object id", "thingid", "thing id", "bggid", "bgg id"]) ?? "").trim();
  const name = String(pick(row, ["name", "title"]) ?? "").trim();

  if (!/^\d+$/.test(bggId) || !name) {
    return null;
  }

  return {
    bggId,
    name,
    nameSearch: normalizeSearchText(name),
    yearPublished: parseRank(pick(row, ["yearpublished", "year published", "year", "published"])),
    rank: parseRank(pick(row, ["rank", "boardgame rank", "boardgamerank"])),
    averageRating: parseNumber(pick(row, ["average", "average rating", "averagerating", "avg rating", "avgrating"]))
  };
}

async function downloadCsv(targetPath) {
  if ((process.env.BGG_INDEX_USE_EXISTING === "1" || process.argv.includes("--use-existing")) && existsSync(targetPath)) {
    return { bytes: readFileSync(targetPath).byteLength, source: "local" };
  }

  const token = process.env.BGG_API_TOKEN;
  const csvUrl = process.env.BGG_INDEX_CSV_URL ?? CSV_URL;

  if (!token) {
    throw new Error("BGG_API_TOKEN 未配置，无法下载 BGG CSV。");
  }

  const response = await fetch(csvUrl, {
    headers: {
      Accept: "text/csv,*/*",
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 401) {
    throw new Error("BGG token 无效或缺失，请确认 Authorization: Bearer <token> 和 boardgamegeek.com 域名。");
  }

  if (!response.ok) {
    throw new Error(`BGG CSV 下载失败：${response.status}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const preview = body.subarray(0, 256).toString("utf8").trimStart().toLowerCase();

  if (preview.startsWith("<!doctype") || preview.startsWith("<html")) {
    const html = body.toString("utf8");
    const csvHref = html.match(/href=["']([^"']+\.(?:csv|zip)(?:\?[^"']*)?)["']/i)?.[1];

    if (csvHref) {
      const resolvedUrl = new URL(csvHref, csvUrl).toString();
      const linkedResponse = await fetch(resolvedUrl, {
        headers: {
          Accept: "text/csv,*/*",
          Authorization: `Bearer ${token}`
        }
      });

      if (!linkedResponse.ok) {
        throw new Error(`BGG CSV 链接下载失败：${linkedResponse.status}`);
      }

      const linkedBody = Buffer.from(await linkedResponse.arrayBuffer());
      mkdirSync(dirname(targetPath), { recursive: true });
      const tempPath = `${targetPath}.tmp`;
      writeFileSync(tempPath, linkedBody);
      renameSync(tempPath, targetPath);
      return { bytes: linkedBody.length, source: "download" };
    }

    if (existsSync(targetPath)) {
      console.warn("BGG 返回了 HTML 页面而不是 CSV，改用已有的本地 CSV 文件。");
      return { bytes: readFileSync(targetPath).byteLength, source: "local" };
    }

    throw new Error("BGG 返回了 HTML 页面而不是 CSV，且页面中没有可解析的 CSV 链接。请确认应用已获准访问 data dump，或用 BGG_INDEX_CSV_URL 指定真实 CSV 下载地址。");
  }

  mkdirSync(dirname(targetPath), { recursive: true });

  const tempPath = `${targetPath}.tmp`;
  writeFileSync(tempPath, body);
  renameSync(tempPath, targetPath);

  return { bytes: body.length, source: "download" };
}

function importCsv(csvPath, dbPath) {
  const csv = readFileSync(csvPath, "utf8");
  const records = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  });
  const entries = [];
  const seen = new Set();

  for (const record of records) {
    const entry = rowToIndexEntry(record);

    if (!entry || seen.has(entry.bggId)) {
      continue;
    }

    seen.add(entry.bggId);
    entries.push(entry);
  }

  if (entries.length === 0) {
    throw new Error("CSV 中没有解析出可导入的桌游索引。");
  }

  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  const importedAt = new Date().toISOString();

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS game_index (
      bgg_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_search TEXT NOT NULL,
      year_published INTEGER,
      rank INTEGER,
      average_rating REAL,
      imported_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_game_index_name_search ON game_index (name_search);
    CREATE INDEX IF NOT EXISTS idx_game_index_rank ON game_index (rank);

    DROP TABLE IF EXISTS game_index_import;

    CREATE TABLE game_index_import (
      bgg_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_search TEXT NOT NULL,
      year_published INTEGER,
      rank INTEGER,
      average_rating REAL,
      imported_at TEXT NOT NULL
    );
  `);

  const gameIndexColumns = db.prepare("PRAGMA table_info(game_index)").all();

  if (!gameIndexColumns.some((column) => column.name === "year_published")) {
    db.exec("ALTER TABLE game_index ADD COLUMN year_published INTEGER");
  }

  const insertImport = db.prepare(
    `INSERT INTO game_index_import (
      bgg_id,
      name,
      name_search,
      year_published,
      rank,
      average_rating,
      imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  db.exec("BEGIN");

  try {
    for (const entry of entries) {
      insertImport.run(
        entry.bggId,
        entry.name,
        entry.nameSearch,
        entry.yearPublished,
        entry.rank,
        entry.averageRating,
        importedAt
      );
    }

    db.exec(`
      DELETE FROM game_index;
      INSERT INTO game_index (bgg_id, name, name_search, year_published, rank, average_rating, imported_at)
      SELECT bgg_id, name, name_search, year_published, rank, average_rating, imported_at
      FROM game_index_import;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("DROP TABLE IF EXISTS game_index_import;");
  }

  return entries.length;
}

async function main() {
  loadEnvFile(resolveProjectPath(".env.local"));
  loadEnvFile(resolveProjectPath(".env"));

  const dbPath = resolveProjectPath(process.env.BGWB_DB_PATH ?? DEFAULT_DB_PATH);
  const csvPath = resolveProjectPath(process.env.BGG_INDEX_CSV_PATH ?? DEFAULT_CSV_PATH);

  const { bytes, source } = await downloadCsv(csvPath);
  const imported = importCsv(csvPath, dbPath);

  console.log(`${source === "local" ? "Loaded" : "Downloaded"} ${bytes} bytes from ${source === "local" ? "local file" : "BGG"} at ${csvPath}`);
  console.log(`Imported ${imported} games into ${dbPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
