import { describe, it, expect } from 'vitest';
import { parseLisnaUserAgent, compareSemver } from '../../src/lib/user-agent.js';

describe('user-agent', () => {
  describe('parseLisnaUserAgent', () => {
    it('parses standard release UA', () => {
      expect(parseLisnaUserAgent('Lisna/v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: undefined });
    });
    it('parses pre-release UA', () => {
      expect(parseLisnaUserAgent('Lisna/v0.3.0-alpha.1')).toEqual({ major: 0, minor: 3, patch: 0, prerelease: 'alpha.1' });
    });
    it('parses dev UA', () => {
      expect(parseLisnaUserAgent('Lisna/v0.2.0-dev+abc123')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: 'dev+abc123' });
    });
    it('returns null on malformed UA', () => {
      expect(parseLisnaUserAgent('Mozilla/5.0')).toBeNull();
      expect(parseLisnaUserAgent('Lisna/v')).toBeNull();
      expect(parseLisnaUserAgent('lisna/v0.2.0')).toBeNull(); // case-sensitive
      expect(parseLisnaUserAgent('')).toBeNull();
    });
  });

  describe('compareSemver', () => {
    it('returns -1 when a < b', () => {
      expect(compareSemver({ major: 0, minor: 1, patch: 9 }, { major: 0, minor: 2, patch: 0 })).toBe(-1);
    });
    it('returns 1 when a > b', () => {
      expect(compareSemver({ major: 0, minor: 2, patch: 0 }, { major: 0, minor: 1, patch: 9 })).toBe(1);
    });
    it('returns 0 when equal', () => {
      expect(compareSemver({ major: 1, minor: 0, patch: 0 }, { major: 1, minor: 0, patch: 0 })).toBe(0);
    });
    it('ignores pre-release for comparison (spec sunset semantics)', () => {
      expect(compareSemver({ major: 0, minor: 2, patch: 0, prerelease: 'alpha' }, { major: 0, minor: 2, patch: 0 })).toBe(0);
    });
  });
});
