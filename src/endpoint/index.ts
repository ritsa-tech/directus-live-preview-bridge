import type { defineEndpoint } from '@directus/extensions-sdk';

import { createBridgeScript } from '../bridge-script.js';
import { DEFAULT_POLL_INTERVAL_MS, resolvePollInterval } from '../config.js';

export const ENDPOINT_ID = 'live-preview-bridge';

type EndpointConfig = Parameters<typeof defineEndpoint>[0];

const endpoint = {
  id: ENDPOINT_ID,
  handler(router, { env, logger }) {
    const configuredInterval = env.LIVE_PREVIEW_BRIDGE_POLL_INTERVAL_MS;
    const pollIntervalMs = resolvePollInterval(configuredInterval);

    if (
      configuredInterval !== undefined &&
      pollIntervalMs === DEFAULT_POLL_INTERVAL_MS &&
      Number(configuredInterval) !== DEFAULT_POLL_INTERVAL_MS
    ) {
      logger.warn(
        'LIVE_PREVIEW_BRIDGE_POLL_INTERVAL_MS must be an integer from 50 through 5000. Using 120 ms.',
      );
    }

    const bridgeScript = createBridgeScript(pollIntervalMs);

    router.get('/script.js', (_request, response) => {
      response
        .set('Cache-Control', 'no-store')
        .set('X-Content-Type-Options', 'nosniff')
        .type('application/javascript')
        .send(bridgeScript);
    });
  },
} satisfies EndpointConfig;

export default endpoint;
