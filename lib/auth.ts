export const AUTH_COOKIE_NAME = "writing_journal_session";
export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const textEncoder = new TextEncoder();

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function signingSecret() {
  return process.env.WRITING_JOURNAL_AUTH_SECRET || process.env.WRITING_JOURNAL_PASSWORD || "";
}

async function signatureFor(value: string) {
  const secret = signingSecret();
  if (!secret) return "";

  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return hex(signature);
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

export async function createAuthCookieValue(now = Date.now()) {
  const issuedAt = String(now);
  const signature = await signatureFor(issuedAt);
  if (!signature) throw new Error("Missing writing journal auth signing secret");
  return `${issuedAt}.${signature}`;
}

export async function verifyAuthCookieValue(value: string | undefined, now = Date.now()) {
  if (!value) return false;
  const [issuedAtRaw, signature] = value.split(".");
  if (!issuedAtRaw || !signature || !/^\d+$/.test(issuedAtRaw)) return false;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return false;
  if (issuedAt > now) return false;
  if (now - issuedAt > AUTH_MAX_AGE_SECONDS * 1000) return false;

  const expected = await signatureFor(issuedAtRaw);
  return !!expected && safeEqual(signature, expected);
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE_SECONDS
  };
}
