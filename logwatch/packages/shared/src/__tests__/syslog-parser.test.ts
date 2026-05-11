import { describe, it, expect } from 'vitest';
import { parseSyslog } from '../utils/syslog-parser.js';

describe('parseSyslog', () => {
  describe('RFC 5424', () => {
    it('parses a standard RFC 5424 syslog message', () => {
      const raw =
        '<165>1 2026-05-11T10:00:00.000Z myhost myapp 1234 ID47 [exampleSDID@32473 iut="3" eventSource="Application"] Application started successfully';

      const result = parseSyslog(raw);

      expect(result).not.toBeNull();
      // priority 165 = facility 20, severity 5 (notice)
      expect(result!.facility).toBe(20);
      expect(result!.severity_text).toBe('INFO'); // notice (5) maps to INFO
      expect(result!.timestamp).toBe('2026-05-11T10:00:00.000Z');
      expect(result!.hostname).toBe('myhost');
      expect(result!.app_name).toBe('myapp');
      expect(result!.proc_id).toBe('1234');
      expect(result!.msg_id).toBe('ID47');
      expect(result!.message).toBe('Application started successfully');
    });

    it('parses structured data parameters', () => {
      const raw =
        '<134>1 2026-05-11T10:00:00Z host app 1234 - [meta user="admin" action="login"] User logged in';

      const result = parseSyslog(raw);

      expect(result).not.toBeNull();
      expect(result!.structured_data).toEqual({
        user: 'admin',
        action: 'login',
      });
    });

    it('handles nil values (dashes) in RFC 5424', () => {
      const raw = '<134>1 - - - - - - No structured data here';

      const result = parseSyslog(raw);

      expect(result).not.toBeNull();
      expect(result!.hostname).toBe('');
      expect(result!.app_name).toBe('');
      expect(result!.proc_id).toBe('');
      expect(result!.msg_id).toBe('');
      expect(result!.structured_data).toEqual({});
      expect(result!.message).toContain('No structured data here');
    });

    it('maps syslog severity to OTel severity correctly', () => {
      // priority 11 = facility 1, severity 3 (error)
      const raw = '<11>1 2026-05-11T10:00:00Z host app - - - Error occurred';

      const result = parseSyslog(raw);

      expect(result).not.toBeNull();
      expect(result!.severity_text).toBe('ERROR');
      expect(result!.severity_number).toBe(17);
    });
  });

  describe('RFC 3164', () => {
    it('parses a standard RFC 3164 syslog message', () => {
      const raw = '<134>Jan  5 12:00:00 myhost myapp[1234]: System health check passed';

      const result = parseSyslog(raw);

      expect(result).not.toBeNull();
      // priority 134 = facility 16, severity 6 (informational)
      expect(result!.facility).toBe(16);
      expect(result!.severity_text).toBe('INFO'); // informational (6) maps to INFO
      expect(result!.hostname).toBe('myhost');
      expect(result!.app_name).toBe('myapp');
      expect(result!.proc_id).toBe('1234');
      expect(result!.message).toBe('System health check passed');
    });

    it('parses RFC 3164 without PID', () => {
      const raw = '<134>Jan  5 12:00:00 myhost myapp: Simple log message';

      const result = parseSyslog(raw);

      expect(result).not.toBeNull();
      expect(result!.app_name).toBe('myapp');
      expect(result!.proc_id).toBe('');
      expect(result!.message).toBe('Simple log message');
    });
  });

  describe('malformed input', () => {
    it('returns null for completely invalid input', () => {
      expect(parseSyslog('')).toBeNull();
      expect(parseSyslog('not a syslog message')).toBeNull();
      expect(parseSyslog('random garbage 12345')).toBeNull();
    });

    it('returns null for missing priority', () => {
      expect(parseSyslog('no priority here')).toBeNull();
    });

    it('returns null for truncated message', () => {
      expect(parseSyslog('<134>')).toBeNull();
    });
  });
});
