import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

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

const browser = new Window();
const previousGlobals = new Map();
for (const name of [
  'window',
  'document',
  'Element',
  'SVGElement',
  'HTMLIFrameElement',
]) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, {
    value: name === 'window' ? browser : browser[name],
    configurable: true,
    writable: true,
  });
}
let app;

try {
  const { createApp, h, reactive, nextTick } =
    await import('vue/dist/vue.runtime.esm-browser.prod.js');
  document.body.innerHTML =
    '<div id="app"></div><div class="live-preview"><iframe id="frame"></iframe></div>';
  const state = reactive({ edits: {}, initialValues: { status: 'draft' } });
  const form = {
    props: ['fields', 'primaryKey', 'modelValue', 'initialValues'],
    setup(_props, { emit }) {
      return () =>
        h('div', { class: 'v-form' }, [
          h(
            'button',
            {
              onClick: () => emit('update:modelValue', { status: 'published' }),
            },
            'Publish',
          ),
        ]);
    },
  };
  app = createApp({
    render: () =>
      h(form, {
        fields: [{ field: 'status', collection: 'articles' }],
        primaryKey: '1',
        modelValue: state.edits,
        initialValues: state.initialValues,
        'onUpdate:modelValue': (edits) => {
          state.edits = edits;
        },
      }),
  });
  app.mount('#app');
  assert.equal(
    document.querySelector('.v-form').__vueParentComponent,
    undefined,
  );
  const frame = document.querySelector('iframe');
  Object.defineProperty(frame, 'src', {
    value: 'https://preview.example/articles/1',
  });
  const messages = [];
  frame.contentWindow.postMessage = (data, origin) =>
    messages.push({ data, origin });
  let poll;
  window.setInterval = (callback) => {
    poll = callback;
    return 1;
  };
  new Function(response.body)();
  assert.equal(globalThis.window.__directusLivePreviewBridgeInstalled, true);
  poll();
  document.querySelector('button').click();
  await nextTick();
  poll();
  assert.deepEqual(messages.at(-1), {
    origin: 'https://preview.example',
    data: {
      type: 'directus-live-preview-bridge:edits',
      collection: 'articles',
      primaryKey: '1',
      edits: { status: 'published' },
      initialValues: { status: 'draft' },
    },
  });
  state.initialValues = { status: 'published' };
  state.edits = {};
  await nextTick();
  poll();
  assert.deepEqual(messages.at(-1).data.edits, {});
  assert.deepEqual(messages.at(-1).data.initialValues, { status: 'published' });
} finally {
  app?.unmount();
  await browser.happyDOM.close();
  for (const [name, descriptor] of previousGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

console.log(
  'Built bundle passed production Vue form, dropdown and save checks.',
);
