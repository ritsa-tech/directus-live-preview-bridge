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
    parent?: VueComponent | null;
    props?: Record<string, unknown>;
  };
  type BridgeState = {
    collection: string;
    edits: Record<string, unknown>;
    primaryKey: unknown;
  };
  type EditableElement = HTMLElement & {
    checked?: boolean;
    selectedOptions?: Iterable<HTMLOptionElement>;
    type?: string;
    value?: string;
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
  let stagedState: BridgeState | null = null;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function readFormState(): BridgeState | null {
    for (const element of document.querySelectorAll<HTMLElement>('.v-form')) {
      let instance = (
        element as HTMLElement & { __vueParentComponent?: VueComponent }
      ).__vueParentComponent;

      while (instance) {
        const props = instance.props;

        if (
          typeof props?.collection === 'string' &&
          'modelValue' in props &&
          'initialValues' in props
        ) {
          return {
            collection: props.collection,
            edits: isRecord(props.modelValue) ? props.modelValue : {},
            primaryKey: props.primaryKey ?? null,
          };
        }

        instance = instance.parent ?? undefined;
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

  function readFieldEdit(event: Event): {
    collection: string;
    field: string;
    primaryKey: string | null;
    value: unknown;
  } | null {
    const target = event.target as EditableElement | null;

    if (!target) return null;

    const fieldRoot = target.closest(
      '[data-collection][data-field]',
    ) as HTMLElement | null;

    if (!fieldRoot) return null;

    const collection = fieldRoot.dataset.collection;
    const field = fieldRoot.dataset.field;

    if (!collection || !field) return null;

    let value: unknown;

    if (target.type === 'checkbox') {
      value = Boolean(target.checked);
    } else if (target.tagName === 'SELECT' && target.hasAttribute('multiple')) {
      value = Array.from(
        target.selectedOptions ?? [],
        (option) => option.value,
      );
    } else if ('value' in target) {
      value = target.value;

      if (target.type === 'number' && value !== '') {
        const numberValue = Number(value);

        if (Number.isFinite(numberValue)) value = numberValue;
      }
    } else if (target.isContentEditable) {
      value = target.innerHTML;
    } else {
      return null;
    }

    return {
      collection,
      field,
      primaryKey: fieldRoot.dataset.primaryKey ?? null,
      value,
    };
  }

  function captureFieldEdit(event: Event): void {
    const edit = readFieldEdit(event);

    if (!edit) return;

    if (
      stagedState?.collection !== edit.collection ||
      stagedState?.primaryKey !== edit.primaryKey
    ) {
      stagedState = {
        collection: edit.collection,
        edits: {},
        primaryKey: edit.primaryKey,
      };
    }

    stagedState.edits = {
      ...stagedState.edits,
      [edit.field]: edit.value,
    };
    previousSignature = null;
    sync();
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

  function sendEdits(
    frame: HTMLIFrameElement,
    state: BridgeState,
    serializedEdits: string,
  ): void {
    const targetOrigin = frameOrigin(frame);

    if (!targetOrigin) return;

    frame.contentWindow?.postMessage(
      {
        type: MESSAGE_TYPE,
        collection: state.collection,
        primaryKey: state.primaryKey,
        edits: JSON.parse(serializedEdits) as Record<string, unknown>,
      },
      targetOrigin,
    );
  }

  function sync(): void {
    const frame = readPreviewFrame();
    const vueState = readFormState();
    let state = vueState ?? stagedState;

    if (
      vueState &&
      stagedState?.collection === vueState.collection &&
      stagedState.primaryKey === vueState.primaryKey
    ) {
      state = {
        ...vueState,
        edits: { ...vueState.edits, ...stagedState.edits },
      };
    }

    if (!frame || !state) {
      previousFrame = null;
      previousSignature = null;
      return;
    }

    const serializedEdits = serialize(state.edits);

    if (serializedEdits === null) return;

    const signature = `${state.collection}\u0000${String(
      state.primaryKey,
    )}\u0000${serializedEdits}`;

    if (frame === previousFrame && signature === previousSignature) return;

    previousFrame = frame;
    previousSignature = signature;
    sendEdits(frame, state, serializedEdits);
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

  document.addEventListener('input', captureFieldEdit, true);
  document.addEventListener('change', captureFieldEdit, true);
  window.setInterval(sync, pollIntervalMs);
}
