import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_SCRIPT_PATH,
  resolvePollInterval,
  resolveScriptPath,
} from '../src/config.js';

describe('configuration', () => {
  it('accepts polling intervals within the documented range', () => {
    expect(resolvePollInterval('50')).toBe(50);
    expect(resolvePollInterval(250)).toBe(250);
    expect(resolvePollInterval('5000')).toBe(5_000);
  });

  it('falls back for invalid polling intervals', () => {
    expect(resolvePollInterval(undefined)).toBe(DEFAULT_POLL_INTERVAL_MS);
    expect(resolvePollInterval(49)).toBe(DEFAULT_POLL_INTERVAL_MS);
    expect(resolvePollInterval('120.5')).toBe(DEFAULT_POLL_INTERVAL_MS);
    expect(resolvePollInterval(5_001)).toBe(DEFAULT_POLL_INTERVAL_MS);
  });

  it('accepts only same-origin, root-relative script paths', () => {
    expect(resolveScriptPath('/cms/live-preview-bridge/script.js?rev=1')).toBe(
      '/cms/live-preview-bridge/script.js?rev=1',
    );
    expect(resolveScriptPath('https://cdn.example.com/script.js')).toBe(
      DEFAULT_SCRIPT_PATH,
    );
    expect(resolveScriptPath('//cdn.example.com/script.js')).toBe(
      DEFAULT_SCRIPT_PATH,
    );
    expect(resolveScriptPath('/\\cdn.example.com/script.js')).toBe(
      DEFAULT_SCRIPT_PATH,
    );
  });
});
