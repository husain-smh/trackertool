#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

type DefectReason = 'invalid_format' | 'duplicate';

type Defect = {
  line: number;
  input: string;
  reason: DefectReason;
  normalized_username: string;
  normalized_url: string;
  first_seen_line?: number;
};

function normalizeUsernameFromInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Accept "@handle"
  if (trimmed.startsWith('@')) {
    const handle = trimmed.slice(1).trim();
    return handle || null;
  }

  // Accept profile URLs:
  // - https://x.com/handle
  // - https://twitter.com/handle
  // - x.com/handle (no scheme)
  // - twitter.com/handle (no scheme)
  const urlMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[\/?#]|$)/i,
  );
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  // Plain handle
  // X usernames are max 15 chars and [A-Za-z0-9_]
  const handleMatch = trimmed.match(/^([A-Za-z0-9_]{1,15})$/);
  if (handleMatch?.[1]) {
    return handleMatch[1];
  }

  return null;
}

function csvEscape(value: string): string {
  const s = String(value ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCanonicalUrl(username: string): string {
  return `https://x.com/${username}`;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) {
      out[k] = v;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[k] = next;
      i += 1;
    } else {
      out[k] = true;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const inputPath =
    typeof args.input === 'string'
      ? args.input
      : typeof args.i === 'string'
        ? args.i
        : path.resolve(process.cwd(), 'influenceraccount.md');

  const outDir =
    typeof args.outDir === 'string'
      ? args.outDir
      : typeof args.o === 'string'
        ? args.o
        : process.cwd();

  const baseName = path.basename(inputPath).replace(/\.[^.]+$/, '');
  const cleanedPath = path.join(outDir, `${baseName}.cleaned.txt`);
  const defectsPath = path.join(outDir, `${baseName}.defects.csv`);

  const raw = await fs.readFile(inputPath, 'utf8');
  const lines = raw.split(/\r?\n/g);

  const seen = new Map<string, { line: number; username: string }>();
  const cleaned: string[] = [];
  const defects: Defect[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const input = String(lines[i] ?? '').trim();
    if (!input) continue;

    const username = normalizeUsernameFromInput(input);
    if (!username) {
      defects.push({
        line: lineNumber,
        input,
        reason: 'invalid_format',
        normalized_username: '',
        normalized_url: '',
      });
      continue;
    }

    const normalizedUsername = username.replace(/^@/, '').trim();
    const key = normalizedUsername.toLowerCase();
    const normalizedUrl = toCanonicalUrl(normalizedUsername);

    const first = seen.get(key);
    if (first) {
      defects.push({
        line: lineNumber,
        input,
        reason: 'duplicate',
        normalized_username: normalizedUsername,
        normalized_url: normalizedUrl,
        first_seen_line: first.line,
      });
      continue;
    }

    seen.set(key, { line: lineNumber, username: normalizedUsername });
    cleaned.push(normalizedUrl);
  }

  cleaned.sort((a, b) => a.localeCompare(b));

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(cleanedPath, `${cleaned.join('\n')}\n`, 'utf8');

  const header = ['line', 'reason', 'first_seen_line', 'normalized_username', 'normalized_url', 'input'];
  const rows = defects.map((d) =>
    [
      String(d.line),
      d.reason,
      d.first_seen_line ? String(d.first_seen_line) : '',
      d.normalized_username,
      d.normalized_url,
      d.input,
    ].map(csvEscape),
  );
  const csv = [header.map(csvEscape).join(','), ...rows.map((r) => r.join(','))].join('\n') + '\n';
  await fs.writeFile(defectsPath, csv, 'utf8');

  const invalidCount = defects.filter((d) => d.reason === 'invalid_format').length;
  const duplicateCount = defects.filter((d) => d.reason === 'duplicate').length;

  // eslint-disable-next-line no-console
  console.log(
    [
      `✅ Cleaned list written: ${cleanedPath}`,
      `✅ Defects report written: ${defectsPath}`,
      `---`,
      `Input non-empty lines: ${lines.filter((l) => String(l ?? '').trim().length > 0).length}`,
      `Unique valid usernames: ${cleaned.length}`,
      `Invalid lines: ${invalidCount}`,
      `Duplicate lines: ${duplicateCount}`,
    ].join('\n'),
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});

