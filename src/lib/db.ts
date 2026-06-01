import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";

import { getDefaultBoardTitle } from "./i18n";
import { decodeHtmlEntities } from "./html-entities";
import type {
  BggSearchResult,
  AdminGameDetail,
  AdminGameSummary,
  AdminTermTranslation,
  AdminUser,
  AdminUserSummary,
  AdminTranslationImportResult,
  Board,
  BoardAnnotation,
  BoardItem,
  CardCoverMode,
  EmailCodePurpose,
  GameSnapshot,
  Locale,
  LocalizedAliases,
  LocalizedText,
  LocalizedTextList,
  User,
  UserRole,
  BoardSummary,
  Viewport
} from "./types";

type SqliteStatement = {
  get: (...values: unknown[]) => unknown;
  all: (...values: unknown[]) => unknown[];
  run: (...values: unknown[]) => unknown;
};

type SqliteDatabase = {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatement;
};

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };
const DEFAULT_USER_MAX_BOARDS = 20;
const MAX_USER_MAX_BOARDS = 500;

let database: SqliteDatabase | undefined;

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function normalizeUserMaxBoards(value: unknown) {
  return clampInteger(value, 0, MAX_USER_MAX_BOARDS, DEFAULT_USER_MAX_BOARDS);
}

function normalizeCoverMode(value: unknown): CardCoverMode {
  return value === "uniform" ? "uniform" : "native";
}

function ensureBoardItemColumns(db: SqliteDatabase) {
  const columns = db.prepare("PRAGMA table_info(board_items)").all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === "cover_mode")) {
    db.exec("ALTER TABLE board_items ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'native'");
  }
}

function ensureGameIndexColumns(db: SqliteDatabase) {
  const columns = db.prepare("PRAGMA table_info(game_index)").all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === "year_published")) {
    db.exec("ALTER TABLE game_index ADD COLUMN year_published INTEGER");
  }
}

function ensureUserColumns(db: SqliteDatabase) {
  const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === "nickname")) {
    db.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some((column) => column.name === "role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  }
  if (!columns.some((column) => column.name === "disabled_at")) {
    db.exec("ALTER TABLE users ADD COLUMN disabled_at TEXT");
  }
  if (!columns.some((column) => column.name === "disabled_reason")) {
    db.exec("ALTER TABLE users ADD COLUMN disabled_reason TEXT");
  }
  if (!columns.some((column) => column.name === "updated_at")) {
    db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE users SET updated_at = created_at WHERE updated_at = ''");
  }
  if (!columns.some((column) => column.name === "email_verified_at")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
    db.exec("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL");
  }
  if (!columns.some((column) => column.name === "max_boards")) {
    db.exec(`ALTER TABLE users ADD COLUMN max_boards INTEGER NOT NULL DEFAULT ${DEFAULT_USER_MAX_BOARDS}`);
  }
}

function tableExists(db: SqliteDatabase, tableName: string) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);

  return Boolean(row);
}

function migrateLegacyBoardTables(db: SqliteDatabase) {
  if (!tableExists(db, "boards")) {
    return;
  }

  const boardColumns = db.prepare("PRAGMA table_info(boards)").all() as Array<{ name: string }>;
  const itemColumns = tableExists(db, "board_items")
    ? (db.prepare("PRAGMA table_info(board_items)").all() as Array<{ name: string }>)
    : [];
  const hasNewBoardSchema = boardColumns.some((column) => column.name === "id") && boardColumns.some((column) => column.name === "owner_user_id");
  const hasNewItemSchema = itemColumns.some((column) => column.name === "board_id");

  if (hasNewBoardSchema && hasNewItemSchema) {
    return;
  }

  db.exec(`
    DROP TABLE IF EXISTS board_items;
    DROP TABLE IF EXISTS boards;
  `);
}

function resolveDbPath() {
  const configuredPath = process.env.BGWB_DB_PATH ?? ".data/bgwb.sqlite";
  return isAbsolute(configuredPath) ? configuredPath : join(process.cwd(), configuredPath);
}

function getDb() {
  if (database) {
    return database;
  }

  const dbPath = resolveDbPath();
  const dbDir = dirname(dbPath);

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  database = new DatabaseSync(dbPath);
  migrateLegacyBoardTables(database);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      max_boards INTEGER NOT NULL DEFAULT 20,
      disabled_at TEXT,
      disabled_reason TEXT,
      email_verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      last_sent_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      request_ip_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_email_codes_email_purpose ON email_verification_codes (email, purpose, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_codes_ip ON email_verification_codes (request_ip_hash, created_at);

    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      share_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      viewport_json TEXT NOT NULL,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_boards_owner_user_id ON boards (owner_user_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_boards_share_id ON boards (share_id);

    CREATE TABLE IF NOT EXISTS games (
      bgg_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_search TEXT NOT NULL,
      year_published INTEGER,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_fetched_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_games_name_search ON games (name_search);

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

    CREATE TABLE IF NOT EXISTS game_aliases (
      id TEXT PRIMARY KEY,
      bgg_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      alias TEXT NOT NULL,
      alias_search TEXT NOT NULL,
      source TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_game_aliases_locale_alias ON game_aliases (locale, alias_search);
    CREATE INDEX IF NOT EXISTS idx_game_aliases_bgg_locale ON game_aliases (bgg_id, locale);

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

    CREATE TABLE IF NOT EXISTS board_items (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      bgg_id TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      scale REAL NOT NULL,
      cover_mode TEXT NOT NULL DEFAULT 'native',
      note TEXT NOT NULL,
      status TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
      FOREIGN KEY (bgg_id) REFERENCES games(bgg_id) ON DELETE RESTRICT
    );

    CREATE INDEX IF NOT EXISTS idx_board_items_board_id ON board_items (board_id, sort_order);

    CREATE TABLE IF NOT EXISTS board_annotations (
      id TEXT PRIMARY KEY,
      board_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      text TEXT NOT NULL,
      style_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_board_annotations_board_id ON board_annotations (board_id, sort_order);

    CREATE TABLE IF NOT EXISTS bgg_cache (
      cache_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
  ensureUserColumns(database);
  ensureBoardItemColumns(database);
  ensureGameIndexColumns(database);

  return database;
}

function normalizeSearchText(value: string) {
  return decodeHtmlEntities(value).trim().toLowerCase();
}

function sanitizeBoardTitle(value: string | undefined, locale: Locale) {
  return value?.trim().slice(0, 20) || getDefaultBoardTitle(locale);
}

function escapeLike(value: string) {
  return value.replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function getDisplayName(localizedNames: LocalizedText | undefined, canonicalName: string, locale: Locale) {
  return decodeHtmlEntities(localizedNames?.[locale] || localizedNames?.en || canonicalName);
}

function getLocalizedDescription(bggId: string, locale: Locale) {
  if (locale === "en") {
    return undefined;
  }

  const row = getDb()
    .prepare("SELECT description FROM game_content_localizations WHERE bgg_id = ? AND locale = ?")
    .get(bggId, locale) as { description: string } | undefined;

  return row?.description;
}

function getTermTranslations(termType: "category" | "mechanic", locale: Locale, terms: string[]) {
  const cleanTerms = Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean)));

  if (locale === "en" || cleanTerms.length === 0) {
    return {};
  }

  const placeholders = cleanTerms.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT term, translation
      FROM game_term_localizations
      WHERE term_type = ? AND locale = ? AND term IN (${placeholders})`
    )
    .all(termType, locale, ...cleanTerms) as Array<{ term: string; translation: string }>;

  return Object.fromEntries(rows.map((row) => [row.term, row.translation]));
}

function localizeTermList(termType: "category" | "mechanic", locale: Locale, terms: string[]) {
  const translations = getTermTranslations(termType, locale, terms);
  return terms.map((term) => translations[term] || term);
}

function safeParseItems(value: string) {
  try {
    return JSON.parse(value) as Array<Partial<BoardItem>>;
  } catch {
    return [];
  }
}

function safeParseViewport(value: string) {
  try {
    return JSON.parse(value) as Viewport;
  } catch {
    return DEFAULT_VIEWPORT;
  }
}

function normalizeRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "user";
}

function rowToUser(row: unknown): AdminUser | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const value = row as {
    id: string;
    nickname?: string;
    email: string;
    role?: string;
    max_boards?: number;
    disabled_at?: string | null;
    disabled_reason?: string | null;
    created_at: string;
    updated_at?: string;
  };

  return {
    id: value.id,
    nickname: value.nickname ?? "",
    email: value.email,
    role: normalizeRole(value.role),
    maxBoards: normalizeUserMaxBoards(value.max_boards),
    disabledAt: value.disabled_at ?? null,
    disabledReason: value.disabled_reason ?? null,
    createdAt: value.created_at,
    updatedAt: value.updated_at || value.created_at
  };
}

export type UserWithPassword = AdminUser & {
  passwordHash: string;
};

function rowToUserWithPassword(row: unknown): UserWithPassword | null {
  const user = rowToUser(row);

  if (!user || !row || typeof row !== "object") {
    return null;
  }

  return {
    ...user,
    passwordHash: (row as { password_hash: string }).password_hash
  };
}

export function createUser(
  email: string,
  nickname: string,
  passwordHash: string,
  role: UserRole = "user",
  emailVerifiedAt?: string
) {
  const now = new Date().toISOString();
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO users (id, nickname, email, password_hash, role, max_boards, email_verified_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, nickname, email, passwordHash, role, DEFAULT_USER_MAX_BOARDS, emailVerifiedAt ?? now, now, now);

  const user = getUserById(id);

  if (!user) {
    throw new Error("Created user could not be reloaded.");
  }

  return user;
}

export function setUserPassword(userId: string, passwordHash: string) {
  const now = new Date().toISOString();

  getDb()
    .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(passwordHash, now, userId);

  return getUserById(userId);
}

export function updateUserNickname(userId: string, nickname: string) {
  const now = new Date().toISOString();

  getDb()
    .prepare("UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?")
    .run(nickname, now, userId);

  return getUserById(userId);
}

export function updateUserMaxBoards(userId: string, maxBoards: number) {
  const normalizedMaxBoards = normalizeUserMaxBoards(maxBoards);
  const now = new Date().toISOString();

  getDb()
    .prepare("UPDATE users SET max_boards = ?, updated_at = ? WHERE id = ?")
    .run(normalizedMaxBoards, now, userId);

  return getUserById(userId);
}

export type EmailVerificationCodeRecord = {
  id: string;
  email: string;
  purpose: EmailCodePurpose;
  codeHash: string;
  attempts: number;
  expiresAt: string;
  consumedAt: string | null;
  lastSentAt: string;
  createdAt: string;
  requestIpHash: string;
};

function rowToEmailCode(row: unknown): EmailVerificationCodeRecord | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const value = row as {
    id: string;
    email: string;
    purpose: EmailCodePurpose;
    code_hash: string;
    attempts: number;
    expires_at: string;
    consumed_at: string | null;
    last_sent_at: string;
    created_at: string;
    request_ip_hash: string;
  };

  return {
    id: value.id,
    email: value.email,
    purpose: value.purpose,
    codeHash: value.code_hash,
    attempts: value.attempts,
    expiresAt: value.expires_at,
    consumedAt: value.consumed_at,
    lastSentAt: value.last_sent_at,
    createdAt: value.created_at,
    requestIpHash: value.request_ip_hash
  };
}

export function cleanupEmailVerificationCodes() {
  const now = new Date().toISOString();
  const consumedBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  getDb()
    .prepare("DELETE FROM email_verification_codes WHERE expires_at <= ? OR (consumed_at IS NOT NULL AND consumed_at <= ?)")
    .run(now, consumedBefore);
}

export function countEmailCodeRequestsForEmail(email: string, purpose: EmailCodePurpose, sinceIso: string) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total
      FROM email_verification_codes
      WHERE email = ? AND purpose = ? AND created_at >= ?`
    )
    .get(email, purpose, sinceIso) as { total: number };

  return row.total;
}

export function countEmailCodeRequestsForIp(requestIpHash: string, sinceIso: string) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total
      FROM email_verification_codes
      WHERE request_ip_hash = ? AND created_at >= ?`
    )
    .get(requestIpHash, sinceIso) as { total: number };

  return row.total;
}

export function getLatestEmailVerificationCode(email: string, purpose: EmailCodePurpose) {
  const row = getDb()
    .prepare(
      `SELECT *
      FROM email_verification_codes
      WHERE email = ? AND purpose = ?
      ORDER BY created_at DESC
      LIMIT 1`
    )
    .get(email, purpose);

  return rowToEmailCode(row);
}

export function createEmailVerificationCode({
  email,
  purpose,
  codeHash,
  expiresAt,
  requestIpHash
}: {
  email: string;
  purpose: EmailCodePurpose;
  codeHash: string;
  expiresAt: string;
  requestIpHash: string;
}) {
  const now = new Date().toISOString();
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO email_verification_codes (
        id,
        email,
        purpose,
        code_hash,
        attempts,
        expires_at,
        consumed_at,
        last_sent_at,
        created_at,
        request_ip_hash
      ) VALUES (?, ?, ?, ?, 0, ?, NULL, ?, ?, ?)`
    )
    .run(id, email, purpose, codeHash, expiresAt, now, now, requestIpHash);

  return getLatestEmailVerificationCode(email, purpose);
}

export function incrementEmailVerificationCodeAttempts(codeId: string) {
  getDb().prepare("UPDATE email_verification_codes SET attempts = attempts + 1 WHERE id = ?").run(codeId);
}

export function consumeEmailVerificationCode(codeId: string) {
  getDb()
    .prepare("UPDATE email_verification_codes SET consumed_at = ? WHERE id = ?")
    .run(new Date().toISOString(), codeId);
}

export function getUserByEmail(email: string) {
  const row = getDb()
    .prepare(
      `SELECT id, nickname, email, password_hash, role, max_boards, disabled_at, disabled_reason, created_at, updated_at
      FROM users
      WHERE email = ?`
    )
    .get(email);

  return rowToUserWithPassword(row);
}

export function getUserWithPasswordById(userId: string) {
  const row = getDb()
    .prepare(
      `SELECT id, nickname, email, password_hash, role, max_boards, disabled_at, disabled_reason, created_at, updated_at
      FROM users
      WHERE id = ?`
    )
    .get(userId);

  return rowToUserWithPassword(row);
}

export function getUserById(userId: string) {
  const row = getDb()
    .prepare(
      `SELECT id, nickname, email, role, max_boards, disabled_at, disabled_reason, created_at, updated_at
      FROM users
      WHERE id = ?`
    )
    .get(userId);

  return rowToUser(row);
}

export function createSession(userId: string, tokenHash: string, expiresAt: string) {
  const now = new Date().toISOString();
  const id = randomUUID();

  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, userId, tokenHash, expiresAt, now);
}

export function getUserBySessionTokenHash(tokenHash: string) {
  const now = new Date().toISOString();

  getDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);

  const row = getDb()
    .prepare(
      `SELECT users.id, users.nickname, users.email, users.role, users.max_boards, users.disabled_at, users.disabled_reason, users.created_at, users.updated_at
      FROM sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
    )
    .get(tokenHash, now);

  return rowToUser(row);
}

export function deleteSession(tokenHash: string) {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteSessionsForUser(userId: string) {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function deleteUserAccount(userId: string) {
  const db = getDb();

  db.exec("BEGIN");

  try {
    deleteSessionsForUser(userId);
    const result = db.prepare("DELETE FROM users WHERE id = ?").run(userId) as { changes?: number };
    db.exec("COMMIT");

    return (result.changes ?? 0) > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setUserRole(userId: string, role: UserRole) {
  const now = new Date().toISOString();

  getDb()
    .prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
    .run(role, now, userId);

  return getUserById(userId);
}

export function setUserDisabled(userId: string, disabled: boolean, reason = "") {
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE users
      SET disabled_at = ?,
          disabled_reason = ?,
          updated_at = ?
      WHERE id = ?`
    )
    .run(disabled ? now : null, disabled ? reason.trim().slice(0, 200) : null, now, userId);

  if (disabled) {
    deleteSessionsForUser(userId);
  }

  return getUserById(userId);
}

export function listAdminUsers({
  page = 1,
  pageSize = 20,
  query = "",
  status = "all"
}: {
  page?: number;
  pageSize?: number;
  query?: string;
  status?: "all" | "active" | "disabled";
}) {
  const normalizedQuery = normalizeSearchText(query);
  const filters: string[] = [];
  const values: unknown[] = [];

  if (normalizedQuery) {
    const likeQuery = `%${escapeLike(normalizedQuery)}%`;
    filters.push("(LOWER(users.email) LIKE ? ESCAPE '\\' OR LOWER(users.nickname) LIKE ? ESCAPE '\\')");
    values.push(likeQuery, likeQuery);
  }

  if (status === "active") {
    filters.push("users.disabled_at IS NULL");
  } else if (status === "disabled") {
    filters.push("users.disabled_at IS NOT NULL");
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (Math.max(page, 1) - 1) * pageSize;
  const rows = getDb()
    .prepare(
      `SELECT
        users.id,
        users.nickname,
        users.email,
        users.role,
        users.max_boards,
        users.disabled_at,
        users.disabled_reason,
        users.created_at,
        users.updated_at,
        COUNT(DISTINCT boards.id) AS board_count,
        COUNT(board_items.id) AS item_count
      FROM users
      LEFT JOIN boards ON boards.owner_user_id = users.id
      LEFT JOIN board_items ON board_items.board_id = boards.id
      ${whereClause}
      GROUP BY users.id
      ORDER BY users.created_at DESC
      LIMIT ? OFFSET ?`
    )
    .all(...values, pageSize, offset) as Array<{
    id: string;
    nickname: string;
    email: string;
    role: UserRole;
    max_boards: number;
    disabled_at: string | null;
    disabled_reason: string | null;
    created_at: string;
    updated_at: string;
    board_count: number;
    item_count: number;
  }>;
  const totalRow = getDb()
    .prepare(`SELECT COUNT(*) AS total FROM users ${whereClause}`)
    .get(...values) as { total: number };

  return {
    users: rows.map((row) => ({
      id: row.id,
      nickname: row.nickname,
      email: row.email,
      role: normalizeRole(row.role),
      maxBoards: normalizeUserMaxBoards(row.max_boards),
      disabledAt: row.disabled_at,
      disabledReason: row.disabled_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      boardCount: row.board_count,
      itemCount: row.item_count
    })) satisfies AdminUserSummary[],
    total: totalRow.total,
    page,
    pageSize
  };
}

function minimalGameSnapshot(bggId: string): GameSnapshot {
  return {
    bggId,
    name: `BGG #${bggId}`,
    designers: [],
    categories: [],
    mechanics: []
  };
}

function serializeBoardItems(items: BoardItem[]) {
  return items.map((item) => ({
    id: item.id,
    bggId: item.bggId,
    x: item.x,
    y: item.y,
    scale: item.scale,
    coverMode: normalizeCoverMode(item.coverMode),
    note: item.note,
    status: item.status
  }));
}

function serializeBoardAnnotations(annotations: BoardAnnotation[]) {
  return annotations.map((annotation) => ({
    id: annotation.id,
    kind: annotation.kind,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    text: annotation.text,
    style: annotation.style,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt
  }));
}

function loadBoardItems(boardId: string, locale: Locale) {
  const rows = getDb()
    .prepare(
      `SELECT
        board_items.id,
        board_items.bgg_id,
        board_items.x,
        board_items.y,
        board_items.scale,
        board_items.cover_mode,
        board_items.note,
        board_items.status,
        games.payload_json
      FROM board_items
      LEFT JOIN games ON games.bgg_id = board_items.bgg_id
      WHERE board_items.board_id = ?
      ORDER BY board_items.sort_order ASC`
    )
    .all(boardId) as Array<{
    id: string;
    bgg_id: string;
    x: number;
    y: number;
    scale: number;
    cover_mode?: string;
    note: string;
    status: BoardItem["status"];
    payload_json?: string;
  }>;

  return rows.map((row) => {
    const snapshot = row.payload_json ? (JSON.parse(row.payload_json) as GameSnapshot) : minimalGameSnapshot(row.bgg_id);

    return {
      id: row.id,
      bggId: row.bgg_id,
      x: row.x,
      y: row.y,
      scale: row.scale,
      coverMode: normalizeCoverMode(row.cover_mode),
      note: row.note,
      status: row.status,
      gameSnapshot: applyGameNaming(snapshot, locale)
    };
  });
}

function loadBoardAnnotations(boardId: string) {
  const rows = getDb()
    .prepare(
      `SELECT
        id,
        kind,
        x,
        y,
        width,
        height,
        text,
        style_json,
        created_at,
        updated_at
      FROM board_annotations
      WHERE board_id = ?
      ORDER BY sort_order ASC`
    )
    .all(boardId) as Array<{
    id: string;
    kind: BoardAnnotation["kind"];
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    style_json: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    text: row.text,
    style: JSON.parse(row.style_json) as BoardAnnotation["style"],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

function rowToBoard(row: unknown, locale: Locale): Board | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const value = row as {
    id: string;
    share_id: string;
    title: string;
    viewport_json: string;
    items_json: string;
    created_at: string;
    updated_at: string;
  };

  const normalizedItems = loadBoardItems(value.id, locale);
  const annotations = loadBoardAnnotations(value.id);
  const legacyItems = safeParseItems(value.items_json)
    .filter((item) => item.id && item.bggId)
    .map((item) => {
      const bggId = String(item.bggId);
      const snapshot = item.gameSnapshot ?? minimalGameSnapshot(bggId);

      return {
        id: String(item.id),
        bggId,
        x: typeof item.x === "number" ? item.x : 0,
        y: typeof item.y === "number" ? item.y : 0,
        scale: typeof item.scale === "number" ? item.scale : 1,
        coverMode: normalizeCoverMode(item.coverMode),
        note: typeof item.note === "string" ? item.note : "",
        status: item.status ?? "拥有",
        gameSnapshot: applyGameNaming(snapshot, locale)
      };
    });

  return {
    id: value.id,
    shareId: value.share_id,
    title: value.title,
    viewport: safeParseViewport(value.viewport_json),
    items: normalizedItems.length > 0 ? normalizedItems : legacyItems,
    annotations,
    createdAt: value.created_at,
    updatedAt: value.updated_at
  };
}

function createShareId() {
  return randomBytes(12).toString("base64url");
}

export function getBoard(boardId: string, locale: Locale = "en") {
  const row = getDb()
    .prepare("SELECT * FROM boards WHERE id = ?")
    .get(boardId);

  return rowToBoard(row, locale);
}

export function getOwnedBoard(boardId: string, userId: string, locale: Locale = "en") {
  const row = getDb()
    .prepare("SELECT * FROM boards WHERE id = ? AND owner_user_id = ?")
    .get(boardId, userId);

  return rowToBoard(row, locale);
}

export function getSharedBoard(shareId: string, locale: Locale = "en") {
  const row = getDb()
    .prepare("SELECT * FROM boards WHERE share_id = ?")
    .get(shareId);

  return rowToBoard(row, locale);
}

export function listBoards(userId: string): BoardSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT
        boards.id,
        boards.share_id,
        boards.title,
        boards.created_at,
        boards.updated_at,
        COUNT(board_items.id) AS item_count
      FROM boards
      LEFT JOIN board_items ON board_items.board_id = boards.id
      WHERE boards.owner_user_id = ?
      GROUP BY boards.id
      ORDER BY boards.updated_at DESC`
    )
    .all(userId) as Array<{
    id: string;
    share_id: string;
    title: string;
    created_at: string;
    updated_at: string;
    item_count: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    shareId: row.share_id,
    title: row.title,
    itemCount: row.item_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export class BoardLimitError extends Error {
  boardCount: number;
  maxBoards: number;

  constructor(boardCount: number, maxBoards: number) {
    super(`Board limit reached: ${boardCount}/${maxBoards}`);
    this.name = "BoardLimitError";
    this.boardCount = boardCount;
    this.maxBoards = maxBoards;
  }
}

export function countBoardsForUser(userId: string) {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM boards WHERE owner_user_id = ?")
    .get(userId) as { count: number };

  return row.count;
}

export function createBoard(userId: string, locale: Locale = "en", title?: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const boardId = randomUUID();
  const boardTitle = sanitizeBoardTitle(title, locale);
  const owner = getUserById(userId);
  const maxBoards = owner?.maxBoards ?? DEFAULT_USER_MAX_BOARDS;
  const boardCount = countBoardsForUser(userId);

  if (boardCount >= maxBoards) {
    throw new BoardLimitError(boardCount, maxBoards);
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const shareId = createShareId();
    const existingShare = getSharedBoard(shareId);

    if (existingShare) {
      continue;
    }

    db.prepare(
      `INSERT INTO boards (
        id,
        owner_user_id,
        share_id,
        title,
        viewport_json,
        items_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      boardId,
      userId,
      shareId,
      boardTitle,
      JSON.stringify(DEFAULT_VIEWPORT),
      JSON.stringify([]),
      now,
      now
    );

    const board = getOwnedBoard(boardId, userId, locale);

    if (!board) {
      throw new Error("Created board could not be reloaded.");
    }

    return board;
  }

  throw new Error("Unable to generate a unique share id.");
}

export function saveBoard(board: Board, locale: Locale = "en") {
  const db = getDb();
  const updatedAt = new Date().toISOString();

  try {
    db.exec("BEGIN");

    db.prepare(
      `UPDATE boards
        SET title = ?,
            viewport_json = ?,
            items_json = ?,
            updated_at = ?
        WHERE id = ?`
    ).run(
      board.title,
      JSON.stringify(board.viewport),
      JSON.stringify(serializeBoardItems(board.items)),
      updatedAt,
      board.id
    );

    db.prepare("DELETE FROM board_items WHERE board_id = ?").run(board.id);
    db.prepare("DELETE FROM board_annotations WHERE board_id = ?").run(board.id);

    const insertItem = db.prepare(
      `INSERT INTO board_items (
        id,
        board_id,
        bgg_id,
        x,
        y,
        scale,
        cover_mode,
        note,
        status,
        sort_order,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    board.items.forEach((item, index) => {
      insertItem.run(
        item.id,
        board.id,
        item.bggId,
        item.x,
        item.y,
        item.scale,
        normalizeCoverMode(item.coverMode),
        item.note,
        item.status,
        index,
        updatedAt
      );
    });

    const insertAnnotation = db.prepare(
      `INSERT INTO board_annotations (
        id,
        board_id,
        kind,
        x,
        y,
        width,
        height,
        text,
        style_json,
        sort_order,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    serializeBoardAnnotations(board.annotations ?? []).forEach((annotation, index) => {
      insertAnnotation.run(
        annotation.id,
        board.id,
        annotation.kind,
        annotation.x,
        annotation.y,
        annotation.width,
        annotation.height,
        annotation.text,
        JSON.stringify(annotation.style),
        index,
        annotation.createdAt || updatedAt,
        updatedAt
      );
    });

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const savedBoard = getBoard(board.id, locale);

  if (!savedBoard) {
    throw new Error("Saved board could not be reloaded.");
  }

  return savedBoard;
}

export function deleteBoard(boardId: string, userId: string) {
  const db = getDb();
  const board = getOwnedBoard(boardId, userId);

  if (!board) {
    return false;
  }

  db.exec("BEGIN");

  try {
    db.prepare("DELETE FROM board_items WHERE board_id = ?").run(boardId);
    db.prepare("DELETE FROM board_annotations WHERE board_id = ?").run(boardId);
    const result = db
      .prepare("DELETE FROM boards WHERE id = ? AND owner_user_id = ?")
      .run(boardId, userId) as { changes?: number };
    db.exec("COMMIT");

    return (result.changes ?? 0) > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getGameNaming(bggId: string) {
  const localizedNames: LocalizedText = {};
  const aliases: LocalizedAliases = {};
  const localizationRows = getDb()
    .prepare("SELECT locale, name FROM game_localizations WHERE bgg_id = ?")
    .all(bggId) as Array<{ locale: Locale; name: string }>;
  const aliasRows = getDb()
    .prepare("SELECT locale, alias FROM game_aliases WHERE bgg_id = ? ORDER BY alias ASC")
    .all(bggId) as Array<{ locale: Locale; alias: string }>;

  localizationRows.forEach((row) => {
    localizedNames[row.locale] = row.name;
  });

  aliasRows.forEach((row) => {
    aliases[row.locale] = [...(aliases[row.locale] ?? []), row.alias];
  });

  return { bggId, localizedNames, aliases };
}

export function applyGameNaming(game: GameSnapshot, locale: Locale): GameSnapshot {
  const naming = getGameNaming(game.bggId);
  const canonicalName = decodeHtmlEntities(game.canonicalName || naming.localizedNames.en || game.name);
  const localizedNames = {
    ...(game.localizedNames ?? {}),
    ...naming.localizedNames,
    en: naming.localizedNames.en || game.localizedNames?.en || canonicalName
  };
  const description = getLocalizedDescription(game.bggId, locale);
  const localizedDescription = {
    ...(game.localizedDescription ?? {}),
    ...(description ? { [locale]: description } : {})
  };
  const localizedCategories: LocalizedTextList = {
    ...(game.localizedCategories ?? {}),
    ...(locale !== "en" ? { [locale]: localizeTermList("category", locale, game.categories) } : {})
  };
  const localizedMechanics: LocalizedTextList = {
    ...(game.localizedMechanics ?? {}),
    ...(locale !== "en" ? { [locale]: localizeTermList("mechanic", locale, game.mechanics) } : {})
  };

  return {
    ...game,
    name: canonicalName,
    canonicalName,
    localizedNames,
    aliases: {
      ...(game.aliases ?? {}),
      ...naming.aliases
    },
    localizedDescription,
    localizedCategories,
    localizedMechanics,
    displayName: getDisplayName(localizedNames, canonicalName, locale),
    locale
  };
}

function upsertGameLocalization(bggId: string, locale: Locale, name: string, source: "bgg" | "manual") {
  const normalizedName = name.trim();

  if (!normalizedName) {
    return;
  }

  const now = new Date().toISOString();
  const existing = getDb()
    .prepare("SELECT source FROM game_localizations WHERE bgg_id = ? AND locale = ?")
    .get(bggId, locale) as { source: "bgg" | "manual" } | undefined;

  if (existing?.source === "manual" && source === "bgg") {
    return;
  }

  getDb()
    .prepare(
      `INSERT INTO game_localizations (bgg_id, locale, name, name_search, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bgg_id, locale) DO UPDATE SET
        name = excluded.name,
        name_search = excluded.name_search,
        source = excluded.source,
        updated_at = excluded.updated_at`
    )
    .run(bggId, locale, normalizedName, normalizeSearchText(normalizedName), source, now);
}

export function updateGameNaming(
  bggId: string,
  payload: {
    localizedNames?: LocalizedText;
    aliases?: LocalizedAliases;
  }
) {
  const now = new Date().toISOString();
  const db = getDb();

  for (const locale of ["en", "zh-CN"] satisfies Locale[]) {
    const name = payload.localizedNames?.[locale]?.trim() ?? "";

    if (name) {
      upsertGameLocalization(bggId, locale, name, "manual");
    } else if (locale === "zh-CN") {
      db.prepare("DELETE FROM game_localizations WHERE bgg_id = ? AND locale = ?").run(bggId, locale);
    }

    const cleanAliases = Array.from(
      new Set((payload.aliases?.[locale] ?? []).map((alias) => alias.trim()).filter(Boolean))
    ).slice(0, 24);

    db.prepare("DELETE FROM game_aliases WHERE bgg_id = ? AND locale = ?").run(bggId, locale);

    const insertAlias = db.prepare(
      `INSERT INTO game_aliases (id, bgg_id, locale, alias, alias_search, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    cleanAliases.forEach((alias) => {
      insertAlias.run(randomUUID(), bggId, locale, alias, normalizeSearchText(alias), "manual", now);
    });
  }

  return getGameNaming(bggId);
}

function upsertGameDescription(bggId: string, description: string) {
  const normalizedDescription = description.trim();
  const db = getDb();

  if (!normalizedDescription) {
    db.prepare("DELETE FROM game_content_localizations WHERE bgg_id = ? AND locale = 'zh-CN'").run(bggId);
    return;
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO game_content_localizations (bgg_id, locale, description, source, updated_at)
    VALUES (?, 'zh-CN', ?, 'manual', ?)
    ON CONFLICT(bgg_id, locale) DO UPDATE SET
      description = excluded.description,
      source = excluded.source,
      updated_at = excluded.updated_at`
  ).run(bggId, normalizedDescription, now);
}

function upsertTermTranslations(termType: "category" | "mechanic", rows: AdminTermTranslation[]) {
  const db = getDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO game_term_localizations (term_type, locale, term, translation, source, updated_at)
    VALUES (?, 'zh-CN', ?, ?, 'manual', ?)
    ON CONFLICT(term_type, locale, term) DO UPDATE SET
      translation = excluded.translation,
      source = excluded.source,
      updated_at = excluded.updated_at`
  );

  rows.forEach((row) => {
    const term = row.term.trim();
    const translation = row.translation.trim();

    if (!term) {
      return;
    }

    if (translation) {
      upsert.run(termType, term, translation, now);
    } else {
      db.prepare("DELETE FROM game_term_localizations WHERE term_type = ? AND locale = 'zh-CN' AND term = ?").run(termType, term);
    }
  });
}

function getAdminTermTranslations(termType: "category" | "mechanic", terms: string[]) {
  const cleanTerms = Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean)));

  if (cleanTerms.length === 0) {
    return [];
  }

  const placeholders = cleanTerms.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT term, translation
      FROM game_term_localizations
      WHERE term_type = ? AND locale = 'zh-CN' AND term IN (${placeholders})`
    )
    .all(termType, ...cleanTerms) as Array<{ term: string; translation: string }>;
  const translations = Object.fromEntries(rows.map((row) => [row.term, row.translation]));

  return cleanTerms.map((term) => ({
    term,
    translation: translations[term] ?? ""
  }));
}

export function updateAdminGameMaintenance(
  bggId: string,
  payload: {
    localizedNames?: LocalizedText;
    aliases?: LocalizedAliases;
    zhDescription?: string;
    categoryTranslations?: AdminTermTranslation[];
    mechanicTranslations?: AdminTermTranslation[];
  }
) {
  updateGameNaming(bggId, {
    localizedNames: {
      en: payload.localizedNames?.en,
      "zh-CN": payload.localizedNames?.["zh-CN"]
    },
    aliases: {
      en: payload.aliases?.en ?? [],
      "zh-CN": payload.aliases?.["zh-CN"] ?? []
    }
  });
  upsertGameDescription(bggId, payload.zhDescription ?? "");
  upsertTermTranslations("category", payload.categoryTranslations ?? []);
  upsertTermTranslations("mechanic", payload.mechanicTranslations ?? []);

  return getAdminGameDetail(bggId);
}

export function getGameSnapshot(bggId: string, locale: Locale = "en") {
  const row = getDb().prepare("SELECT payload_json FROM games WHERE bgg_id = ?").get(bggId);

  if (!row || typeof row !== "object") {
    return null;
  }

  return applyGameNaming(JSON.parse((row as { payload_json: string }).payload_json) as GameSnapshot, locale);
}

function parseGameSnapshotPayload(value: string) {
  return JSON.parse(value) as GameSnapshot;
}

export function listAdminGames({
  page = 1,
  pageSize = 20,
  query = ""
}: {
  page?: number;
  pageSize?: number;
  query?: string;
}) {
  const normalizedQuery = normalizeSearchText(query);
  const filters: string[] = [];
  const values: unknown[] = [];

  if (normalizedQuery) {
    const likeQuery = `%${escapeLike(normalizedQuery)}%`;
    filters.push(
      `(games.bgg_id = ?
        OR games.name_search LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM game_localizations gl_search
          WHERE gl_search.bgg_id = games.bgg_id AND gl_search.name_search LIKE ? ESCAPE '\\'
        )
        OR EXISTS (
          SELECT 1 FROM game_aliases ga_search
          WHERE ga_search.bgg_id = games.bgg_id AND ga_search.alias_search LIKE ? ESCAPE '\\'
        ))`
    );
    values.push(normalizedQuery, likeQuery, likeQuery, likeQuery);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const offset = (Math.max(page, 1) - 1) * pageSize;
  const rows = getDb()
    .prepare(
      `SELECT
        games.bgg_id,
        games.name,
        games.year_published,
        games.updated_at,
        zh.name AS zh_name,
        COUNT(board_items.id) AS item_count
      FROM games
      LEFT JOIN game_localizations zh ON zh.bgg_id = games.bgg_id AND zh.locale = 'zh-CN'
      LEFT JOIN board_items ON board_items.bgg_id = games.bgg_id
      ${whereClause}
      GROUP BY games.bgg_id
      ORDER BY item_count DESC, games.updated_at DESC, games.name ASC
      LIMIT ? OFFSET ?`
    )
    .all(...values, pageSize, offset) as Array<{
    bgg_id: string;
    name: string;
    year_published?: number | null;
    updated_at: string;
    zh_name?: string | null;
    item_count: number;
  }>;
  const totalRow = getDb()
    .prepare(`SELECT COUNT(*) AS total FROM games ${whereClause}`)
    .get(...values) as { total: number };

  return {
    games: rows.map((row) => ({
      bggId: row.bgg_id,
      englishName: row.name,
      zhName: row.zh_name ?? "",
      yearPublished: row.year_published ?? undefined,
      itemCount: row.item_count,
      updatedAt: row.updated_at
    })) satisfies AdminGameSummary[],
    total: totalRow.total,
    page,
    pageSize
  };
}

export function getAdminGameDetail(bggId: string): AdminGameDetail | null {
  const row = getDb()
    .prepare(
      `SELECT
        games.bgg_id,
        games.name,
        games.year_published,
        games.payload_json,
        games.updated_at,
        games.last_fetched_at,
        zh.name AS zh_name,
        COUNT(board_items.id) AS item_count
      FROM games
      LEFT JOIN game_localizations zh ON zh.bgg_id = games.bgg_id AND zh.locale = 'zh-CN'
      LEFT JOIN board_items ON board_items.bgg_id = games.bgg_id
      WHERE games.bgg_id = ?
      GROUP BY games.bgg_id`
    )
    .get(bggId) as
    | {
        bgg_id: string;
        name: string;
        year_published?: number | null;
        payload_json: string;
        updated_at: string;
        last_fetched_at: string;
        zh_name?: string | null;
        item_count: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  const snapshot = parseGameSnapshotPayload(row.payload_json);
  const naming = getGameNaming(bggId);
  const zhDescription = getLocalizedDescription(bggId, "zh-CN") ?? "";

  return {
    bggId: row.bgg_id,
    englishName: row.name,
    zhName: row.zh_name ?? "",
    yearPublished: row.year_published ?? snapshot.yearPublished,
    itemCount: row.item_count,
    updatedAt: row.updated_at,
    lastFetchedAt: row.last_fetched_at,
    snapshot,
    localizedNames: naming.localizedNames,
    aliases: naming.aliases,
    zhDescription,
    categoryTranslations: getAdminTermTranslations("category", snapshot.categories ?? []),
    mechanicTranslations: getAdminTermTranslations("mechanic", snapshot.mechanics ?? [])
  };
}

function countRow(sql: string, ...values: unknown[]) {
  return (getDb().prepare(sql).get(...values) as { count: number }).count;
}

function loadDailyCounts(table: "users" | "boards", column: "created_at" | "updated_at", sinceDate: string) {
  const rows = getDb()
    .prepare(
      `SELECT substr(${column}, 1, 10) AS date, COUNT(*) AS count
      FROM ${table}
      WHERE ${column} >= ?
      GROUP BY substr(${column}, 1, 10)`
    )
    .all(sinceDate) as Array<{ date: string; count: number }>;

  return Object.fromEntries(rows.map((row) => [row.date, row.count]));
}

export function getAdminAnalytics() {
  const now = new Date();
  const since = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  const sinceDate = since.toISOString().slice(0, 10);
  const userTrend = loadDailyCounts("users", "created_at", sinceDate);
  const boardCreateTrend = loadDailyCounts("boards", "created_at", sinceDate);
  const boardUpdateTrend = loadDailyCounts("boards", "updated_at", sinceDate);
  const trend = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(since.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    return {
      date,
      users: userTrend[date] ?? 0,
      boardsCreated: boardCreateTrend[date] ?? 0,
      boardsUpdated: boardUpdateTrend[date] ?? 0
    };
  });
  const recentUsers = getDb()
    .prepare(
      `SELECT id, nickname, email, role, max_boards, disabled_at, disabled_reason, created_at, updated_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 6`
    )
    .all() as Array<{
    id: string;
    nickname: string;
    email: string;
    role: UserRole;
    max_boards: number;
    disabled_at: string | null;
    disabled_reason: string | null;
    created_at: string;
    updated_at: string;
  }>;
  const recentBoards = getDb()
    .prepare(
      `SELECT boards.id, boards.title, boards.updated_at, users.email AS owner_email
      FROM boards
      INNER JOIN users ON users.id = boards.owner_user_id
      ORDER BY boards.updated_at DESC
      LIMIT 6`
    )
    .all() as Array<{ id: string; title: string; updated_at: string; owner_email: string }>;
  const popularGames = getDb()
    .prepare(
      `SELECT
        games.bgg_id,
        games.name,
        games.year_published,
        zh.name AS zh_name,
        COUNT(board_items.id) AS item_count
      FROM board_items
      INNER JOIN games ON games.bgg_id = board_items.bgg_id
      LEFT JOIN game_localizations zh ON zh.bgg_id = games.bgg_id AND zh.locale = 'zh-CN'
      GROUP BY games.bgg_id
      ORDER BY item_count DESC, games.name ASC
      LIMIT 8`
    )
    .all() as Array<{ bgg_id: string; name: string; year_published?: number | null; zh_name?: string | null; item_count: number }>;
  const missingZhNames = getDb()
    .prepare(
      `SELECT games.bgg_id, games.name, COUNT(board_items.id) AS item_count
      FROM board_items
      INNER JOIN games ON games.bgg_id = board_items.bgg_id
      LEFT JOIN game_localizations zh ON zh.bgg_id = games.bgg_id AND zh.locale = 'zh-CN'
      WHERE zh.name IS NULL
      GROUP BY games.bgg_id
      ORDER BY item_count DESC, games.name ASC
      LIMIT 8`
    )
    .all() as Array<{ bgg_id: string; name: string; item_count: number }>;
  const missingZhDescriptions = getDb()
    .prepare(
      `SELECT games.bgg_id, games.name, COUNT(board_items.id) AS item_count
      FROM board_items
      INNER JOIN games ON games.bgg_id = board_items.bgg_id
      LEFT JOIN game_content_localizations zh ON zh.bgg_id = games.bgg_id AND zh.locale = 'zh-CN'
      WHERE zh.description IS NULL
      GROUP BY games.bgg_id
      ORDER BY item_count DESC, games.name ASC
      LIMIT 8`
    )
    .all() as Array<{ bgg_id: string; name: string; item_count: number }>;

  return {
    metrics: {
      totalUsers: countRow("SELECT COUNT(*) AS count FROM users"),
      activeUsers: countRow("SELECT COUNT(*) AS count FROM users WHERE disabled_at IS NULL"),
      disabledUsers: countRow("SELECT COUNT(*) AS count FROM users WHERE disabled_at IS NOT NULL"),
      totalBoards: countRow("SELECT COUNT(*) AS count FROM boards"),
      publicShares: countRow("SELECT COUNT(*) AS count FROM boards WHERE share_id IS NOT NULL AND share_id != ''"),
      totalBoardItems: countRow("SELECT COUNT(*) AS count FROM board_items"),
      totalGames: countRow("SELECT COUNT(*) AS count FROM games"),
      zhNameCoverage: countRow("SELECT COUNT(DISTINCT bgg_id) AS count FROM game_localizations WHERE locale = 'zh-CN'"),
      zhDescriptionCoverage: countRow("SELECT COUNT(DISTINCT bgg_id) AS count FROM game_content_localizations WHERE locale = 'zh-CN'"),
      categoryTranslationCoverage: countRow("SELECT COUNT(*) AS count FROM game_term_localizations WHERE locale = 'zh-CN' AND term_type = 'category'"),
      mechanicTranslationCoverage: countRow("SELECT COUNT(*) AS count FROM game_term_localizations WHERE locale = 'zh-CN' AND term_type = 'mechanic'")
    },
    recentUsers: recentUsers.map((user) => ({
      id: user.id,
      nickname: user.nickname,
      email: user.email,
      role: normalizeRole(user.role),
      maxBoards: normalizeUserMaxBoards(user.max_boards),
      disabledAt: user.disabled_at,
      disabledReason: user.disabled_reason,
      createdAt: user.created_at,
      updatedAt: user.updated_at
    })),
    recentBoards: recentBoards.map((board) => ({
      id: board.id,
      title: board.title,
      ownerEmail: board.owner_email,
      updatedAt: board.updated_at
    })),
    popularGames: popularGames.map((game) => ({
      bggId: game.bgg_id,
      englishName: game.name,
      zhName: game.zh_name ?? "",
      yearPublished: game.year_published ?? undefined,
      itemCount: game.item_count
    })),
    missingZhNames: missingZhNames.map((game) => ({
      bggId: game.bgg_id,
      englishName: game.name,
      itemCount: game.item_count
    })),
    missingZhDescriptions: missingZhDescriptions.map((game) => ({
      bggId: game.bgg_id,
      englishName: game.name,
      itemCount: game.item_count
    })),
    trend
  };
}

function formatShanghaiDate(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(value);
}

function decodeBasicHtml(value: unknown) {
  return decodeHtmlEntities(value)
    .replace(/\s+/g, " ")
    .trim();
}

function escapeMarkdownCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\r\n", "<br>")
    .replaceAll("\n", "<br>")
    .trim();
}

function unescapeMarkdownCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("<br>", "\n")
    .replaceAll("\\|", "|")
    .trim();
}

function markdownTable(headers: string[], rows: unknown[][]) {
  const header = `| ${headers.map(escapeMarkdownCell).join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`);

  return [header, separator, ...body].join("\n");
}

function addTranslationTerm(termMap: Map<string, Set<string>>, terms: unknown, gameName: string) {
  if (!Array.isArray(terms)) {
    return;
  }

  for (const term of terms) {
    const cleanTerm = String(term ?? "").trim();

    if (!cleanTerm) {
      continue;
    }

    const refs = termMap.get(cleanTerm) ?? new Set<string>();
    refs.add(gameName);
    termMap.set(cleanTerm, refs);
  }
}

function parseTranslationSnapshot(value: string) {
  try {
    return JSON.parse(value) as Partial<GameSnapshot>;
  } catch {
    return {};
  }
}

function getExistingTermTranslationMap(termType: "category" | "mechanic") {
  const rows = getDb()
    .prepare("SELECT term, translation FROM game_term_localizations WHERE term_type = ? AND locale = 'zh-CN'")
    .all(termType) as Array<{ term: string; translation: string }>;

  return Object.fromEntries(rows.map((row) => [row.term, row.translation]));
}

function splitMarkdownRow(line: string) {
  const trimmed = line.trim();

  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return null;
  }

  const cells: string[] = [];
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
      cells.push(unescapeMarkdownCell(current));
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(unescapeMarkdownCell(current));
  return cells;
}

function getMarkdownSection(text: string, heading: string) {
  const headingText = `## ${heading}`;
  const start = text.indexOf(headingText);

  if (start === -1) {
    return "";
  }

  const nextHeading = text.indexOf("\n## ", start + headingText.length);
  return text.slice(start, nextHeading === -1 ? text.length : nextHeading);
}

function parseMarkdownTable(text: string, heading: string) {
  const rows = getMarkdownSection(text, heading)
    .split(/\r?\n/)
    .map(splitMarkdownRow)
    .filter((row): row is string[] => Boolean(row));

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0];
  return rows.slice(2).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  ) as Array<Record<string, string>>;
}

export function buildAdminPendingTranslationMarkdown() {
  const generatedDate = formatShanghaiDate();
  const categoryTranslations = getExistingTermTranslationMap("category");
  const mechanicTranslations = getExistingTermTranslationMap("mechanic");
  const categories = new Map<string, Set<string>>();
  const mechanics = new Map<string, Set<string>>();
  const rows = getDb()
    .prepare(
      `SELECT
        games.bgg_id,
        games.name,
        games.year_published,
        games.payload_json,
        games.updated_at,
        zh.name AS zh_name,
        zh_description.description AS zh_description,
        COUNT(board_items.id) AS board_item_count
      FROM games
      LEFT JOIN game_localizations zh ON zh.bgg_id = games.bgg_id AND zh.locale = 'zh-CN'
      LEFT JOIN game_content_localizations zh_description ON zh_description.bgg_id = games.bgg_id AND zh_description.locale = 'zh-CN'
      LEFT JOIN board_items ON board_items.bgg_id = games.bgg_id
      GROUP BY games.bgg_id
      ORDER BY
        board_item_count DESC,
        games.updated_at DESC,
        games.name ASC`
    )
    .all() as Array<{
    bgg_id: string;
    name: string;
    year_published?: number | null;
    payload_json: string;
    zh_name?: string | null;
    zh_description?: string | null;
    board_item_count: number;
  }>;
  const games = rows.map((row) => {
    const snapshot = parseTranslationSnapshot(row.payload_json);
    const englishName = snapshot.canonicalName || snapshot.name || row.name;
    const year = row.year_published ?? snapshot.yearPublished ?? "";
    const gameNameWithYear = year ? `${englishName} (${year})` : englishName;

    addTranslationTerm(categories, snapshot.categories, gameNameWithYear);
    addTranslationTerm(mechanics, snapshot.mechanics, gameNameWithYear);

    return {
      bggId: row.bgg_id,
      englishName,
      year,
      zhName: row.zh_name ?? "",
      description: decodeBasicHtml(snapshot.description),
      zhDescription: row.zh_description ?? ""
    };
  });
  const nameRows = games
    .filter((game) => !game.zhName)
    .map((game) => [game.bggId, game.englishName, game.year, game.zhName, "", ""]);
  const categoryRows = Array.from(categories.entries())
    .filter(([term]) => !categoryTranslations[term])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, refs]) => [term, "", Array.from(refs).slice(0, 5).join("; ")]);
  const mechanicRows = Array.from(mechanics.entries())
    .filter(([term]) => !mechanicTranslations[term])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([term, refs]) => [term, "", Array.from(refs).slice(0, 5).join("; ")]);
  const descriptionRows = games
    .filter((game) => game.description && !game.zhDescription)
    .map((game) => [game.bggId, game.englishName, game.description, ""]);

  return {
    filename: `bgg-translation-pending-${generatedDate}.md`,
    markdown: `# BGWB 桌游汉化清单 ${generatedDate}

> 来源：本地 SQLite \`games\` 表和本地化维护表；本次导出不请求 BGG。
> 本文件只包含当前库内尚未维护中文内容的新增待翻译项。设计师保留原名，不列入翻译范围。分类和机制按英文术语去重，回填时会按术语统一录入。

## 游戏名

${markdownTable(["BGG ID", "英文名", "年份", "现有中文名", "中文名（填写/修订）", "备注"], nameRows)}

## 分类术语

${markdownTable(["英文分类", "中文分类", "出现于"], categoryRows)}

## 机制术语

${markdownTable(["英文机制", "中文机制", "出现于"], mechanicRows)}

## 简介

${markdownTable(["BGG ID", "英文名", "英文简介", "中文简介"], descriptionRows)}
`,
    counts: {
      names: nameRows.length,
      categories: categoryRows.length,
      mechanics: mechanicRows.length,
      descriptions: descriptionRows.length
    }
  };
}

export function importAdminTranslationMarkdown(markdown: string): AdminTranslationImportResult {
  const now = new Date().toISOString();
  const gameRows = parseMarkdownTable(markdown, "游戏名");
  const categoryRows = parseMarkdownTable(markdown, "分类术语");
  const mechanicRows = parseMarkdownTable(markdown, "机制术语");
  const descriptionRows = parseMarkdownTable(markdown, "简介");
  const db = getDb();
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
  const findGame = db.prepare("SELECT 1 FROM games WHERE bgg_id = ?");
  const result: AdminTranslationImportResult = {
    names: 0,
    categories: 0,
    mechanics: 0,
    descriptions: 0
  };

  db.exec("BEGIN");

  try {
    for (const row of gameRows) {
      const bggId = row["BGG ID"]?.trim() ?? "";
      const zhName = row["中文名（填写/修订）"]?.trim().slice(0, 160) ?? "";

      if (/^\d+$/.test(bggId) && zhName && findGame.get(bggId)) {
        upsertName.run(bggId, zhName, normalizeSearchText(zhName), now);
        result.names += 1;
      }
    }

    for (const row of categoryRows) {
      const term = row["英文分类"]?.trim() ?? "";
      const translation = row["中文分类"]?.trim().slice(0, 120) ?? "";

      if (term && translation) {
        upsertTerm.run("category", term, translation, now);
        result.categories += 1;
      }
    }

    for (const row of mechanicRows) {
      const term = row["英文机制"]?.trim() ?? "";
      const translation = row["中文机制"]?.trim().slice(0, 120) ?? "";

      if (term && translation) {
        upsertTerm.run("mechanic", term, translation, now);
        result.mechanics += 1;
      }
    }

    for (const row of descriptionRows) {
      const bggId = row["BGG ID"]?.trim() ?? "";
      const description = row["中文简介"]?.trim().slice(0, 20000) ?? "";

      if (/^\d+$/.test(bggId) && description && findGame.get(bggId)) {
        upsertDescription.run(bggId, description, now);
        result.descriptions += 1;
      }
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return result;
}

export function upsertGameSnapshot(game: GameSnapshot) {
  const now = new Date().toISOString();
  const db = getDb();
  const canonicalName = game.canonicalName || game.localizedNames?.en || game.name;
  const snapshot: GameSnapshot = {
    ...game,
    name: canonicalName,
    canonicalName
  };

  delete snapshot.displayName;
  delete snapshot.locale;
  delete snapshot.localizedNames;
  delete snapshot.aliases;
  delete snapshot.localizedDescription;
  delete snapshot.localizedCategories;
  delete snapshot.localizedMechanics;

  const existing = db.prepare("SELECT created_at FROM games WHERE bgg_id = ?").get(game.bggId) as
    | { created_at: string }
    | undefined;

  db.prepare(
    `INSERT INTO games (
      bgg_id,
      name,
      name_search,
      year_published,
      payload_json,
      created_at,
      updated_at,
      last_fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bgg_id) DO UPDATE SET
      name = excluded.name,
      name_search = excluded.name_search,
      year_published = excluded.year_published,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at,
      last_fetched_at = excluded.last_fetched_at`
  ).run(
    game.bggId,
    canonicalName,
    normalizeSearchText(canonicalName),
    game.yearPublished ?? null,
    JSON.stringify(snapshot),
    existing?.created_at ?? now,
    now,
    now
  );

  upsertGameLocalization(game.bggId, "en", canonicalName, "bgg");
}

function buildSearchResult({
  bggId,
  canonicalName,
  localizedName,
  matchedAlias,
  locale,
  source,
  yearPublished,
  rank,
  averageRating
}: {
  bggId: string;
  canonicalName: string;
  localizedName?: string;
  matchedAlias?: string;
  locale: Locale;
  source: BggSearchResult["source"];
  yearPublished?: number | null;
  rank?: number | null;
  averageRating?: number | null;
}): BggSearchResult {
  const decodedCanonicalName = decodeHtmlEntities(canonicalName);
  const decodedLocalizedName = localizedName ? decodeHtmlEntities(localizedName) : undefined;
  const decodedMatchedAlias = matchedAlias ? decodeHtmlEntities(matchedAlias) : undefined;
  const displayName = decodedLocalizedName || decodedCanonicalName;

  return {
    bggId,
    name: displayName,
    displayName,
    canonicalName: decodedCanonicalName,
    localizedName: decodedLocalizedName,
    matchedAlias: decodedMatchedAlias,
    locale,
    yearPublished: yearPublished ?? undefined,
    rank: rank ?? undefined,
    averageRating: averageRating ?? undefined,
    source
  };
}

export function searchGameLocalizations(query: string, locale: Locale, excludedBggIds: string[] = [], limit = 12): BggSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery || limit <= 0) {
    return [];
  }

  const escapedQuery = escapeLike(normalizedQuery);
  const likeQuery = `%${escapedQuery}%`;
  const prefixQuery = `${escapedQuery}%`;
  const exclusionPlaceholders = excludedBggIds.map(() => "?").join(", ");
  const exclusionClause = exclusionPlaceholders ? `AND gl.bgg_id NOT IN (${exclusionPlaceholders})` : "";
  const rows = getDb()
    .prepare(
      `SELECT gl.bgg_id, gl.name AS localized_name, games.name AS canonical_name, games.year_published
      FROM game_localizations gl
      LEFT JOIN games ON games.bgg_id = gl.bgg_id
      WHERE gl.locale = ? AND gl.name_search LIKE ? ESCAPE '\\'
      ${exclusionClause}
      ORDER BY
        CASE
          WHEN gl.name_search = ? THEN 0
          WHEN gl.name_search LIKE ? ESCAPE '\\' THEN 1
          ELSE 2
        END,
        gl.name ASC
      LIMIT ?`
    )
    .all(locale, likeQuery, ...excludedBggIds, normalizedQuery, prefixQuery, limit) as Array<{
    bgg_id: string;
    localized_name: string;
    canonical_name?: string | null;
    year_published?: number | null;
  }>;

  return rows.map((row) =>
    buildSearchResult({
      bggId: row.bgg_id,
      canonicalName: row.canonical_name || row.localized_name,
      localizedName: row.localized_name,
      locale,
      source: "localization",
      yearPublished: row.year_published
    })
  );
}

export function searchGameAliases(query: string, locale: Locale, excludedBggIds: string[] = [], limit = 12): BggSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery || limit <= 0) {
    return [];
  }

  const escapedQuery = escapeLike(normalizedQuery);
  const likeQuery = `%${escapedQuery}%`;
  const prefixQuery = `${escapedQuery}%`;
  const exclusionPlaceholders = excludedBggIds.map(() => "?").join(", ");
  const exclusionClause = exclusionPlaceholders ? `AND ga.bgg_id NOT IN (${exclusionPlaceholders})` : "";
  const rows = getDb()
    .prepare(
      `SELECT
        ga.bgg_id,
        ga.alias,
        games.name AS canonical_name,
        games.year_published,
        gl.name AS localized_name
      FROM game_aliases ga
      LEFT JOIN games ON games.bgg_id = ga.bgg_id
      LEFT JOIN game_localizations gl ON gl.bgg_id = ga.bgg_id AND gl.locale = ?
      WHERE ga.locale = ? AND ga.alias_search LIKE ? ESCAPE '\\'
      ${exclusionClause}
      ORDER BY
        CASE
          WHEN ga.alias_search = ? THEN 0
          WHEN ga.alias_search LIKE ? ESCAPE '\\' THEN 1
          ELSE 2
        END,
        ga.alias ASC
      LIMIT ?`
    )
    .all(locale, locale, likeQuery, ...excludedBggIds, normalizedQuery, prefixQuery, limit) as Array<{
    bgg_id: string;
    alias: string;
    canonical_name?: string | null;
    localized_name?: string | null;
    year_published?: number | null;
  }>;

  return rows.map((row) =>
    buildSearchResult({
      bggId: row.bgg_id,
      canonicalName: row.canonical_name || row.localized_name || row.alias,
      localizedName: row.localized_name ?? undefined,
      matchedAlias: row.alias,
      locale,
      source: "alias",
      yearPublished: row.year_published
    })
  );
}

export function searchLocalGames(query: string, locale: Locale, excludedBggIds: string[] = [], limit = 12): BggSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery || limit <= 0) {
    return [];
  }

  const escapedQuery = escapeLike(normalizedQuery);
  const likeQuery = `%${escapedQuery}%`;
  const prefixQuery = `${escapedQuery}%`;
  const exclusionPlaceholders = excludedBggIds.map(() => "?").join(", ");
  const exclusionClause = exclusionPlaceholders ? `AND games.bgg_id NOT IN (${exclusionPlaceholders})` : "";
  const rows = getDb()
    .prepare(
      `SELECT games.bgg_id, games.name, games.year_published, gl.name AS localized_name
      FROM games
      LEFT JOIN game_localizations gl ON gl.bgg_id = games.bgg_id AND gl.locale = ?
      WHERE games.name_search LIKE ? ESCAPE '\\'
      ${exclusionClause}
      ORDER BY
        CASE
          WHEN games.name_search = ? THEN 0
          WHEN games.name_search LIKE ? ESCAPE '\\' THEN 1
          ELSE 2
        END,
        games.name ASC
      LIMIT ?`
    )
    .all(locale, likeQuery, ...excludedBggIds, normalizedQuery, prefixQuery, limit) as Array<{
    bgg_id: string;
    name: string;
    localized_name?: string | null;
    year_published?: number | null;
  }>;

  return rows.map((row) =>
    buildSearchResult({
      bggId: row.bgg_id,
      canonicalName: row.name,
      localizedName: row.localized_name ?? undefined,
      locale,
      source: "games",
      yearPublished: row.year_published
    })
  );
}

export function searchGameIndex(query: string, locale: Locale, excludedBggIds: string[] = [], limit = 12): BggSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedQuery || limit <= 0) {
    return [];
  }

  const escapedQuery = escapeLike(normalizedQuery);
  const likeQuery = `%${escapedQuery}%`;
  const prefixQuery = `${escapedQuery}%`;
  const exclusionPlaceholders = excludedBggIds.map(() => "?").join(", ");
  const exclusionClause = exclusionPlaceholders ? `AND game_index.bgg_id NOT IN (${exclusionPlaceholders})` : "";
  const rows = getDb()
    .prepare(
      `SELECT
        game_index.bgg_id,
        game_index.name,
        COALESCE(games.year_published, game_index.year_published) AS year_published,
        game_index.rank,
        game_index.average_rating,
        gl.name AS localized_name
      FROM game_index
      LEFT JOIN games ON games.bgg_id = game_index.bgg_id
      LEFT JOIN game_localizations gl ON gl.bgg_id = game_index.bgg_id AND gl.locale = ?
      WHERE game_index.name_search LIKE ? ESCAPE '\\'
      ${exclusionClause}
      ORDER BY
        CASE
          WHEN game_index.name_search = ? THEN 0
          WHEN game_index.name_search LIKE ? ESCAPE '\\' THEN 1
          ELSE 2
        END,
        CASE WHEN game_index.rank IS NULL OR game_index.rank <= 0 THEN 1 ELSE 0 END,
        game_index.rank ASC,
        game_index.average_rating DESC,
        game_index.name ASC
      LIMIT ?`
    )
    .all(locale, likeQuery, ...excludedBggIds, normalizedQuery, prefixQuery, limit) as Array<{
    bgg_id: string;
    name: string;
    localized_name?: string | null;
    year_published?: number | null;
    rank?: number | null;
    average_rating?: number | null;
  }>;

  return rows.map((row) =>
    buildSearchResult({
      bggId: row.bgg_id,
      canonicalName: row.name,
      localizedName: row.localized_name ?? undefined,
      locale,
      source: "index",
      yearPublished: row.year_published,
      rank: row.rank,
      averageRating: row.average_rating
    })
  );
}

export function getCache<T>(cacheKey: string): T | null {
  const row = getDb()
    .prepare("SELECT payload_json, expires_at FROM bgg_cache WHERE cache_key = ?")
    .get(cacheKey);

  if (!row || typeof row !== "object") {
    return null;
  }

  const cacheRow = row as { payload_json: string; expires_at: string };

  if (Date.parse(cacheRow.expires_at) <= Date.now()) {
    getDb().prepare("DELETE FROM bgg_cache WHERE cache_key = ?").run(cacheKey);
    return null;
  }

  return JSON.parse(cacheRow.payload_json) as T;
}

export function setCache(cacheKey: string, payload: unknown, ttlSeconds: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

  getDb()
    .prepare(
      `INSERT INTO bgg_cache (cache_key, payload_json, created_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at`
    )
    .run(cacheKey, JSON.stringify(payload), now.toISOString(), expiresAt);
}
