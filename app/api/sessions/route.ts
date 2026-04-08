import { NextResponse } from "next/server";
import { parseCsvSessions, SHEET_ID } from "@/lib/writing";

export const revalidate = 300;

const URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/pub?output=csv`
];

async function fetchWithTimeout(url: string, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 300 },
      headers: {
        "User-Agent": "writing-analytics-dashboard/1.0"
      }
    });
    if (!res.ok) {
      throw new Error(`Failed ${url} (${res.status})`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const errors: string[] = [];

  for (const url of URLS) {
    try {
      const csv = await fetchWithTimeout(url);
      const sessions = parseCsvSessions(csv);
      if (sessions.length > 0) {
        return NextResponse.json({ source: url, sessions, fetchedAt: new Date().toISOString() });
      }
      errors.push(`No valid rows from ${url}`);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }

  return NextResponse.json(
    {
      error: "Unable to fetch writing sessions from Google Sheets.",
      details: errors
    },
    { status: 502 }
  );
}
