import { NextResponse } from "next/server";
import { FALLBACK_SESSIONS, parseCsvSessions, type WritingSession } from "@/lib/writing";

export const revalidate = 0;
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const READ_CACHE_TTL_MS = 30_000;
const READ_ERROR = "Unable to fetch writing sessions from the configured private sheet reader. Serving fallback data.";

type SessionsResponse = {
  ok: boolean;
  source: string;
  sessions: WritingSession[];
  fetchedAt: string;
  error?: string;
  warning?: string;
};

let sessionsReadCache: { key: string; expiresAt: number; data: SessionsResponse } | null = null;

function json(data: unknown, init: ResponseInit = {}) {
  return NextResponse.json(data, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
}

function configuredReadUrl() {
  return process.env.WRITING_SESSIONS_READ_URL || process.env.WRITING_SESSIONS_CSV_URL || "";
}

function readUrlWithToken(rawUrl: string) {
  const token = process.env.WRITING_SESSIONS_TOKEN || "";
  if (!token || rawUrl.includes("docs.google.com/spreadsheets")) return rawUrl;
  const url = new URL(rawUrl);
  if (!url.searchParams.has("token")) url.searchParams.set("token", token);
  if (!url.searchParams.has("action")) url.searchParams.set("action", "sessions");
  return url.toString();
}

function getCachedSessions(key: string): SessionsResponse | null {
  if (!sessionsReadCache || sessionsReadCache.key !== key || sessionsReadCache.expiresAt <= Date.now()) return null;
  return sessionsReadCache.data;
}

function setCachedSessions(key: string, data: SessionsResponse) {
  sessionsReadCache = { key, data, expiresAt: Date.now() + READ_CACHE_TTL_MS };
}

async function fetchWithTimeout(url: string, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(readUrlWithToken(url), {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8"
      }
    });

    if (!res.ok) {
      throw new Error(`Writing sessions request failed (${res.status})`);
    }

    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const readUrl = configuredReadUrl();
  if (!readUrl) {
    return json({
      ok: false,
      error: "Writing sessions are not connected yet. Serving fallback data.",
      source: "fallback",
      sessions: FALLBACK_SESSIONS,
      fetchedAt: new Date().toISOString()
    });
  }

  try {
    const cached = getCachedSessions(readUrl);
    if (cached) return json(cached);

    const csv = await fetchWithTimeout(readUrl);
    const sessions = parseCsvSessions(csv);

    if (sessions.length === 0) {
      console.error("/api/sessions parsed zero valid rows; serving fallback dataset");
      return json({
        ok: false,
        warning: "Sheet loaded but contained no valid rows. Serving fallback data.",
        source: "fallback",
        sessions: FALLBACK_SESSIONS,
        fetchedAt: new Date().toISOString()
      });
    }

    const data: SessionsResponse = {
      ok: true,
      source: process.env.WRITING_SESSIONS_READ_URL ? "private-reader" : "server-csv",
      sessions,
      fetchedAt: new Date().toISOString()
    };
    setCachedSessions(readUrl, data);
    return json(data);
  } catch (error) {
    console.error("/api/sessions failed; serving fallback dataset", error);

    return json(
      {
        ok: false,
        error: READ_ERROR,
        source: "fallback",
        sessions: FALLBACK_SESSIONS,
        fetchedAt: new Date().toISOString()
      },
      { status: 200 }
    );
  }
}
