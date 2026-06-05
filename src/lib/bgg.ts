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
import { decodeHtmlEntities } from "./html-entities";
import { BGG_LINK_TYPES } from "./types";
import type { BggLink, BggSearchResult, BggThingType, GameSnapshot, Locale } from "./types";

const SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const THING_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const BGG_SUPPORTED_THING_TYPES = "boardgame,boardgameexpansion";

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
  return textString(attribute);
}

function textString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? decodeHtmlEntities(value) : undefined;
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

function uniqueList(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeDescription(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  return decodeHtmlEntities(value)
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim()
    .slice(0, 800);
}

function normalizeThingType(value: unknown): BggThingType {
  return value === "boardgameexpansion" ? "boardgameexpansion" : "boardgame";
}

type BggThingXmlItem = {
  "@_id"?: string | number;
  "@_type"?: string;
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

type BggThingLinkXml = {
  "@_id"?: string | number;
  "@_type"?: string;
  "@_value"?: string | number;
  "@_inbound"?: string | boolean | number;
};

async function fetchBggXml(path: string): Promise<string> {
  return requestBggXml(path);
}

function excludeIds(results: BggSearchResult[]) {
  return results.map((result) => result.bggId);
}

function mergeSearchResult(existing: BggSearchResult, incoming: BggSearchResult): BggSearchResult {
  return {
    ...existing,
    thingType:
      existing.thingType === "boardgameexpansion" || incoming.thingType === "boardgameexpansion"
        ? "boardgameexpansion"
        : existing.thingType ?? incoming.thingType,
    yearPublished: existing.yearPublished ?? incoming.yearPublished,
    rank: existing.rank ?? incoming.rank,
    averageRating: existing.averageRating ?? incoming.averageRating,
    canonicalName: existing.canonicalName || incoming.canonicalName,
    displayName: existing.displayName || incoming.displayName,
    localizedName: existing.localizedName || incoming.localizedName,
    matchedAlias: existing.matchedAlias || incoming.matchedAlias
  };
}

function dedupeSearchResults(results: BggSearchResult[], limit = 20) {
  const byBggId = new Map<string, BggSearchResult>();

  for (const result of results) {
    if (!result.bggId) {
      continue;
    }

    const existing = byBggId.get(result.bggId);
    byBggId.set(result.bggId, existing ? mergeSearchResult(existing, result) : result);
  }

  return Array.from(byBggId.values()).slice(0, limit);
}

function attrBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeBggLink(link: BggThingLinkXml): BggLink | null {
  const type = textString(link["@_type"]);
  const name = textString(link["@_value"])?.trim();

  if (!type || !name) {
    return null;
  }

  return {
    id: textString(link["@_id"]),
    type,
    name,
    ...(link["@_inbound"] !== undefined ? { inbound: attrBoolean(link["@_inbound"]) } : {})
  };
}

function groupLinks(links: BggLink[]) {
  return links.reduce<Record<string, BggLink[]>>((accumulator, link) => {
    accumulator[link.type] = [...(accumulator[link.type] ?? []), link];
    return accumulator;
  }, {});
}

function linksOfType(linksByType: Record<string, BggLink[]>, type: string) {
  return linksByType[type] ?? [];
}

function linkNames(links: BggLink[]) {
  return uniqueList(links.map((link) => link.name));
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
      | BggThingLinkXml
      | BggThingLinkXml[]
      | undefined
  )
    .map(normalizeBggLink)
    .filter((link): link is BggLink => Boolean(link));
  const linksByType = groupLinks(links);
  const designerLinks = linksOfType(linksByType, "boardgamedesigner");
  const artistLinks = linksOfType(linksByType, "boardgameartist");
  const publisherLinks = linksOfType(linksByType, "boardgamepublisher");
  const categoryLinks = linksOfType(linksByType, "boardgamecategory");
  const mechanicLinks = linksOfType(linksByType, "boardgamemechanic");
  const familyLinks = linksOfType(linksByType, "boardgamefamily");
  const expansionLinks = linksOfType(linksByType, "boardgameexpansion");
  const implementationLinks = linksOfType(linksByType, "boardgameimplementation");
  const integrationLinks = linksOfType(linksByType, "boardgameintegration");
  const compilationLinks = linksOfType(linksByType, "boardgamecompilation");
  const accessoryLinks = linksOfType(linksByType, "boardgameaccessory");

  return {
    bggId: String(item["@_id"] ?? fallbackBggId),
    thingType: normalizeThingType(item["@_type"]),
    name: textString(primaryName?.["@_value"]) ?? `BGG #${fallbackBggId}`,
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
    links: Object.fromEntries(
      Object.entries(linksByType).filter(([type]) => BGG_LINK_TYPES.includes(type as (typeof BGG_LINK_TYPES)[number]))
    ),
    designers: compactList(linkNames(designerLinks)),
    designerLinks,
    categories: compactList(linkNames(categoryLinks)),
    categoryLinks,
    mechanics: compactList(linkNames(mechanicLinks)),
    mechanicLinks,
    publishers: compactList(linkNames(publisherLinks)),
    publisherLinks,
    artists: compactList(linkNames(artistLinks)),
    artistLinks,
    families: compactList(linkNames(familyLinks)),
    familyLinks,
    expansions: compactList(linkNames(expansionLinks)),
    expansionLinks,
    implementations: compactList(linkNames(implementationLinks)),
    implementationLinks,
    integrations: compactList(linkNames(integrationLinks)),
    integrationLinks,
    compilations: compactList(linkNames(compilationLinks)),
    compilationLinks,
    accessories: compactList(linkNames(accessoryLinks)),
    accessoryLinks
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
  const combinedResults = dedupeSearchResults([...localizedResults, ...aliasResults, ...localResults, ...indexResults]);

  if (combinedResults.length > 0) {
    return combinedResults;
  }

  const cacheKey = `search:${normalizedQuery.toLowerCase()}:boardgames-and-expansions`;
  const cached = getCache<BggSearchResult[]>(cacheKey);

  if (cached) {
    return dedupeSearchResults(
      cached.map((result) => ({
        ...result,
        thingType: result.thingType ?? "boardgame",
        displayName: result.displayName || result.name,
        canonicalName: result.canonicalName || result.name,
        locale
      }))
    );
  }

  const xml = await fetchBggXml(
    `/search?query=${encodeURIComponent(normalizedQuery)}&type=${BGG_SUPPORTED_THING_TYPES}`
  );
  const parsed = parser.parse(xml) as {
    items?: {
      item?: Array<{
        "@_id"?: string | number;
        "@_type"?: string;
        name?: { "@_value"?: string };
        yearpublished?: { "@_value"?: string | number };
      }>;
    };
  };

  const results = dedupeSearchResults(asArray(parsed.items?.item)
    .map((item) => ({
      bggId: String(item["@_id"] ?? ""),
      thingType: normalizeThingType(item["@_type"]),
      name: attrString(item.name) ?? "",
      displayName: attrString(item.name) ?? "",
      canonicalName: attrString(item.name) ?? "",
      locale,
      yearPublished: attrNumber(item.yearpublished),
      source: "bgg" as const
    }))
    .filter((item) => item.bggId && item.name));

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

  const cacheKey = `thing:${bggId}:boardgames-and-expansions`;
  const cached = getCache<GameSnapshot>(cacheKey);

  if (cached) {
    const gameWithCachedCovers = await cacheGameCovers({
      ...cached,
      thingType: cached.thingType ?? "boardgame"
    });
    upsertGameSnapshot(gameWithCachedCovers);
    return getGameSnapshot(bggId, locale) ?? applyGameNaming(gameWithCachedCovers, locale);
  }

  const xml = await fetchBggXml(
    `/thing?id=${encodeURIComponent(bggId)}&type=${BGG_SUPPORTED_THING_TYPES}&stats=1`
  );
  const snapshot = parseThingXml(xml, [bggId])[0];

  if (!snapshot) {
    throw new Error("没有找到这个 BGG 桌游或扩展。");
  }

  const snapshotWithCachedCovers = await cacheGameCovers(snapshot);

  setCache(cacheKey, snapshotWithCachedCovers, THING_CACHE_TTL_SECONDS);
  upsertGameSnapshot(snapshotWithCachedCovers);
  return getGameSnapshot(bggId, locale) ?? applyGameNaming(snapshotWithCachedCovers, locale);
}

export async function refreshBggThing(bggId: string, locale: Locale = "en") {
  const xml = await fetchBggXml(
    `/thing?id=${encodeURIComponent(bggId)}&type=${BGG_SUPPORTED_THING_TYPES}&stats=1`
  );
  const snapshot = parseThingXml(xml, [bggId])[0];

  if (!snapshot) {
    throw new Error("没有找到这个 BGG 桌游或扩展。");
  }

  const snapshotWithCachedCovers = await cacheGameCovers(snapshot);
  setCache(`thing:${bggId}:boardgames-and-expansions`, snapshotWithCachedCovers, THING_CACHE_TTL_SECONDS);
  upsertGameSnapshot(snapshotWithCachedCovers);

  return getGameSnapshot(bggId, locale) ?? applyGameNaming(snapshotWithCachedCovers, locale);
}
