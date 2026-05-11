import type { SeverityText } from '../types/log.js';

export const SEVERITY_TEXT_TO_NUMBER: Record<SeverityText, number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
};

export const SEVERITY_NUMBER_TO_TEXT: Record<number, SeverityText> = {
  1: 'TRACE', 2: 'TRACE', 3: 'TRACE', 4: 'TRACE',
  5: 'DEBUG', 6: 'DEBUG', 7: 'DEBUG', 8: 'DEBUG',
  9: 'INFO', 10: 'INFO', 11: 'INFO', 12: 'INFO',
  13: 'WARN', 14: 'WARN', 15: 'WARN', 16: 'WARN',
  17: 'ERROR', 18: 'ERROR', 19: 'ERROR', 20: 'ERROR',
  21: 'FATAL', 22: 'FATAL', 23: 'FATAL', 24: 'FATAL',
};

export function normalizeSeverity(input: string | number | undefined): {
  severity_text: SeverityText;
  severity_number: number;
} {
  if (typeof input === 'number') {
    if (input >= 1 && input <= 24) {
      return {
        severity_number: input,
        severity_text: SEVERITY_NUMBER_TO_TEXT[input] ?? 'INFO',
      };
    }
    return { severity_number: 9, severity_text: 'INFO' };
  }

  if (typeof input === 'string') {
    const upper = input.toUpperCase() as SeverityText;
    if (upper in SEVERITY_TEXT_TO_NUMBER) {
      return {
        severity_text: upper,
        severity_number: SEVERITY_TEXT_TO_NUMBER[upper],
      };
    }
  }

  return { severity_number: 9, severity_text: 'INFO' };
}

export const OCSF_CATEGORIES = {
  SYSTEM_ACTIVITY: 1,
  FINDINGS: 2,
  IDENTITY_ACCESS: 3,
  NETWORK_ACTIVITY: 4,
  DISCOVERY: 5,
  APPLICATION_ACTIVITY: 6,
} as const;

export const OCSF_CLASSES = {
  PROCESS_ACTIVITY: 1001,
  FILE_ACTIVITY: 1002,
  AUTHENTICATION: 3001,
  AUTHORIZATION: 3002,
  HTTP_ACTIVITY: 4002,
  DNS_ACTIVITY: 4003,
} as const;
