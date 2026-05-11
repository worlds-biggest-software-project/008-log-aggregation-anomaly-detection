import { normalizeSeverity } from '../constants/severity.js';
import type { SeverityText } from '../types/log.js';

export interface SyslogMessage {
  facility: number;
  severity_number: number;
  severity_text: SeverityText;
  timestamp: string;
  hostname: string;
  app_name: string;
  proc_id: string;
  msg_id: string;
  structured_data: Record<string, string>;
  message: string;
}

const RFC5424_REGEX =
  /^<(\d{1,3})>(\d)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+((?:\[.*?\])*|-)\s*(.*)/;

const RFC3164_REGEX =
  /^<(\d{1,3})>(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s*(.*)/;

const SYSLOG_SEVERITY_MAP: Record<number, number> = {
  0: 21, // Emergency → FATAL
  1: 21, // Alert → FATAL
  2: 21, // Critical → FATAL
  3: 17, // Error → ERROR
  4: 13, // Warning → WARN
  5: 9,  // Notice → INFO
  6: 9,  // Informational → INFO
  7: 5,  // Debug → DEBUG
};

export function parseSyslog(raw: string): SyslogMessage | null {
  return parseRfc5424(raw) ?? parseRfc3164(raw);
}

function parseRfc5424(raw: string): SyslogMessage | null {
  const match = raw.match(RFC5424_REGEX);
  if (!match) return null;

  const priority = parseInt(match[1]!, 10);
  const facility = Math.floor(priority / 8);
  const syslogSeverity = priority % 8;
  const otelSeverity = SYSLOG_SEVERITY_MAP[syslogSeverity] ?? 9;
  const { severity_text, severity_number } = normalizeSeverity(otelSeverity);

  return {
    facility,
    severity_number,
    severity_text,
    timestamp: match[3] === '-' ? new Date().toISOString() : match[3]!,
    hostname: match[4] === '-' ? '' : match[4]!,
    app_name: match[5] === '-' ? '' : match[5]!,
    proc_id: match[6] === '-' ? '' : match[6]!,
    msg_id: match[7] === '-' ? '' : match[7]!,
    structured_data: parseStructuredData(match[8]!),
    message: match[9]?.trim() ?? '',
  };
}

function parseRfc3164(raw: string): SyslogMessage | null {
  const match = raw.match(RFC3164_REGEX);
  if (!match) return null;

  const priority = parseInt(match[1]!, 10);
  const facility = Math.floor(priority / 8);
  const syslogSeverity = priority % 8;
  const otelSeverity = SYSLOG_SEVERITY_MAP[syslogSeverity] ?? 9;
  const { severity_text, severity_number } = normalizeSeverity(otelSeverity);

  return {
    facility,
    severity_number,
    severity_text,
    timestamp: new Date(match[2]!).toISOString(),
    hostname: match[3]!,
    app_name: match[4]!,
    proc_id: match[5] ?? '',
    msg_id: '',
    structured_data: {},
    message: match[6]?.trim() ?? '',
  };
}

function parseStructuredData(raw: string): Record<string, string> {
  if (raw === '-' || !raw) return {};

  const result: Record<string, string> = {};
  const paramRegex = /(\S+?)="((?:[^"\\]|\\.)*)"/g;
  let paramMatch;
  while ((paramMatch = paramRegex.exec(raw)) !== null) {
    result[paramMatch[1]!] = paramMatch[2]!.replace(/\\(.)/g, '$1');
  }
  return result;
}
