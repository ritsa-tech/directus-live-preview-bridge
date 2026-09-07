export interface LivePreviewBridgeOptions {
  pollIntervalMs?: number;
}

export function installLivePreviewBridge(
  options: LivePreviewBridgeOptions = {},
): void {
  type BridgeWindow = Window & {
    __directusLivePreviewBridgeInstalled?: boolean;
  };
  type VueComponent = {
    isUnmounted?: boolean;
    isDeactivated?: boolean;
    props?: Record<string, unknown>;
    subTree?: VueNode;
  };
  type VueNode = {
    el?: Node | null;
    component?: VueComponent | null;
    children?: unknown;
    suspense?: { activeBranch?: VueNode } | null;
  };
  type BridgeState = {
    collection: string;
    edits: Record<string, unknown>;
    initialValues: Record<string, unknown>;
    primaryKey: unknown;
  };

  const bridgeWindow = window as BridgeWindow;

  if (bridgeWindow.__directusLivePreviewBridgeInstalled) return;
  bridgeWindow.__directusLivePreviewBridgeInstalled = true;

  const MESSAGE_TYPE = 'directus-live-preview-bridge:edits';
  const READY_MESSAGE_TYPE = 'directus-live-preview-bridge:ready';
  const DEFAULT_INTERVAL_MS = 120;
  const pollIntervalMs =
    Number.isInteger(options.pollIntervalMs) &&
    Number(options.pollIntervalMs) >= 50 &&
    Number(options.pollIntervalMs) <= 5_000
      ? Number(options.pollIntervalMs)
      : DEFAULT_INTERVAL_MS;
  let previousFrame: HTMLIFrameElement | null = null;
  let previousSignature: string | null = null;
  let currentForm: VueComponent | null = null;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function formCollection(props: Record<string, unknown>): string | null {
    if (typeof props.collection === 'string' && props.collection)
      return props.collection;
    // Directus 12's item route passes field definitions instead of collection.
    if (!Array.isArray(props.fields)) return null;
    const first = props.fields[0];
    if (
      !isRecord(first) ||
      typeof first.collection !== 'string' ||
      !first.collection
    )
      return null;
    return props.fields.every(
      (field) => isRecord(field) && field.collection === first.collection,
    )
      ? first.collection
      : null;
  }

  function readFormState(): BridgeState | null {
    for (const element of document.querySelectorAll('.v-form')) {
      const instance =
        currentForm &&
        !currentForm.isUnmounted &&
        !currentForm.isDeactivated &&
        currentForm.subTree?.el === element
          ? currentForm
          : findForm(element);
      const props = instance?.props;
      if (!props) continue;
      const collection = formCollection(props);
      if (!collection) continue;
      currentForm = instance;
      if (props.loading) return null;

      return {
        collection,
        edits: isRecord(props.modelValue) ? props.modelValue : {},
        initialValues: isRecord(props.initialValues) ? props.initialValues : {},
        primaryKey: props.primaryKey ?? null,
      };
    }

    currentForm = null;
    return null;
  }

  function findForm(element: Element): VueComponent | null {
    // Vue retains the mounted VNode tree in production. Per-element devtools
    // metadata such as __vueParentComponent is absent from the Data Studio build.
    const pending: unknown[] = Array.from(
      document.querySelectorAll<HTMLElement & { _vnode?: VueNode }>(
        '[data-v-app]',
      ),
      (root) => root._vnode,
    );
    const visited = new Set<unknown>();

    while (pending.length) {
      const value = pending.pop();
      if (!isRecord(value) || visited.has(value)) continue;
      visited.add(value);

      const node = value as VueNode;
      const instance = node.component;

      if (instance) {
        if (instance.isUnmounted || instance.isDeactivated) continue;
        const props = instance.props;
        if (
          instance.subTree?.el === element &&
          props &&
          formCollection(props) !== null &&
          'modelValue' in props &&
          'initialValues' in props
        )
          return instance;

        pending.push(instance.subTree);
      } else if (node.suspense) {
        pending.push(node.suspense.activeBranch);
      } else if (Array.isArray(node.children)) {
        pending.push(...node.children);
      }
    }

    return null;
  }

  function readPreviewFrame(): HTMLIFrameElement | null {
    const frame = document.querySelector('.live-preview iframe#frame');

    if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) {
      return null;
    }

    return frame;
  }

  function serialize(value: unknown): string | null {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  function frameOrigin(frame: HTMLIFrameElement): string | null {
    try {
      const url = new URL(frame.src);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

      return url.origin;
    } catch {
      return null;
    }
  }

  function sync(): void {
    const frame = readPreviewFrame();
    const state = frame ? readFormState() : null;

    if (!frame || !state) {
      currentForm = null;
      previousFrame = null;
      previousSignature = null;
      return;
    }

    const targetOrigin = frameOrigin(frame);
    if (!targetOrigin) return;
    const serializedState = serialize({ type: MESSAGE_TYPE, ...state });
    if (serializedState === null) return;
    const signature = `${frame.src}\u0000${serializedState}`;

    if (frame === previousFrame && signature === previousSignature) return;

    frame.contentWindow?.postMessage(JSON.parse(serializedState), targetOrigin);
    previousFrame = frame;
    previousSignature = signature;
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type !== READY_MESSAGE_TYPE) return;

    const frame = readPreviewFrame();

    if (!frame || event.source !== frame.contentWindow) return;

    const targetOrigin = frameOrigin(frame);

    if (!targetOrigin || event.origin !== targetOrigin) return;

    previousSignature = null;
    sync();
  });

  window.setInterval(sync, pollIntervalMs);
}
