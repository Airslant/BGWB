import { NextResponse } from "next/server";

type RateLimitOptions = {
  limit: number;
  windowMs: number;
  blockMs?: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
  blockedUntil: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();
const DEFAULT_MUTATION_ERROR = "请求来源不被允许。";

function pruneRateLimitStore(now: number) {
  if (rateLimitStore.size < 2000) {
    return;
  }

  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now && entry.blockedUntil <= now) {
      rateLimitStore.delete(key);
    }
  }
}

export function getClientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export function consumeRateLimit(key: string, options: RateLimitOptions) {
  const now = Date.now();
  const blockMs = options.blockMs ?? options.windowMs;
  const existing = rateLimitStore.get(key);

  pruneRateLimitStore(now);

  if (existing && existing.blockedUntil > now) {
    return {
      ok: false as const,
      retryAfterSeconds: Math.ceil((existing.blockedUntil - now) / 1000)
    };
  }

  const entry =
    existing && existing.resetAt > now
      ? existing
      : {
          count: 0,
          resetAt: now + options.windowMs,
          blockedUntil: 0
        };

  entry.count += 1;

  if (entry.count > options.limit) {
    entry.blockedUntil = now + blockMs;
    rateLimitStore.set(key, entry);
    return {
      ok: false as const,
      retryAfterSeconds: Math.ceil(blockMs / 1000)
    };
  }

  rateLimitStore.set(key, entry);
  return { ok: true as const };
}

export function resetRateLimit(key: string) {
  rateLimitStore.delete(key);
}

function getAllowedOrigins(request: Request) {
  const url = new URL(request.url);
  const requestOrigin = url.origin;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto || url.protocol.replace(":", "");
  const requestHosts = [
    url.host,
    request.headers.get("host"),
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  ].filter(Boolean);
  const configuredOrigins = (process.env.BGWB_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([
    requestOrigin,
    ...requestHosts.map((host) => `${protocol}://${host}`),
    ...configuredOrigins
  ]);
}

export function assertSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  const secFetchSite = request.headers.get("sec-fetch-site");
  const allowedOrigins = getAllowedOrigins(request);
  const hasAllowedOrigin = Boolean(origin && allowedOrigins.has(origin));

  if (origin && !hasAllowedOrigin) {
    return NextResponse.json({ error: DEFAULT_MUTATION_ERROR }, { status: 403 });
  }

  if (secFetchSite && !hasAllowedOrigin && !["same-origin", "none"].includes(secFetchSite)) {
    return NextResponse.json({ error: DEFAULT_MUTATION_ERROR }, { status: 403 });
  }

  if (process.env.NODE_ENV === "production" && !origin && !secFetchSite) {
    return NextResponse.json({ error: DEFAULT_MUTATION_ERROR }, { status: 403 });
  }

  return null;
}

export function rateLimitResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: `请求过于频繁，请 ${retryAfterSeconds} 秒后再试。` },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds)
      }
    }
  );
}
