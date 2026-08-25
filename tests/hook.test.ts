import { describe, expect, it, vi } from 'vitest';

import hook from '../src/hook/index.js';

describe('Data Studio embed hook', () => {
  it('loads the bridge from the default same-origin endpoint', () => {
    const embed = vi.fn();

    hook({ embed } as never, { env: {}, logger: { warn: vi.fn() } } as never);

    expect(embed).toHaveBeenCalledWith(
      'body',
      '<script defer src="/live-preview-bridge/script.js"></script>',
    );
  });

  it('supports a reverse-proxy path and escapes its query string', () => {
    const embed = vi.fn();

    hook(
      { embed } as never,
      {
        env: {
          LIVE_PREVIEW_BRIDGE_SCRIPT_PATH:
            '/cms/live-preview-bridge/script.js?one=1&two=2',
        },
        logger: { warn: vi.fn() },
      } as never,
    );

    expect(embed).toHaveBeenCalledWith(
      'body',
      '<script defer src="/cms/live-preview-bridge/script.js?one=1&amp;two=2"></script>',
    );
  });

  it('rejects cross-origin script URLs', () => {
    const embed = vi.fn();
    const warn = vi.fn();

    hook(
      { embed } as never,
      {
        env: {
          LIVE_PREVIEW_BRIDGE_SCRIPT_PATH: 'https://cdn.example.com/bridge.js',
        },
        logger: { warn },
      } as never,
    );

    expect(embed).toHaveBeenCalledWith(
      'body',
      '<script defer src="/live-preview-bridge/script.js"></script>',
    );
    expect(warn).toHaveBeenCalledOnce();
  });
});
