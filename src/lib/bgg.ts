import { XMLParser } from "fast-xml-parser";

import { requestBggXml } from "./bgg-client";
import { cacheGameCovers } from "./cover-cache";
import {
  applyGameNaming,
  getCache,
  getGameSnapshot,
  searchGameAliases,
  searchGameIndex,
  searchGameLocalizations,
  searchLocalGames,
  setCache,
  upsertGameSnapshot
} from "./db";
import type { BggSearchResult, GameSnapshot, Locale } from "./types";

const SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const THING_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function attrString(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const attribute = (value as { "@_value"?: unknown })["@_value"];
  return typeof attribute === "string" || typeof attribute === "number" ? String(attribute) : undefined;
}

function attrNumber(value: unknown) {
  const text = attrString(value);
  if (!text) {
    return undefined;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 8);
}

function normalizeDescription(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  return value
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim()
    .slice(0, 800);
}

type BggThingXmlItem = {
  "@_id"?: string | number;
  name?: unknown;
  image?: string;
  thumbnail?: string;
  description?: string;
  yearpublished?: unknown;
  minplayers?: unknown;
  maxplayers?: unknown;
  playingtime?: unknown;
  minplaytime?: unknown;
  maxplaytime?: unknown;
  minage?: unknown;
  statistics?: {
    ratings?: {
      average?: unknown;
    };
  };
  link?: unknown;
};

async function fetchBggXml(path: string): Promise<string> {
  return requestBggXml(path);
}

function excludeIds(results: BggSearchResult[]) {
  return results.map((result) => result.bggId);
}

function parseThingItem(item: BggThingXmlItem | undefined, fallbackBggId: string): GameSnapshot | null {
  if (!item) {
    return null;
  }

  const names = asArray(
    item.name as
      | {
          "@_type"?: string;
          "@_value"?: string;
        }
      | Array<{
          "@_type"?: string;
          "@_value"?: string;
        }>
      | undefined
  );
  const primaryName = names.find((name) => name["@_type"] === "primary") ?? names[0];
  const links = asArray(
    item.link as
      | {
          "@_type"?: string;
          "@_value"?: string;
        }
      | Array<{
          "@_type"?: string;
          "@_value"?: string;
        }>
      | undefined
  );

  return {
    bggId: String(item["@_id"] ?? fallbackBggId),
    name: primaryName?.["@_value"] ?? `BGG #${fallbackBggId}`,
    yearPublished: attrNumber(item.yearpublished),
    image: typeof item.image === "string" ? item.image : undefined,
    thumbnail: typeof item.thumbnail === "string" ? item.thumbnail : undefined,
    minPlayers: attrNumber(item.minplayers),
    maxPlayers: attrNumber(item.maxplayers),
    playingTime: attrNumber(item.playingtime),
    minPlayTime: attrNumber(item.minplaytime),
    maxPlayTime: attrNumber(item.maxplaytime),
    minAge: attrNumber(item.minage),
    averageRating: attrNumber(item.statistics?.ratings?.average),
    description: normalizeDescription(item.description),
    designers: compactList(
      links.filter((link) => link["@_type"] === "boardgamedesigner").map((link) => link["@_value"] ?? "")
    ),
    categories: compactList(
      links.filter((link) => link["@_type"] === "boardgamecategory").map((link) => link["@_value"] ?? "")
    ),
    mechanics: compactList(
      links.filter((link) => link["@_type"] === "boardgamemechanic").map((link) => link["@_value"] ?? "")
    )
  };
}

function parseThingXml(xml: string, fallbackBggIds: string[]) {
  const parsed = parser.parse(xml) as {
    items?: {
      item?: BggThingXmlItem | BggThingXmlItem[];
    };
  };

  return asArray(parsed.items?.item)
    .map((item, index) => parseThingItem(item, fallbackBggIds[index] ?? ""))
    .filter((item): item is GameSnapshot => Boolean(item));
}

export async function searchBgg(query: string, locale: Locale = "en") {
  const normalizedQuery = query.trim();
  const localizedResults = searchGameLocalizations(normalizedQuery, locale, [], 20);
  const aliasResults = searchGameAliases(normalizedQuery, locale, excludeIds(localizedResults), 20 - localizedResults.length);
  const localResults = searchLocalGames(
    normalizedQuery,
    locale,
    excludeIds([...localizedResults, ...aliasResults]),
    20 - localizedResults.length - aliasResults.length
  );
  const indexResults = searchGameIndex(
    normalizedQuery,
    locale,
    excludeIds([...localizedResults, ...aliasResults, ...localResults]),
    20 - localizedResults.length - aliasResults.length - localResults.length
  );
  const combinedResults = [...localizedResults, ...aliasResults, ...localResults, ...indexResults].slice(0, 20);

  if (combinedResults.length > 0) {
    return combinedResults;
  }

  const cacheKey = `search:${normalizedQuery.toLowerCase()}`;
  const cached = getCache<BggSearchResult[]>(cacheKey);

  if (cached) {
    return cached.map((result) => ({
      ...result,
      displayName: result.displayName || result.name,
      canonicalName: result.canonicalName || result.name,
      locale
    }));
  }

  const xml = await fetchBggXml(`/search?query=${encodeURIComponent(normalizedQuery)}&type=boardgame`);
  const parsed = parser.parse(xml) as {
    items?: {
      item?: Array<{
        "@_id"?: string | number;
        name?: { "@_value"?: string };
        yearpublished?: { "@_value"?: string | number };
      }>;
    };
  };

  const results = asArray(parsed.items?.item)
    .map((item) => ({
      bggId: String(item["@_id"] ?? ""),
      name: attrString(item.name) ?? "",
      displayName: attrString(item.name) ?? "",
      canonicalName: attrString(item.name) ?? "",
      locale,
      yearPublished: attrNumber(item.yearpublished),
      source: "bgg" as const
    }))
    .filter((item) => item.bggId && item.name)
    .slice(0, 20);

  setCache(cacheKey, results, SEARCH_CACHE_TTL_SECONDS);
  return results;
}

export async function getBggThing(bggId: string, locale: Locale = "en") {
  const localGame = getGameSnapshot(bggId, locale);

  if (localGame) {
    const gameWithCachedCovers = await cacheGameCovers(localGame);

    if (
      gameWithCachedCovers.localImage !== localGame.localImage ||
      gameWithCachedCovers.localThumbnail !== localGame.localThumbnail
    ) {
      upsertGameSnapshot(gameWithCachedCovers);
      return getGameSnapshot(bggId, locale) ?? gameWithCachedCovers;
    }

    return gameWithCachedCovers;
  }

  const cacheKey = `thing:${bggId}`;
  const cached = getCache<GameSnapshot>(cacheKey);

  if (cached) {
    const gameWithCachedCovers = await cacheGameCovers(cached);
    upsertGameSnapshot(gameWithCachedCovers);
    return getGameSnapshot(bggId, locale) ?? applyGameNaming(gameWithCachedCovers, locale);
  }

  const xml = await fetchBggXml(`/thing?id=${encodeURIComponent(bggId)}&type=boardgame&stats=1`);
  const snapshot = parseThingXml(xml, [bggId])[0];

  if (!snapshot) {
    throw new Error("没有找到这个 BGG 桌游。");
  }

  const snapshotWithCachedCovers = await cacheGameCovers(snapshot);

  setCache(cacheKey, snapshotWithCachedCovers, THING_CACHE_TTL_SECONDS);
  upsertGameSnapshot(snapshotWithCachedCovers);
  return getGameSnapshot(bggId, locale) ?? applyGameNaming(snapshotWithCachedCovers, locale);
}

export async function refreshBggThing(bggId: string, locale: Locale = "en") {
  const xml = await fetchBggXml(`/thing?id=${encodeURIComponent(bggId)}&type=boardgame&stats=1`);
  const snapshot = parseThingXml(xml, [bggId])[0];

  if (!snapshot) {
    throw new Error("没有找到这个 BGG 桌游。");
  }

  const snapshotWithCachedCovers = await cacheGameCovers(snapshot);
  setCache(`thing:${bggId}`, snapshotWithCachedCovers, THING_CACHE_TTL_SECONDS);
  upsertGameSnapshot(snapshotWithCachedCovers);

  return getGameSnapshot(bggId, locale) ?? applyGameNaming(snapshotWithCachedCovers, locale);
}
