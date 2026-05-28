import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DB_PATH = ".data/bgwb.sqlite";
const DEFAULT_TRANSLATIONS_DIR = "translations";

function resolveProjectPath(path) {
  return isAbsolute(path) ? path : join(ROOT_DIR, path);
}

function normalizeSearchText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function unescapeCell(value) {
  return String(value ?? "")
    .replaceAll("<br>", "\n")
    .replaceAll("\\|", "|")
    .trim();
}

function splitMarkdownRow(line) {
  const trimmed = line.trim();

  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return null;
  }

  const cells = [];
  let current = "";

  for (let index = 1; index < trimmed.length - 1; index += 1) {
    const char = trimmed[index];
    const next = trimmed[index + 1];

    if (char === "\\" && next === "|") {
      current += "|";
      index += 1;
      continue;
    }

    if (char === "|") {
      cells.push(unescapeCell(current));
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(unescapeCell(current));
  return cells;
}

function getSection(text, heading) {
  const headingText = `## ${heading}`;
  const start = text.indexOf(headingText);

  if (start === -1) {
    return "";
  }

  const nextHeading = text.indexOf("\n## ", start + headingText.length);
  return text.slice(start, nextHeading === -1 ? text.length : nextHeading);
}

function parseTable(text, heading) {
  const section = getSection(text, heading);
  const rows = section
    .split(/\r?\n/)
    .map(splitMarkdownRow)
    .filter(Boolean);

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0];
  return rows.slice(2).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  );
}

function findLatestTranslationFile() {
  const directory = resolveProjectPath(DEFAULT_TRANSLATIONS_DIR);

  if (!existsSync(directory)) {
    throw new Error(`找不到翻译目录：${directory}`);
  }

  const candidates = readdirSync(directory)
    .filter((name) => /^bgg-translation-.*\.md$/.test(name))
    .map((name) => {
      const path = join(directory, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  if (candidates.length === 0) {
    throw new Error(`翻译目录里没有 bgg-translation-*.md：${directory}`);
  }

  return candidates[0].path;
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_localizations (
      bgg_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      name TEXT NOT NULL,
      name_search TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (bgg_id, locale)
    );

    CREATE INDEX IF NOT EXISTS idx_game_localizations_locale_name ON game_localizations (locale, name_search);

    CREATE TABLE IF NOT EXISTS game_content_localizations (
      bgg_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      description TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (bgg_id, locale)
    );

    CREATE TABLE IF NOT EXISTS game_term_localizations (
      term_type TEXT NOT NULL,
      locale TEXT NOT NULL,
      term TEXT NOT NULL,
      translation TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (term_type, locale, term)
    );

    CREATE INDEX IF NOT EXISTS idx_game_term_localizations_locale_type ON game_term_localizations (locale, term_type);
  `);
}

function importTranslations({ db, markdown }) {
  const now = new Date().toISOString();
  const gameRows = parseTable(markdown, "游戏名");
  const categoryRows = parseTable(markdown, "分类术语");
  const mechanicRows = parseTable(markdown, "机制术语");
  const descriptionRows = parseTable(markdown, "简介");

  const upsertName = db.prepare(
    `INSERT INTO game_localizations (bgg_id, locale, name, name_search, source, updated_at)
    VALUES (?, 'zh-CN', ?, ?, 'manual', ?)
    ON CONFLICT(bgg_id, locale) DO UPDATE SET
      name = excluded.name,
      name_search = excluded.name_search,
      source = excluded.source,
      updated_at = excluded.updated_at`
  );
  const upsertTerm = db.prepare(
    `INSERT INTO game_term_localizations (term_type, locale, term, translation, source, updated_at)
    VALUES (?, 'zh-CN', ?, ?, 'manual', ?)
    ON CONFLICT(term_type, locale, term) DO UPDATE SET
      translation = excluded.translation,
      source = excluded.source,
      updated_at = excluded.updated_at`
  );
  const upsertDescription = db.prepare(
    `INSERT INTO game_content_localizations (bgg_id, locale, description, source, updated_at)
    VALUES (?, 'zh-CN', ?, 'manual', ?)
    ON CONFLICT(bgg_id, locale) DO UPDATE SET
      description = excluded.description,
      source = excluded.source,
      updated_at = excluded.updated_at`
  );

  let names = 0;
  let categories = 0;
  let mechanics = 0;
  let descriptions = 0;

  db.exec("BEGIN");

  try {
    for (const row of gameRows) {
      const bggId = row["BGG ID"];
      const zhName = row["中文名（填写/修订）"] || row["现有中文名"];

      if (/^\d+$/.test(bggId) && zhName) {
        upsertName.run(bggId, zhName, normalizeSearchText(zhName), now);
        names += 1;
      }
    }

    for (const row of categoryRows) {
      const term = row["英文分类"];
      const translation = row["中文分类"];

      if (term && translation) {
        upsertTerm.run("category", term, translation, now);
        categories += 1;
      }
    }

    for (const row of mechanicRows) {
      const term = row["英文机制"];
      const translation = row["中文机制"];

      if (term && translation) {
        upsertTerm.run("mechanic", term, translation, now);
        mechanics += 1;
      }
    }

    for (const row of descriptionRows) {
      const bggId = row["BGG ID"];
      const description = row["中文简介"];

      if (/^\d+$/.test(bggId) && description) {
        upsertDescription.run(bggId, description, now);
        descriptions += 1;
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { names, categories, mechanics, descriptions };
}

function main() {
  const inputPath = resolveProjectPath(process.argv[2] ?? process.env.BGWB_TRANSLATION_INPUT_PATH ?? findLatestTranslationFile());
  const dbPath = resolveProjectPath(process.env.BGWB_DB_PATH ?? DEFAULT_DB_PATH);

  if (!existsSync(inputPath)) {
    throw new Error(`找不到翻译文件：${inputPath}`);
  }

  if (!existsSync(dbPath)) {
    throw new Error(`找不到数据库：${dbPath}`);
  }

  const db = new DatabaseSync(dbPath);
  ensureTables(db);

  const result = importTranslations({
    db,
    markdown: readFileSync(inputPath, "utf8")
  });

  console.log(`Imported translations from ${basename(inputPath)}`);
  console.log(`Names: ${result.names}`);
  console.log(`Categories: ${result.categories}`);
  console.log(`Mechanics: ${result.mechanics}`);
  console.log(`Descriptions: ${result.descriptions}`);
}

main();
