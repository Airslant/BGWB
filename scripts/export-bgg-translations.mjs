import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DB_PATH = ".data/bgwb.sqlite";
const DEFAULT_OUTPUT_DIR = "translations";

function resolveProjectPath(path) {
  return isAbsolute(path) ? path : join(ROOT_DIR, path);
}

function formatDate(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(value);
}

function parseSnapshot(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function escapeCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\r\n", "<br>")
    .replaceAll("\n", "<br>")
    .trim();
}

function decodeBasicHtml(value) {
  return String(value ?? "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&rsquo;", "'")
    .replaceAll("&lsquo;", "'")
    .replaceAll("&rdquo;", "\"")
    .replaceAll("&ldquo;", "\"")
    .replaceAll("&ndash;", "-")
    .replaceAll("&mdash;", "-")
    .replaceAll("&hellip;", "...")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownTable(headers, rows) {
  const header = `| ${headers.map(escapeCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);

  return [header, separator, ...body].join("\n");
}

function addTerm(termMap, terms, gameName) {
  for (const term of terms ?? []) {
    const cleanTerm = String(term ?? "").trim();

    if (!cleanTerm) {
      continue;
    }

    const refs = termMap.get(cleanTerm) ?? new Set();
    refs.add(gameName);
    termMap.set(cleanTerm, refs);
  }
}

function loadTermTranslations(db, termType) {
  try {
    const rows = db
      .prepare("SELECT term, translation FROM game_term_localizations WHERE term_type = ? AND locale = 'zh-CN'")
      .all(termType);

    return Object.fromEntries(rows.map((row) => [row.term, row.translation]));
  } catch {
    return {};
  }
}

function loadDescriptionTranslations(db) {
  try {
    const rows = db
      .prepare("SELECT bgg_id, description FROM game_content_localizations WHERE locale = 'zh-CN'")
      .all();

    return Object.fromEntries(rows.map((row) => [row.bgg_id, row.description]));
  } catch {
    return {};
  }
}

function buildReport(rows, translations) {
  const generatedDate = formatDate();
  const categories = new Map();
  const mechanics = new Map();

  const games = rows.map((row) => {
    const snapshot = parseSnapshot(row.payload_json);
    const englishName = snapshot.canonicalName || snapshot.name || row.name;
    const gameNameWithYear = row.year_published ? `${englishName} (${row.year_published})` : englishName;

    addTerm(categories, snapshot.categories, gameNameWithYear);
    addTerm(mechanics, snapshot.mechanics, gameNameWithYear);

    return {
      bggId: row.bgg_id,
      englishName,
      year: row.year_published ?? snapshot.yearPublished ?? "",
      zhName: row.zh_name ?? "",
      categories: snapshot.categories ?? [],
      mechanics: snapshot.mechanics ?? [],
      description: decodeBasicHtml(snapshot.description ?? ""),
      zhDescription: translations.descriptions[row.bgg_id] ?? ""
    };
  });

  const gameRows = games.map((game) => [
    game.bggId,
    game.englishName,
    game.year,
    game.zhName,
    "",
    ""
  ]);

  const categoryRows = Array.from(categories.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, refs]) => [term, translations.categories[term] ?? "", Array.from(refs).slice(0, 5).join("; ")]);

  const mechanicRows = Array.from(mechanics.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, refs]) => [term, translations.mechanics[term] ?? "", Array.from(refs).slice(0, 5).join("; ")]);

  const descriptionRows = games
    .filter((game) => game.description)
    .map((game) => [game.bggId, game.englishName, game.description, game.zhDescription]);

  return `# BGWB 桌游汉化清单 ${generatedDate}

> 来源：本地 SQLite \`games\` 表和 \`game_localizations\` 表；本次导出不请求 BGG。  
> 设计师保留原名，不列入翻译范围。分类和机制已按英文术语去重，回填时会按术语统一录入。简介来自当前本地 snapshot，长度以本地库记录为准。

## 游戏名

${markdownTable(["BGG ID", "英文名", "年份", "现有中文名", "中文名（填写/修订）", "备注"], gameRows)}

## 分类术语

${markdownTable(["英文分类", "中文分类", "出现于"], categoryRows)}

## 机制术语

${markdownTable(["英文机制", "中文机制", "出现于"], mechanicRows)}

## 简介

${markdownTable(["BGG ID", "英文名", "英文简介", "中文简介"], descriptionRows)}
`;
}

function main() {
  const dbPath = resolveProjectPath(process.env.BGWB_DB_PATH ?? DEFAULT_DB_PATH);
  const outputDir = resolveProjectPath(process.env.BGWB_TRANSLATION_OUTPUT_DIR ?? DEFAULT_OUTPUT_DIR);
  const outputPath = resolveProjectPath(
    process.env.BGWB_TRANSLATION_OUTPUT_PATH ?? join(outputDir, `bgg-translation-${formatDate()}.md`)
  );

  if (!existsSync(dbPath)) {
    throw new Error(`找不到数据库：${dbPath}`);
  }

  const db = new DatabaseSync(dbPath);
  const translations = {
    categories: loadTermTranslations(db, "category"),
    mechanics: loadTermTranslations(db, "mechanic"),
    descriptions: loadDescriptionTranslations(db)
  };
  const rows = db
    .prepare(
      `SELECT
        games.bgg_id,
        games.name,
        games.year_published,
        games.payload_json,
        games.updated_at,
        zh.name AS zh_name,
        COUNT(board_items.id) AS board_item_count
      FROM games
      LEFT JOIN game_localizations zh ON zh.bgg_id = games.bgg_id AND zh.locale = 'zh-CN'
      LEFT JOIN board_items ON board_items.bgg_id = games.bgg_id
      GROUP BY games.bgg_id
      ORDER BY
        board_item_count DESC,
        games.updated_at DESC,
        games.name ASC`
    )
    .all();

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buildReport(rows, translations), "utf8");

  console.log(`Exported ${rows.length} games to ${outputPath}`);
}

main();
