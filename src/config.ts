export const DEFAULT_POLL_INTERVAL_MS = 120;
export const DEFAULT_SCRIPT_PATH = '/live-preview-bridge/script.js';

const MIN_POLL_INTERVAL_MS = 50;
const MAX_POLL_INTERVAL_MS = 5_000;
const VALIDATION_BASE_URL = 'https://directus.invalid';

export function resolvePollInterval(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  const interval = Number(value);

  if (
    !Number.isInteger(interval) ||
    interval < MIN_POLL_INTERVAL_MS ||
    interval > MAX_POLL_INTERVAL_MS
  ) {
    return DEFAULT_POLL_INTERVAL_MS;
  }

  return interval;
}

export function resolveScriptPath(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_SCRIPT_PATH;
  }

  if (typeof value !== 'string' || !value.startsWith('/')) {
    return DEFAULT_SCRIPT_PATH;
  }

  try {
    const url = new URL(value, VALIDATION_BASE_URL);

    if (url.origin !== VALIDATION_BASE_URL) {
      return DEFAULT_SCRIPT_PATH;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_SCRIPT_PATH;
  }
}
