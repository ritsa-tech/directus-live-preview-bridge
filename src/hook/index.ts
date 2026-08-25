import type { defineHook } from '@directus/extensions-sdk';

import { DEFAULT_SCRIPT_PATH, resolveScriptPath } from '../config.js';

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

type HookConfig = Parameters<typeof defineHook>[0];

const hook: HookConfig = ({ embed }, { env, logger }) => {
  const configuredPath = env.LIVE_PREVIEW_BRIDGE_SCRIPT_PATH;
  const scriptPath = resolveScriptPath(configuredPath);

  if (
    configuredPath &&
    configuredPath !== DEFAULT_SCRIPT_PATH &&
    scriptPath === DEFAULT_SCRIPT_PATH
  ) {
    logger.warn(
      'LIVE_PREVIEW_BRIDGE_SCRIPT_PATH must be a same-origin, root-relative URL path. Using the default path.',
    );
  }

  embed(
    'body',
    `<script defer src="${escapeHtmlAttribute(scriptPath)}"></script>`,
  );
};

export default hook;
