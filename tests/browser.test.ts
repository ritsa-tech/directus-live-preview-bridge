// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeScript } from '../src/bridge-script.js';

// Explicitly test the production runtime without per-element devtools metadata.
const runtime = 'vue/dist/vue.runtime.esm-browser.prod.js';
const {
  createApp,
  defineComponent,
  h,
  reactive,
  nextTick,
  Fragment,
  Suspense,
  Teleport,
}: typeof import('vue') = await import(runtime);
const cleanups: (() => void)[] = [];

function setupBrowser() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  document.body.innerHTML =
    '<div id="app"></div><div id="teleported"></div><div class="live-preview"><iframe id="frame"></iframe></div>';
  const frame = document.querySelector<HTMLIFrameElement>('#frame')!;
  // Keep the real iframe Window, without making a network request.
  Object.defineProperty(frame, 'src', {
    value: 'https://preview.example.com/articles/1',
    writable: true,
  });
  const postMessage = vi
    .spyOn(frame.contentWindow!, 'postMessage')
    .mockImplementation(() => {});
  const state = reactive({
    collection: undefined as string | undefined,
    fields: ['title', 'summary', 'status'].map((field) => ({
      collection: 'articles',
      field,
    })),
    visible: true,
    loading: false,
    primaryKey: '1',
    edits: {} as Record<string, unknown>,
    initialValues: {
      title: 'Saved title',
      summary: 'Saved summary',
      status: 'draft',
    } as Record<string, unknown>,
  });
  const Form = defineComponent({
    props: [
      'collection',
      'fields',
      'primaryKey',
      'modelValue',
      'initialValues',
      'loading',
    ],
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      function update(field: string, value: unknown) {
        emit('update:modelValue', { ...props.modelValue, [field]: value });
      }
      return () =>
        h('div', { class: 'v-form' }, [
          h(
            'div',
            {
              'data-collection': 'articles',
              'data-field': 'summary',
              'data-primary-key': props.primaryKey,
            },
            [
              h('input', {
                value: props.modelValue.summary ?? props.initialValues.summary,
                onInput: (event: Event) =>
                  update(
                    'summary',
                    (event.target as HTMLInputElement).value.trim(),
                  ),
              }),
            ],
          ),
          // Like Directus VSelect, selection emits a component event from a click.
          h(
            'button',
            { id: 'publish', onClick: () => update('status', 'published') },
            'Published',
          ),
          h(
            'button',
            { id: 'clear', onClick: () => update('summary', null) },
            'Clear',
          ),
          h(
            'button',
            {
              id: 'reset',
              onClick: () => {
                const edits = { ...props.modelValue };
                delete edits.summary;
                emit('update:modelValue', edits);
              },
            },
            'Reset summary',
          ),
        ]);
    },
  });
  const app = createApp({
    render: () =>
      h(Fragment, [
        h(Suspense, null, {
          default: () =>
            h(
              Teleport,
              { to: '#teleported' },
              state.visible
                ? [
                    h(Form, {
                      collection: state.collection,
                      fields: state.fields,
                      primaryKey: state.primaryKey,
                      modelValue: state.edits,
                      initialValues: state.initialValues,
                      loading: state.loading,
                      'onUpdate:modelValue': (
                        edits: Record<string, unknown>,
                      ) => {
                        state.edits = edits;
                      },
                    }),
                  ]
                : [],
            ),
        }),
      ]),
  });
  app.mount('#app');
  const addListener = vi.spyOn(window, 'addEventListener');
  const script = createBridgeScript(75);
  new Function(script)();
  cleanups.push(() => {
    for (const [type, callback] of addListener.mock.calls)
      window.removeEventListener(type, callback);
    app.unmount();
  });

  return {
    frame,
    state,
    postMessage,
    script,
    async poll() {
      await nextTick();
      vi.advanceTimersByTime(75);
    },
    ready(
      origin = 'https://preview.example.com',
      source: Window = frame.contentWindow!,
    ) {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'directus-live-preview-bridge:ready' },
          origin,
          source,
        }),
      );
    },
    lastMessage() {
      return postMessage.mock.lastCall?.[0];
    },
  };
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as Window & { __directusLivePreviewBridgeInstalled?: boolean })
    .__directusLivePreviewBridgeInstalled;
  document.body.innerHTML = '';
});

describe('production browser bridge', () => {
  it('also supports forms with an explicit collection instead of field definitions', async () => {
    const browser = setupBrowser();
    browser.state.collection = 'articles';
    browser.state.fields = [];
    await browser.poll();
    expect(browser.lastMessage().collection).toBe('articles');
  });

  it('does not guess a collection for mixed field definitions', async () => {
    const browser = setupBrowser();
    browser.state.fields.push({
      collection: 'other_collection',
      field: 'title',
    });
    await browser.poll();
    expect(browser.postMessage).not.toHaveBeenCalled();
  });

  it('skips unrelated form elements before the item form', async () => {
    const browser = setupBrowser();
    const unrelated = document.createElement('div');
    unrelated.className = 'v-form';
    document.body.prepend(unrelated);
    await browser.poll();
    expect(browser.lastMessage().collection).toBe('articles');
  });

  it('reads a production form through fragments, suspense and teleports', async () => {
    const browser = setupBrowser();
    expect(document.querySelector('.v-form')).not.toHaveProperty(
      '__vueParentComponent',
    );
    await browser.poll();
    expect(browser.postMessage).toHaveBeenCalledExactlyOnceWith(
      {
        type: 'directus-live-preview-bridge:edits',
        collection: 'articles',
        primaryKey: '1',
        edits: {},
        initialValues: {
          title: 'Saved title',
          summary: 'Saved summary',
          status: 'draft',
        },
      },
      'https://preview.example.com',
    );
    await browser.poll();
    expect(browser.postMessage).toHaveBeenCalledTimes(1);
  });

  it('streams custom dropdown selections without a DOM input or change event', async () => {
    const browser = setupBrowser();
    await browser.poll();
    document.querySelector<HTMLButtonElement>('#publish')!.click();
    await browser.poll();
    expect(browser.lastMessage().edits).toEqual({ status: 'published' });
  });

  it('uses normalized form values and respects clear and reset actions', async () => {
    const browser = setupBrowser();
    const input = document.querySelector('input')!;
    input.value = '  Unsaved summary  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await browser.poll();
    expect(browser.lastMessage().edits).toEqual({ summary: 'Unsaved summary' });
    document.querySelector<HTMLButtonElement>('#clear')!.click();
    await browser.poll();
    expect(browser.lastMessage().edits).toEqual({ summary: null });
    document.querySelector<HTMLButtonElement>('#reset')!.click();
    await browser.poll();
    expect(browser.lastMessage().edits).toEqual({});
  });

  it('sends the updated baseline after a save and when only saved values change', async () => {
    const browser = setupBrowser();
    browser.state.edits = { title: 'New title' };
    await browser.poll();
    browser.state.initialValues = {
      ...browser.state.initialValues,
      ...browser.state.edits,
    };
    browser.state.edits = {};
    await browser.poll();
    expect(browser.lastMessage()).toMatchObject({
      edits: {},
      initialValues: { title: 'New title' },
    });
    browser.state.initialValues.title = 'Server-normalized title';
    await browser.poll();
    expect(browser.lastMessage().initialValues.title).toBe(
      'Server-normalized title',
    );
    expect(browser.postMessage).toHaveBeenCalledTimes(3);
  });

  it('does not replay discarded edits after leaving and reopening a form', async () => {
    const browser = setupBrowser();
    browser.state.edits = { summary: 'Discarded' };
    await browser.poll();
    browser.state.visible = false;
    await browser.poll();
    expect(browser.postMessage).toHaveBeenCalledTimes(1);
    browser.state.edits = {};
    browser.state.visible = true;
    await browser.poll();
    expect(browser.lastMessage().edits).toEqual({});
  });

  it('skips loading forms and reads the new item after navigation', async () => {
    const browser = setupBrowser();
    await browser.poll();
    browser.state.loading = true;
    browser.state.primaryKey = '2';
    await browser.poll();
    expect(browser.postMessage).toHaveBeenCalledTimes(1);
    browser.state.initialValues = { title: 'Second item' };
    browser.state.loading = false;
    await browser.poll();
    expect(browser.lastMessage()).toMatchObject({
      primaryKey: '2',
      initialValues: { title: 'Second item' },
    });
  });

  it('replays only for a ready message from the expected origin and current iframe', async () => {
    const browser = setupBrowser();
    await browser.poll();
    browser.ready('https://attacker.example');
    browser.ready('https://preview.example.com', window);
    expect(browser.postMessage).toHaveBeenCalledTimes(1);
    browser.ready();
    expect(browser.postMessage).toHaveBeenCalledTimes(2);
  });

  it('skips non-web URLs and resumes when the same iframe has a valid URL', async () => {
    const browser = setupBrowser();
    browser.frame.src = 'data:text/html,preview';
    await browser.poll();
    expect(browser.postMessage).not.toHaveBeenCalled();
    browser.frame.src = 'https://preview.example.com/articles/1';
    await browser.poll();
    expect(browser.postMessage).toHaveBeenCalledTimes(1);
  });

  it('skips circular data and resumes once the form is serializable', async () => {
    const browser = setupBrowser();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    browser.state.edits = circular;
    await browser.poll();
    expect(browser.postMessage).not.toHaveBeenCalled();
    browser.state.edits = { title: 'Serializable' };
    await browser.poll();
    expect(browser.lastMessage().edits).toEqual({ title: 'Serializable' });
  });

  it('installs only one polling loop', async () => {
    const browser = setupBrowser();
    new Function(browser.script)();
    expect(vi.getTimerCount()).toBe(1);
    await browser.poll();
    expect(browser.postMessage).toHaveBeenCalledTimes(1);
  });
});
