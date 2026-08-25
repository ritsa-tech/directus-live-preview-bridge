import { describe, expect, it, vi } from 'vitest';

import endpoint, { ENDPOINT_ID } from '../src/endpoint/index.js';

type RouteHandler = (request: unknown, response: ResponseMock) => void;

type ResponseMock = {
  body: string | null;
  contentType: string | null;
  headers: Record<string, string>;
  send(body: string): ResponseMock;
  set(name: string, value: string): ResponseMock;
  type(value: string): ResponseMock;
};

function registerEndpoint(configuredInterval?: unknown): {
  path: string;
  routeHandler: RouteHandler;
  warn: ReturnType<typeof vi.fn>;
} {
  if (typeof endpoint === 'function') {
    throw new TypeError('Expected an endpoint configuration object.');
  }

  let path = '';
  let routeHandler: RouteHandler | undefined;
  const warn = vi.fn();

  endpoint.handler(
    {
      get(routePath: string, handler: RouteHandler) {
        path = routePath;
        routeHandler = handler;
      },
    } as never,
    {
      env: {
        LIVE_PREVIEW_BRIDGE_POLL_INTERVAL_MS: configuredInterval,
      },
      logger: { warn },
    } as never,
  );

  if (!routeHandler) throw new TypeError('Endpoint route was not registered.');

  return { path, routeHandler, warn };
}

function createResponse(): ResponseMock {
  return {
    body: null,
    contentType: null,
    headers: {},
    send(body) {
      this.body = body;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    type(value) {
      this.contentType = value;
      return this;
    },
  };
}

describe('bridge script endpoint', () => {
  it('uses the stable endpoint ID', () => {
    expect(typeof endpoint).toBe('object');

    if (typeof endpoint !== 'function') {
      expect(endpoint.id).toBe(ENDPOINT_ID);
      expect(ENDPOINT_ID).toBe('live-preview-bridge');
    }
  });

  it('serves a non-cached, CSP-safe JavaScript response', () => {
    const { path, routeHandler, warn } = registerEndpoint('250');
    const response = createResponse();

    routeHandler({}, response);

    expect(path).toBe('/script.js');
    expect(response.headers).toEqual({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(response.contentType).toBe('application/javascript');
    expect(response.body).toContain('directus-live-preview-bridge:edits');
    expect(response.body).toContain('"pollIntervalMs":250');
    expect(() => new Function(response.body ?? '')).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and uses the default for an invalid polling interval', () => {
    const { routeHandler, warn } = registerEndpoint('fast');
    const response = createResponse();

    routeHandler({}, response);

    expect(response.body).toContain('"pollIntervalMs":120');
    expect(warn).toHaveBeenCalledOnce();
  });
});
