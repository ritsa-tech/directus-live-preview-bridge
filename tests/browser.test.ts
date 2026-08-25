import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeScript } from '../src/bridge-script.js';

type PostedMessage = {
  message: {
    collection: string;
    edits: Record<string, unknown>;
    primaryKey: unknown;
    type: string;
  };
  targetOrigin: string;
};

type FakeFrame = {
  contentWindow: {
    postMessage(message: PostedMessage['message'], targetOrigin: string): void;
  };
  src: string;
};

type BrowserSetup = {
  frame: FakeFrame;
  messages: PostedMessage[];
  poll(): void;
  sendReady(origin?: string): void;
};

function setupBrowser(props?: Record<string, unknown>): BrowserSetup {
  const messages: PostedMessage[] = [];
  const windowListeners = new Map<string, (event: MessageEvent) => void>();
  let poll: (() => void) | undefined;

  class FakeIframe {}

  const frame = Object.assign(new FakeIframe(), {
    src: 'https://preview.example.com/articles/welcome',
    contentWindow: {
      postMessage(
        message: PostedMessage['message'],
        targetOrigin: string,
      ): void {
        messages.push({ message, targetOrigin });
      },
    },
  }) as FakeFrame;

  const form = {
    __vueParentComponent: {
      parent: null,
      props:
        props ??
        ({
          collection: 'articles',
          initialValues: { title: 'Saved title' },
          modelValue: {},
          primaryKey: 'article-id',
        } satisfies Record<string, unknown>),
    },
  };

  vi.stubGlobal('HTMLIFrameElement', FakeIframe);
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    querySelector: () => frame,
    querySelectorAll: () => [form],
  });
  vi.stubGlobal('window', {
    addEventListener(type: string, callback: (event: MessageEvent) => void) {
      windowListeners.set(type, callback);
    },
    setInterval(callback: () => void) {
      poll = callback;
      return 1;
    },
  });

  new Function(createBridgeScript(75))();

  if (!poll) throw new TypeError('Bridge did not register its polling loop.');

  return {
    frame,
    messages,
    poll,
    sendReady(origin = 'https://preview.example.com') {
      windowListeners.get('message')?.({
        data: { type: 'directus-live-preview-bridge:ready' },
        origin,
        source: frame.contentWindow,
      } as unknown as MessageEvent);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser bridge', () => {
  it('streams staged form edits to the preview origin and deduplicates them', () => {
    const props = {
      collection: 'articles',
      initialValues: { title: 'Saved title' },
      modelValue: {},
      primaryKey: 'article-id',
    };
    const browser = setupBrowser(props);

    browser.poll();

    expect(browser.messages).toEqual([
      {
        message: {
          type: 'directus-live-preview-bridge:edits',
          collection: 'articles',
          primaryKey: 'article-id',
          edits: {},
        },
        targetOrigin: 'https://preview.example.com',
      },
    ]);

    browser.poll();
    expect(browser.messages).toHaveLength(1);

    props.modelValue = { title: 'Unsaved title' };
    browser.poll();

    expect(browser.messages).toHaveLength(2);
    expect(browser.messages[1]?.message.edits).toEqual({
      title: 'Unsaved title',
    });
  });

  it('replays state only for a ready message from the current preview frame', () => {
    const browser = setupBrowser();

    browser.poll();
    browser.sendReady('https://attacker.example.com');
    expect(browser.messages).toHaveLength(1);

    browser.sendReady();
    expect(browser.messages).toHaveLength(2);
    expect(browser.messages[1]).toEqual(browser.messages[0]);
  });

  it('does not post edits to an iframe with a non-web URL', () => {
    const browser = setupBrowser();

    browser.frame.src = 'data:text/html,preview';
    browser.poll();

    expect(browser.messages).toHaveLength(0);
  });

  it('falls back to Directus field data attributes', () => {
    const messages: PostedMessage[] = [];
    const documentListeners = new Map<string, (event: Event) => void>();

    class FakeIframe {}

    const frame = Object.assign(new FakeIframe(), {
      src: 'https://preview.example.com/articles/welcome',
      contentWindow: {
        postMessage(message: PostedMessage['message'], targetOrigin: string) {
          messages.push({ message, targetOrigin });
        },
      },
    });
    const fieldRoot = {
      dataset: {
        collection: 'articles',
        field: 'reading_time',
        primaryKey: 'article-id',
      },
    };
    const input = {
      closest: () => fieldRoot,
      tagName: 'INPUT',
      type: 'number',
      value: '12',
    };

    vi.stubGlobal('HTMLIFrameElement', FakeIframe);
    vi.stubGlobal('document', {
      addEventListener(type: string, callback: (event: Event) => void) {
        documentListeners.set(type, callback);
      },
      querySelector: () => frame,
      querySelectorAll: () => [],
    });
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      setInterval: vi.fn(),
    });

    new Function(createBridgeScript(120))();
    documentListeners.get('input')?.({ target: input } as unknown as Event);

    expect(messages).toEqual([
      {
        message: {
          type: 'directus-live-preview-bridge:edits',
          collection: 'articles',
          primaryKey: 'article-id',
          edits: { reading_time: 12 },
        },
        targetOrigin: 'https://preview.example.com',
      },
    ]);
  });
});
