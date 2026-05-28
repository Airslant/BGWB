import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual, scryptSync } from "node:crypto";

import { cookies } from "next/headers";

import {
  cleanupEmailVerificationCodes,
  consumeEmailVerificationCode,
  countEmailCodeRequestsForEmail,
  countEmailCodeRequestsForIp,
  createSession,
  createEmailVerificationCode,
  createUser,
  deleteSession,
  deleteSessionsForUser,
  deleteUserAccount,
  getLatestEmailVerificationCode,
  getUserByEmail,
  getUserWithPasswordById,
  getUserBySessionTokenHash,
  incrementEmailVerificationCodeAttempts,
  setUserPassword,
  setUserRole,
  updateUserNickname
} from "./db";
import { sendVerificationEmail } from "./mailer";
import { consumeRateLimit, getClientIp, resetRateLimit } from "./request-security";
import type { AdminUser, EmailCodePurpose, User } from "./types";

const SESSION_COOKIE_NAME = "bgwb_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_KEY_LENGTH = 64;
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
const EMAIL_CODE_COOLDOWN_MS = 60 * 1000;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODE_MAX_EMAIL_HOURLY = 5;
const EMAIL_CODE_MAX_IP_HOURLY = 20;
const PASSWORD_ACTION_LIMIT = 5;
const PASSWORD_ACTION_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_CODE_GENERIC_RESET_MESSAGE = "如果该邮箱存在账号，验证码邮件会发送到该邮箱。";
const EMAIL_CODE_INVALID_MESSAGE = "验证码不正确或已过期。";

export function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeNickname(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 20) : "";
}

export function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateNickname(nickname: string) {
  return nickname.length >= 1 && nickname.length <= 20;
}

export function validatePassword(password: unknown) {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

export function normalizeEmailCode(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateEmailCode(value: string) {
  return /^\d{6}$/.test(value);
}

function getAdminEmailSet() {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => normalizeEmail(email))
      .filter(Boolean)
  );
}

function isSeedAdminEmail(email: string) {
  return getAdminEmailSet().has(normalizeEmail(email));
}

function toPublicUser(user: AdminUser): User {
  return {
    id: user.id,
    nickname: user.nickname,
    email: user.email,
    createdAt: user.createdAt
  };
}

function syncSeedAdminRole<T extends AdminUser | null>(user: T): T {
  if (!user || user.role === "admin" || !isSeedAdminEmail(user.email)) {
    return user;
  }

  setUserRole(user.id, "admin");
  return {
    ...user,
    role: "admin"
  };
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString("base64url");
}

export function createPasswordHash(password: string) {
  const salt = randomBytes(16).toString("base64url");
  return `scrypt$${salt}$${hashPassword(password, salt)}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, expectedHash] = storedHash.split("$");

  if (algorithm !== "scrypt" || !salt || !expectedHash) {
    return false;
  }

  const actual = Buffer.from(hashPassword(password, salt), "base64url");
  const expected = Buffer.from(expectedHash, "base64url");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function shouldUseSecureCookies() {
  const configured = process.env.BGWB_SECURE_COOKIES;

  if (configured === "0" || configured === "false") {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

async function setSessionCookie(token: string) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookies()
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookies()
  });
}

export async function createUserSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  createSession(userId, hashSessionToken(token), expiresAt);
  await setSessionCookie(token);
}

export async function registerUser(email: string, nickname: string, password: string) {
  const user = createUser(email, nickname, createPasswordHash(password), isSeedAdminEmail(email) ? "admin" : "user", new Date().toISOString());
  await createUserSession(user.id);
  return toPublicUser(user);
}

function getEmailCodeSecret() {
  const configuredSecret = process.env.EMAIL_CODE_SECRET;

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("EMAIL_CODE_SECRET is required in production.");
  }

  return "bgwb-local-email-code-secret";
}

function generateEmailCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function safeCompare(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);

  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function hashEmailCode(email: string, purpose: EmailCodePurpose, code: string) {
  return createHmac("sha256", getEmailCodeSecret())
    .update(`${purpose}:${normalizeEmail(email)}:${code}`)
    .digest("base64url");
}

function hashRequestIp(ip: string) {
  return createHmac("sha256", getEmailCodeSecret()).update(ip || "unknown").digest("base64url");
}

function getRequestIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

function secondsUntil(value: string) {
  return Math.max(0, Math.ceil((new Date(value).getTime() + EMAIL_CODE_COOLDOWN_MS - Date.now()) / 1000));
}

async function createAndSendEmailCode(email: string, purpose: EmailCodePurpose, request: Request, shouldSend = true) {
  cleanupEmailVerificationCodes();

  const now = Date.now();
  const hourAgoIso = new Date(now - 60 * 60 * 1000).toISOString();
  const requestIpHash = hashRequestIp(getRequestIp(request));
  const latestCode = getLatestEmailVerificationCode(email, purpose);

  if (latestCode && new Date(latestCode.lastSentAt).getTime() + EMAIL_CODE_COOLDOWN_MS > now) {
    return {
      ok: false as const,
      status: 429,
      error: `验证码发送太频繁，请 ${secondsUntil(latestCode.lastSentAt)} 秒后再试。`
    };
  }

  if (countEmailCodeRequestsForEmail(email, purpose, hourAgoIso) >= EMAIL_CODE_MAX_EMAIL_HOURLY) {
    return {
      ok: false as const,
      status: 429,
      error: "这个邮箱请求验证码过于频繁，请稍后再试。"
    };
  }

  if (countEmailCodeRequestsForIp(requestIpHash, hourAgoIso) >= EMAIL_CODE_MAX_IP_HOURLY) {
    return {
      ok: false as const,
      status: 429,
      error: "验证码请求过于频繁，请稍后再试。"
    };
  }

  const code = generateEmailCode();
  const expiresAt = new Date(now + EMAIL_CODE_TTL_MS).toISOString();

  createEmailVerificationCode({
    email,
    purpose,
    codeHash: hashEmailCode(email, purpose, code),
    expiresAt,
    requestIpHash
  });

  if (shouldSend) {
    await sendVerificationEmail({ to: email, purpose, code });
  }

  return {
    ok: true as const,
    cooldownSeconds: EMAIL_CODE_COOLDOWN_MS / 1000
  };
}

function verifyStoredEmailCode(email: string, purpose: EmailCodePurpose, code: string) {
  cleanupEmailVerificationCodes();

  if (!validateEmailCode(code)) {
    return { ok: false as const, error: EMAIL_CODE_INVALID_MESSAGE };
  }

  const storedCode = getLatestEmailVerificationCode(email, purpose);

  if (
    !storedCode ||
    storedCode.consumedAt ||
    storedCode.attempts >= EMAIL_CODE_MAX_ATTEMPTS ||
    new Date(storedCode.expiresAt).getTime() <= Date.now()
  ) {
    return { ok: false as const, error: EMAIL_CODE_INVALID_MESSAGE };
  }

  const codeHash = hashEmailCode(email, purpose, code);

  if (!safeCompare(codeHash, storedCode.codeHash)) {
    incrementEmailVerificationCodeAttempts(storedCode.id);
    return { ok: false as const, error: EMAIL_CODE_INVALID_MESSAGE };
  }

  return { ok: true as const, codeId: storedCode.id };
}

export async function requestRegisterEmailCode(email: string, request: Request) {
  if (getUserByEmail(email)) {
    return { ok: false as const, status: 409, error: "这个邮箱已经注册。" };
  }

  return createAndSendEmailCode(email, "register", request);
}

export async function registerUserWithCode(email: string, nickname: string, password: string, code: string) {
  if (getUserByEmail(email)) {
    return { user: null, error: "这个邮箱已经注册。", status: 409 };
  }

  const verification = verifyStoredEmailCode(email, "register", code);

  if (!verification.ok) {
    return { user: null, error: verification.error, status: 400 };
  }

  const user = await registerUser(email, nickname, password);
  consumeEmailVerificationCode(verification.codeId);

  return { user };
}

export async function requestPasswordResetEmailCode(email: string, request: Request) {
  const user = getUserByEmail(email);
  const shouldSend = Boolean(user && !user.disabledAt);
  const result = await createAndSendEmailCode(email, "reset_password", request, shouldSend);

  if (!result.ok) {
    return result;
  }

  return { ok: true as const, message: EMAIL_CODE_GENERIC_RESET_MESSAGE };
}

export async function resetPasswordWithCode(email: string, password: string, code: string) {
  const user = getUserByEmail(email);

  if (!user || user.disabledAt) {
    return { user: null, error: EMAIL_CODE_INVALID_MESSAGE, status: 400 };
  }

  const verification = verifyStoredEmailCode(email, "reset_password", code);

  if (!verification.ok) {
    return { user: null, error: verification.error, status: 400 };
  }

  setUserPassword(user.id, createPasswordHash(password));
  deleteSessionsForUser(user.id);
  consumeEmailVerificationCode(verification.codeId);
  await createUserSession(user.id);

  return { user: toPublicUser(user) };
}

export async function loginUser(email: string, password: string) {
  const user = syncSeedAdminRole(getUserByEmail(email));

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { user: null, error: "邮箱或密码不正确。" };
  }

  if (user.disabledAt) {
    deleteSessionsForUser(user.id);
    return { user: null, error: "这个账号已被禁用。" };
  }

  await createUserSession(user.id);
  return { user: toPublicUser(user) };
}

async function getCurrentAuthUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const user = syncSeedAdminRole(getUserBySessionTokenHash(tokenHash));

  if (!user || user.disabledAt) {
    deleteSession(tokenHash);
    await clearSessionCookie();
    return null;
  }

  return user;
}

export async function getCurrentUser() {
  const user = await getCurrentAuthUser();
  return user ? toPublicUser(user) : null;
}

export async function getCurrentAdminUser() {
  const user = await getCurrentAuthUser();
  return user?.role === "admin" ? user : null;
}

export async function updateCurrentUserNickname(nickname: string) {
  const user = await getCurrentAuthUser();

  if (!user) {
    return { user: null, error: "请先登录。", status: 401 };
  }

  if (!validateNickname(nickname)) {
    return { user: null, error: "昵称需要 1-20 个字符。", status: 400 };
  }

  const updatedUser = updateUserNickname(user.id, nickname);

  if (!updatedUser) {
    return { user: null, error: "账户不存在。", status: 404 };
  }

  return { user: toPublicUser(updatedUser) };
}

async function getCurrentUserForPasswordAction(currentPassword: unknown, request: Request, action: string) {
  const user = await getCurrentAuthUser();

  if (!user) {
    return { user: null, error: "请先登录。", status: 401 };
  }

  const rateLimitKey = `${action}:${user.id}:${getClientIp(request)}`;
  const rateLimit = consumeRateLimit(rateLimitKey, {
    limit: PASSWORD_ACTION_LIMIT,
    windowMs: PASSWORD_ACTION_WINDOW_MS,
    blockMs: PASSWORD_ACTION_WINDOW_MS
  });

  if (!rateLimit.ok) {
    return {
      user: null,
      error: `请求过于频繁，请 ${rateLimit.retryAfterSeconds} 秒后再试。`,
      status: 429
    };
  }

  if (!validatePassword(currentPassword)) {
    return { user: null, error: "当前密码不正确。", status: 400 };
  }

  const userWithPassword = getUserWithPasswordById(user.id);

  if (!userWithPassword || userWithPassword.disabledAt) {
    return { user: null, error: "请先登录。", status: 401 };
  }

  if (!verifyPassword(currentPassword as string, userWithPassword.passwordHash)) {
    return { user: null, error: "当前密码不正确。", status: 400 };
  }

  resetRateLimit(rateLimitKey);
  return { user: userWithPassword };
}

export async function changeCurrentUserPassword(currentPassword: unknown, newPassword: unknown, request: Request) {
  const passwordAction = await getCurrentUserForPasswordAction(currentPassword, request, "change-password");

  if (!passwordAction.user) {
    return passwordAction;
  }

  if (!validatePassword(newPassword)) {
    return { user: null, error: "新密码需要 8-128 个字符。", status: 400 };
  }

  setUserPassword(passwordAction.user.id, createPasswordHash(newPassword as string));
  deleteSessionsForUser(passwordAction.user.id);
  await createUserSession(passwordAction.user.id);

  return { user: toPublicUser(passwordAction.user) };
}

export async function deleteCurrentUserAccount(currentPassword: unknown, request: Request) {
  const passwordAction = await getCurrentUserForPasswordAction(currentPassword, request, "delete-account");

  if (!passwordAction.user) {
    return passwordAction;
  }

  const deleted = deleteUserAccount(passwordAction.user.id);
  await clearSessionCookie();

  if (!deleted) {
    return { user: null, error: "账户不存在。", status: 404 };
  }

  return { ok: true as const };
}

export async function logoutCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    deleteSession(hashSessionToken(token));
  }

  await clearSessionCookie();
}
