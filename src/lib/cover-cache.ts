import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join } from "node:path";

import { withBasePath } from "./base-path";
import type { GameSnapshot } from "./types";

export type CoverKind = "image" | "thumbnail";

type CoverAsset = {
  fileName: string;
  contentType: string;
  sourceUrl: string;
  byteLength: number;
  cachedAt: string;
};

type CoverManifest = Partial<Record<CoverKind, CoverAsset>>;

const MAX_COVER_BYTES = 12 * 1024 * 1024;
const DEFAULT_ALLOWED_COVER_HOSTS = ["cf.geekdo-images.com", "images.boardgamegeek.com", "boardgamegeek.com"];

function resolveCoverRoot() {
  const configuredPath = process.env.BGWB_COVER_CACHE_PATH ?? ".data/covers";
  return isAbsolute(configuredPath) ? configuredPath : join(process.cwd(), configuredPath);
}

function assertSafeBggId(bggId: string) {
  if (!/^\d+$/.test(bggId)) {
    throw new Error("BGG ID must be numeric.");
  }
}

export function isCoverKind(value: string): value is CoverKind {
  return value === "image" || value === "thumbnail";
}

function coverDir(bggId: string) {
  assertSafeBggId(bggId);
  return join(resolveCoverRoot(), bggId);
}

function manifestPath(bggId: string) {
  return join(coverDir(bggId), "manifest.json");
}

function publicCoverUrl(bggId: string, kind: CoverKind) {
  return withBasePath(`/api/covers/${encodeURIComponent(bggId)}/${kind}`);
}

async function readManifest(bggId: string): Promise<CoverManifest> {
  try {
    return JSON.parse(await readFile(manifestPath(bggId), "utf8")) as CoverManifest;
  } catch {
    return {};
  }
}

async function writeManifest(bggId: string, manifest: CoverManifest) {
  const targetPath = manifestPath(bggId);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, JSON.stringify(manifest, null, 2), "utf8");
}

function extensionFor(contentType: string, sourceUrl: string) {
  if (contentType.includes("png")) {
    return ".png";
  }

  if (contentType.includes("webp")) {
    return ".webp";
  }

  if (contentType.includes("gif")) {
    return ".gif";
  }

  const sourceExtension = extname(new URL(sourceUrl).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(sourceExtension)) {
    return sourceExtension;
  }

  return ".jpg";
}

function getAllowedCoverHosts() {
  const configuredHosts = (process.env.BGWB_COVER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return new Set(configuredHosts.length > 0 ? configuredHosts : DEFAULT_ALLOWED_COVER_HOSTS);
}

function isUsableUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && getAllowedCoverHosts().has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function readLimitedImageBytes(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > MAX_COVER_BYTES) {
    throw new Error("Cover image is too large to cache.");
  }

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());

    if (bytes.byteLength > MAX_COVER_BYTES) {
      throw new Error("Cover image is too large to cache.");
    }

    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    byteLength += value.byteLength;

    if (byteLength > MAX_COVER_BYTES) {
      await reader.cancel();
      throw new Error("Cover image is too large to cache.");
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, byteLength);
}

async function cachedAssetStillExists(bggId: string, asset: CoverAsset | undefined) {
  return Boolean(asset && existsSync(join(coverDir(bggId), asset.fileName)));
}

export async function cacheCoverImage(bggId: string, kind: CoverKind, sourceUrl: string | undefined) {
  if (!isUsableUrl(sourceUrl)) {
    return undefined;
  }

  const manifest = await readManifest(bggId);
  const existing = manifest[kind];

  if (existing?.sourceUrl === sourceUrl && (await cachedAssetStillExists(bggId, existing))) {
    return publicCoverUrl(bggId, kind);
  }

  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "BGWB/0.1 cover-cache"
    }
  });

  if (!response.ok) {
    throw new Error(`Cover download failed with HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/jpeg";

  if (!contentType.startsWith("image/")) {
    throw new Error(`Cover response is not an image: ${contentType}.`);
  }

  const bytes = await readLimitedImageBytes(response);

  const dir = coverDir(bggId);
  await mkdir(dir, { recursive: true });

  const fileName = `${kind}${extensionFor(contentType, sourceUrl)}`;
  const finalPath = join(dir, fileName);
  const tempPath = `${finalPath}.${Date.now()}.tmp`;

  await writeFile(tempPath, bytes);
  await rename(tempPath, finalPath);

  manifest[kind] = {
    fileName,
    contentType,
    sourceUrl,
    byteLength: bytes.byteLength,
    cachedAt: new Date().toISOString()
  };
  await writeManifest(bggId, manifest);

  return publicCoverUrl(bggId, kind);
}

export async function cacheGameCovers(game: GameSnapshot): Promise<GameSnapshot> {
  const nextGame = { ...game };

  try {
    nextGame.localImage = (await cacheCoverImage(game.bggId, "image", game.image)) ?? game.localImage;
  } catch (error) {
    console.warn(`Could not cache cover image for BGG #${game.bggId}:`, error);
  }

  try {
    nextGame.localThumbnail =
      (await cacheCoverImage(game.bggId, "thumbnail", game.thumbnail)) ?? game.localThumbnail;
  } catch (error) {
    console.warn(`Could not cache cover thumbnail for BGG #${game.bggId}:`, error);
  }

  return nextGame;
}

export async function readCachedCoverAsset(bggId: string, kind: CoverKind) {
  const manifest = await readManifest(bggId);
  const asset = manifest[kind];

  if (!asset) {
    return null;
  }

  try {
    const bytes = await readFile(join(coverDir(bggId), asset.fileName));
    return {
      bytes,
      contentType: asset.contentType,
      cachedAt: asset.cachedAt,
      sourceUrl: asset.sourceUrl
    };
  } catch {
    return null;
  }
}
