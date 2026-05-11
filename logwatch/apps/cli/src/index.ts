#!/usr/bin/env node

import { createInterface } from 'node:readline';
import type { OtelLogRecord, SeverityText } from '@logwatch/shared';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string;
  subcommand?: string;
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] = node, argv[1] = script, argv[2] = command, ...
  const args = argv.slice(2);
  const command = args[0] ?? '';
  const rest = args.slice(1);

  const positional: string[] = [];
  const flags: Record<string, string> = {};
  let subcommand: string | undefined;

  let i = 0;
  // For api-key command, the first positional after command is the subcommand
  let subcommandParsed = command !== 'api-key';

  while (i < rest.length) {
    const arg = rest[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith('--')) {
        // Boolean flag
        flags[key] = 'true';
        i++;
      } else {
        flags[key] = next;
        i += 2;
      }
    } else if (!subcommandParsed) {
      subcommand = arg;
      subcommandParsed = true;
      i++;
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { command, subcommand, positional, flags };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getApiUrl(flags: Record<string, string>): string {
  return flags['api-url'] ?? process.env.LOGWATCH_API_URL ?? 'http://localhost:4000';
}

function getHeaders(flags: Record<string, string>): Record<string, string> {
  const apiKey = flags['api-key'] ?? process.env.LOGWATCH_API_KEY;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// ANSI colour helpers (TTY-only)
// ---------------------------------------------------------------------------

const useTTY = process.stdout.isTTY ?? false;

const ANSI = {
  reset: useTTY ? '\x1b[0m' : '',
  red: useTTY ? '\x1b[31m' : '',
  yellow: useTTY ? '\x1b[33m' : '',
  dim: useTTY ? '\x1b[2m' : '',
  bold: useTTY ? '\x1b[1m' : '',
};

function colorizeSeverity(severity: string): string {
  const upper = severity.toUpperCase();
  if (upper === 'ERROR' || upper === 'FATAL') {
    return `${ANSI.red}${upper}${ANSI.reset}`;
  }
  if (upper === 'WARN') {
    return `${ANSI.yellow}${upper}${ANSI.reset}`;
  }
  return upper;
}

// ---------------------------------------------------------------------------
// Command: ingest
// ---------------------------------------------------------------------------

async function cmdIngest(parsed: ParsedArgs): Promise<void> {
  if (parsed.flags['help'] === 'true') {
    console.log(`Usage: logwatch ingest [options]

Ship logs from stdin. Each line should be a JSON log record.

Options:
  --api-url <url>       API base URL (default: http://localhost:4000)
  --api-key <key>       API key (or set LOGWATCH_API_KEY env var)
  --service <name>      Default service name to tag logs with
  --batch-size <n>      Records per batch (default: 100)`);
    return;
  }

  const apiUrl = getApiUrl(parsed.flags);
  const headers = getHeaders(parsed.flags);
  const serviceName = parsed.flags['service'];
  const batchSize = parseInt(parsed.flags['batch-size'] ?? '100', 10);

  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  let batch: unknown[] = [];
  let totalRecords = 0;
  let totalBatches = 0;

  async function flushBatch(records: unknown[]): Promise<void> {
    if (records.length === 0) return;
    try {
      const body = JSON.stringify({ logs: records });
      const res = await fetch(`${apiUrl}/api/v1/ingest/otlp-logs`, {
        method: 'POST',
        headers,
        body,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        process.stderr.write(`Error: HTTP ${res.status} — ${text}\n`);
      }
      totalBatches++;
      totalRecords += records.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Error shipping batch: ${msg}\n`);
    }
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const record = JSON.parse(trimmed);
      // Apply default service name if not present
      if (serviceName && !record.service) {
        record.service = serviceName;
      }
      batch.push(record);
    } catch {
      process.stderr.write(`Skipping invalid JSON line: ${trimmed.slice(0, 80)}\n`);
      continue;
    }

    if (batch.length >= batchSize) {
      await flushBatch(batch);
      batch = [];
    }
  }

  // Flush remaining
  await flushBatch(batch);

  console.log(`Shipped ${totalRecords} records (${totalBatches} batches)`);
}

// ---------------------------------------------------------------------------
// Command: query
// ---------------------------------------------------------------------------

async function cmdQuery(parsed: ParsedArgs): Promise<void> {
  if (parsed.flags['help'] === 'true') {
    console.log(`Usage: logwatch query <search-term> [options]

Search logs.

Options:
  --api-url <url>       API base URL (default: http://localhost:4000)
  --api-key <key>       API key (or set LOGWATCH_API_KEY env var)
  --from <timestamp>    Start time in ISO 8601 (default: 1 hour ago)
  --to <timestamp>      End time in ISO 8601 (default: now)
  --service <name>      Filter by service name
  --severity <level>    Filter by severity (TRACE|DEBUG|INFO|WARN|ERROR|FATAL)
  --limit <n>           Max results (default: 20)
  --json                Output raw JSON instead of formatted`);
    return;
  }

  const searchTerm = parsed.positional[0] ?? parsed.subcommand;
  if (!searchTerm) {
    console.error('Error: search term required. Usage: logwatch query <search-term>');
    process.exit(1);
  }

  const apiUrl = getApiUrl(parsed.flags);
  const headers = getHeaders(parsed.flags);
  const jsonOutput = parsed.flags['json'] === 'true';

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const params = new URLSearchParams();
  params.set('q', searchTerm);
  params.set('from', parsed.flags['from'] ?? oneHourAgo.toISOString());
  if (parsed.flags['to']) {
    params.set('to', parsed.flags['to']);
  } else {
    params.set('to', now.toISOString());
  }
  if (parsed.flags['service']) {
    params.set('service', parsed.flags['service']);
  }
  if (parsed.flags['severity']) {
    params.set('severity', parsed.flags['severity']);
  }
  params.set('limit', parsed.flags['limit'] ?? '20');

  try {
    const url = `${apiUrl}/api/v1/logs?${params.toString()}`;
    const res = await fetch(url, { method: 'GET', headers });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`Error: HTTP ${res.status} — ${text}`);
      process.exit(1);
    }

    const result = await res.json() as { data: OtelLogRecord[]; pagination?: { total: number } };
    const logs = result.data ?? [];

    if (jsonOutput) {
      for (const log of logs) {
        console.log(JSON.stringify(log));
      }
    } else {
      if (logs.length === 0) {
        console.log('No logs found.');
        return;
      }
      for (const log of logs) {
        const ts = log.timestamp ?? '';
        const sev = colorizeSeverity(log.severity_text ?? 'INFO');
        const svc = log.service_name ?? '-';
        const body = log.body ?? '';
        console.log(`[${ts}] [${sev}] [${svc}] ${body}`);
      }
      if (result.pagination) {
        console.log(`\n${ANSI.dim}${logs.length} of ${result.pagination.total} results${ANSI.reset}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error querying logs: ${msg}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Command: api-key
// ---------------------------------------------------------------------------

async function cmdApiKey(parsed: ParsedArgs): Promise<void> {
  const sub = parsed.subcommand;

  if (!sub || parsed.flags['help'] === 'true') {
    console.log(`Usage: logwatch api-key <subcommand> [options]

Manage API keys.

Subcommands:
  create    Create a new API key
  list      List all API keys
  revoke    Revoke an API key

Create options:
  --name <name>         Name for the API key (required)
  --scopes <scopes>     Comma-separated scopes (required)

Revoke options:
  <id>                  API key ID to revoke (positional arg)`);
    return;
  }

  const apiUrl = getApiUrl(parsed.flags);
  const headers = getHeaders(parsed.flags);

  switch (sub) {
    case 'create':
      await apiKeyCreate(apiUrl, headers, parsed);
      break;
    case 'list':
      await apiKeyList(apiUrl, headers);
      break;
    case 'revoke':
      await apiKeyRevoke(apiUrl, headers, parsed);
      break;
    default:
      console.error(`Unknown api-key subcommand: ${sub}`);
      console.error('Available subcommands: create, list, revoke');
      process.exit(1);
  }
}

async function apiKeyCreate(
  apiUrl: string,
  headers: Record<string, string>,
  parsed: ParsedArgs,
): Promise<void> {
  const name = parsed.flags['name'];
  const scopesRaw = parsed.flags['scopes'];

  if (!name || !scopesRaw) {
    console.error('Error: --name and --scopes are required for api-key create');
    process.exit(1);
  }

  const scopes = scopesRaw.split(',').map((s) => s.trim());

  try {
    const res = await fetch(`${apiUrl}/api/v1/admin/api-keys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, scopes }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`Error: HTTP ${res.status} — ${text}`);
      process.exit(1);
    }

    const result = await res.json() as { key: string; id: string; prefix: string };

    console.log(`API key created successfully.\n`);
    console.log(`  Key: ${result.key}`);
    if (result.id) console.log(`  ID:  ${result.id}`);
    console.log(`\n${ANSI.yellow}Save this key — it won't be shown again${ANSI.reset}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error creating API key: ${msg}`);
    process.exit(1);
  }
}

async function apiKeyList(
  apiUrl: string,
  headers: Record<string, string>,
): Promise<void> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/admin/api-keys`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`Error: HTTP ${res.status} — ${text}`);
      process.exit(1);
    }

    const result = await res.json() as {
      data: Array<{
        name: string;
        prefix: string;
        scopes: string[];
        expires_at: string | null;
      }>;
    };

    const keys = result.data ?? [];

    if (keys.length === 0) {
      console.log('No API keys found.');
      return;
    }

    // Calculate column widths
    const nameW = Math.max(4, ...keys.map((k) => k.name.length));
    const prefixW = Math.max(6, ...keys.map((k) => k.prefix.length));
    const scopesW = Math.max(6, ...keys.map((k) => k.scopes.join(', ').length));
    const expiresW = 24;

    const header = [
      'NAME'.padEnd(nameW),
      'PREFIX'.padEnd(prefixW),
      'SCOPES'.padEnd(scopesW),
      'EXPIRES_AT'.padEnd(expiresW),
    ].join('  ');

    console.log(header);
    console.log('-'.repeat(header.length));

    for (const key of keys) {
      const row = [
        key.name.padEnd(nameW),
        key.prefix.padEnd(prefixW),
        key.scopes.join(', ').padEnd(scopesW),
        (key.expires_at ?? 'never').padEnd(expiresW),
      ].join('  ');
      console.log(row);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error listing API keys: ${msg}`);
    process.exit(1);
  }
}

async function apiKeyRevoke(
  apiUrl: string,
  headers: Record<string, string>,
  parsed: ParsedArgs,
): Promise<void> {
  const id = parsed.positional[0];
  if (!id) {
    console.error('Error: API key ID required. Usage: logwatch api-key revoke <id>');
    process.exit(1);
  }

  try {
    const res = await fetch(`${apiUrl}/api/v1/admin/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`Error: HTTP ${res.status} — ${text}`);
      process.exit(1);
    }

    console.log('API key revoked');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error revoking API key: ${msg}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`${ANSI.bold}logwatch${ANSI.reset} — LogWatch CLI

${ANSI.bold}Usage:${ANSI.reset}
  logwatch <command> [options]

${ANSI.bold}Commands:${ANSI.reset}
  ingest       Ship logs from stdin
  query        Search logs
  api-key      Manage API keys

${ANSI.bold}Global Options:${ANSI.reset}
  --api-url <url>   API base URL (default: http://localhost:4000)
  --api-key <key>   API key (or set LOGWATCH_API_KEY env var)
  --help            Show help for a command

${ANSI.bold}Examples:${ANSI.reset}
  cat app.log | logwatch ingest --service my-app
  logwatch query "error timeout" --severity ERROR --limit 50
  logwatch api-key create --name ci-key --scopes ingest,query
  logwatch api-key list
  logwatch api-key revoke abc123`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const commands: Record<string, (parsed: ParsedArgs) => Promise<void>> = {
  ingest: cmdIngest,
  query: cmdQuery,
  'api-key': cmdApiKey,
};

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  if (!parsed.command || parsed.command === '--help' || parsed.command === '-h') {
    printHelp();
    process.exit(0);
  }

  const handler = commands[parsed.command];
  if (!handler) {
    console.error(`Unknown command: ${parsed.command}`);
    console.error('Run "logwatch --help" for usage information.');
    process.exit(1);
  }

  await handler(parsed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
