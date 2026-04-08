import { NextResponse } from "next/server";
import { FALLBACK_SESSIONS, parseCsvSessions, SHEET_ID } from "@/lib/writing";

export const revalidate = 300;

const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

async function fetchWithTimeout(url: string, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 300 },
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8"
      }
    });

    if (!res.ok) {
      throw new Error(`Google Sheets request failed (${res.status})`);
    }

    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  try {
    const csv = await fetchWithTimeout(CSV_URL);
    const sessions = parseCsvSessions(csv);

    if (sessions.length === 0) {
      console.error("/api/sessions parsed zero valid rows; serving fallback dataset");
      return NextResponse.json({
        ok: false,
        warning: "Sheet loaded but contained no valid rows. Serving fallback data.",
        source: "fallback",
        sessions: FALLBACK_SESSIONS,
        fetchedAt: new Date().toISOString()
      });
    }

    return NextResponse.json({
      ok: true,
      source: CSV_URL,
      sessions,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("/api/sessions failed; serving fallback dataset", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Unable to fetch writing sessions from Google Sheets. Serving fallback data.",
        source: "fallback",
        sessions: FALLBACK_SESSIONS,
        fetchedAt: new Date().toISOString()
      },
      { status: 200 }
    );
  }
}
