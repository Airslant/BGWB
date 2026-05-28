const BGG_XML_BASE_URL = "https://boardgamegeek.com/xmlapi2";
const DEFAULT_REQUEST_INTERVAL_MS = 5200;
const MAX_ATTEMPTS = 4;

const inFlightRequests = new Map<string, Promise<string>>();

let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequestIntervalMs() {
  const configured = Number(process.env.BGG_REQUEST_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 1000 ? configured : DEFAULT_REQUEST_INTERVAL_MS;
}

function getRetryAfterMs(response: Response) {
  const retryAfter = response.headers.get("retry-after");

  if (!retryAfter) {
    return 0;
  }

  const seconds = Number(retryAfter);

  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  const retryDate = Date.parse(retryAfter);
  return Number.isFinite(retryDate) ? Math.max(0, retryDate - Date.now()) : 0;
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

async function waitForRequestSlot() {
  const intervalMs = getRequestIntervalMs();
  const nextAllowedAt = lastRequestAt + intervalMs;
  const waitMs = Math.max(0, nextAllowedAt - Date.now());

  if (waitMs > 0) {
    await delay(waitMs);
  }

  lastRequestAt = Date.now();
}

async function fetchBggXml(path: string) {
  const token = process.env.BGG_API_TOKEN;

  if (!token) {
    throw new Error("BGG_API_TOKEN 未配置，无法请求 BoardGameGeek。");
  }

  const headers: HeadersInit = {
    Accept: "application/xml",
    Authorization: `Bearer ${token}`
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await waitForRequestSlot();

    const response = await fetch(`${BGG_XML_BASE_URL}${path}`, {
      headers,
      next: { revalidate: 0 }
    });

    if (response.status === 202) {
      lastError = new Error("BGG 正在准备数据，请稍后重试。");
      await delay(Math.max(getRetryAfterMs(response), getRequestIntervalMs()));
      continue;
    }

    if ((response.status === 500 || response.status === 503) && attempt < MAX_ATTEMPTS - 1) {
      lastError = new Error(`BGG 当前繁忙：${response.status}`);
      await delay(Math.max(getRetryAfterMs(response), getRequestIntervalMs() * (attempt + 1)));
      continue;
    }

    if (response.status === 401) {
      throw new Error("BGG token 无效或缺失，请确认使用 boardgamegeek.com 域名和 Authorization: Bearer <token> 格式。");
    }

    if (!response.ok) {
      throw new Error(`BGG 请求失败：${response.status}`);
    }

    return response.text();
  }

  throw lastError ?? new Error("BGG 请求失败，请稍后再试。");
}

function enqueue<T>(task: () => Promise<T>) {
  const run = queueTail.then(task, task);
  queueTail = run.catch(() => undefined);
  return run;
}

export function requestBggXml(path: string) {
  const normalizedPath = normalizePath(path);
  const existing = inFlightRequests.get(normalizedPath);

  if (existing) {
    return existing;
  }

  const request = enqueue(() => fetchBggXml(normalizedPath)).finally(() => {
    inFlightRequests.delete(normalizedPath);
  });

  inFlightRequests.set(normalizedPath, request);
  return request;
}
