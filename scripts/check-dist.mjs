import assert from 'node:assert/strict';

const { endpoints, hooks } = await import('../dist/api.js');

assert.equal(hooks.length, 1, 'The bundle must contain one hook.');
assert.equal(endpoints.length, 1, 'The bundle must contain one endpoint.');

let embed;

hooks[0].config(
  {
    embed(position, html) {
      embed = { html, position };
    },
  },
  { env: {}, logger: { warn() {} } },
);

assert.deepEqual(embed, {
  html: '<script defer src="/live-preview-bridge/script.js"></script>',
  position: 'body',
});

let route;

endpoints[0].config.handler(
  {
    get(path, handler) {
      route = { handler, path };
    },
  },
  { env: {}, logger: { warn() {} } },
);

assert.equal(route.path, '/script.js');

const response = {
  body: null,
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

route.handler({}, response);

assert.equal(response.headers['Cache-Control'], 'no-store');
assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
assert.equal(response.contentType, 'application/javascript');
assert.match(response.body, /directus-live-preview-bridge:edits/);

const previousWindow = globalThis.window;
const previousDocument = globalThis.document;

globalThis.window = {
  addEventListener() {},
  setInterval() {},
};
globalThis.document = {
  addEventListener() {},
};

try {
  new Function(response.body)();
  assert.equal(globalThis.window.__directusLivePreviewBridgeInstalled, true);
} finally {
  globalThis.window = previousWindow;
  globalThis.document = previousDocument;
}

console.log('Built bundle smoke test passed.');
