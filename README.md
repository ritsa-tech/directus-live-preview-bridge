# Directus Live Preview bridge

`directus-live-preview-bridge` sends unsaved item edits from the Directus Data
Studio to the page open in Live Preview. It does not save content or call the
Directus API.

The package is one Directus bundle with two parts. A hook adds a deferred
same-origin script tag to the Data Studio, and an endpoint serves the script at
`/live-preview-bridge/script.js`. Keeping the executable code in an external
same-origin response works with the Data Studio's Content Security Policy.

## Requirements

- Directus 12
- Node.js 22 or later
- A frontend that handles the bridge protocol described below

The bundle uses Directus' server-side `embed` hook. Directus does not expose
that hook to sandboxed extensions, so this package runs as an unsandboxed API
extension. Review the source before installing it in a production project.

## Install

Install the package alongside Directus:

```sh
pnpm add directus-live-preview-bridge
```

For a custom Directus Docker image:

```dockerfile
FROM directus/directus:12.3.1

USER root
RUN corepack enable
USER node

RUN pnpm add directus-live-preview-bridge
```

You can also build this repository and copy `package.json` plus `dist/` into
`extensions/directus-live-preview-bridge/`. Restart Directus after installing
the bundle.

### Marketplace installs

The npm package contains the metadata required by the Directus Marketplace.
Because the bundle is unsandboxed, Directus hides it under the default
`MARKETPLACE_TRUST=sandbox` setting. Self-hosted and Enterprise Cloud projects
must set `MARKETPLACE_TRUST=all` before installing it from the Marketplace.

## Connect a preview frontend

The bridge posts this payload to the current Live Preview iframe:

```ts
type LivePreviewEditsMessage = {
  type: 'directus-live-preview-bridge:edits';
  collection: string;
  primaryKey: unknown;
  edits: Record<string, unknown>;
};
```

The target origin comes from the iframe URL. The bridge never uses `*` as the
`postMessage` target.

Register the listener before telling the Data Studio that the preview is ready:

```ts
const EDITS_MESSAGE_TYPE = 'directus-live-preview-bridge:edits';
const READY_MESSAGE_TYPE = 'directus-live-preview-bridge:ready';

export function connectDirectusLivePreview(
  directusUrl: string,
  allowedCollections: ReadonlySet<string>,
  applyEdits: (message: {
    collection: string;
    primaryKey: unknown;
    edits: Record<string, unknown>;
  }) => void,
) {
  const directusOrigin = new URL(directusUrl).origin;

  function receiveEdits(event: MessageEvent) {
    if (event.origin !== directusOrigin || event.source !== window.parent)
      return;

    const message = event.data;

    if (
      !message ||
      message.type !== EDITS_MESSAGE_TYPE ||
      typeof message.collection !== 'string' ||
      !allowedCollections.has(message.collection) ||
      typeof message.edits !== 'object' ||
      message.edits === null ||
      Array.isArray(message.edits)
    ) {
      return;
    }

    applyEdits(message);
  }

  window.addEventListener('message', receiveEdits);
  window.parent.postMessage({ type: READY_MESSAGE_TYPE }, directusOrigin);

  return () => window.removeEventListener('message', receiveEdits);
}
```

Validate the collection and item in your application before merging `edits` into
rendered data. Treat every cross-window message as untrusted input, even when
its origin is expected.

The ready message matters. The Data Studio may send its first update before the
preview application has mounted. On receipt, the bridge replays the latest
state.

### Next.js App Router example

The [Next.js guide](docs/nextjs.md) shows a complete Directus 12 and Next.js App
Router setup. It covers Draft Mode, a protected preview route, server-side
Directus fetching, a React client component that applies unsaved edits, and an
optional route for leaving Draft Mode.

## Configuration

The defaults work when Directus is served from the root of its origin.

| Environment variable                   | Default                          | Purpose                                                                                                                               |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `LIVE_PREVIEW_BRIDGE_SCRIPT_PATH`      | `/live-preview-bridge/script.js` | Root-relative endpoint path inserted into the Data Studio. Set this when a reverse proxy serves Directus below a path such as `/cms`. |
| `LIVE_PREVIEW_BRIDGE_POLL_INTERVAL_MS` | `120`                            | How often the bridge reads staged form state. Accepted values are integers from `50` through `5000`.                                  |

For a Directus instance served at `https://example.com/cms`, use:

```env
LIVE_PREVIEW_BRIDGE_SCRIPT_PATH=/cms/live-preview-bridge/script.js
```

The script path only accepts a same-origin, root-relative URL. Invalid values
fall back to the default and produce a warning in the Directus log.

## How edit capture works

Directus 12 does not provide a public client API for reading the staged item
form. The bridge first reads the current form's Vue props. It also listens for
`input` and `change` events on fields with Directus' `data-collection` and
`data-field` attributes. The event listener is a fallback for fields whose Vue
state is not available during a render.

This dependency on Data Studio internals is why the package targets Directus 12
explicitly. Run the test suite against a Directus upgrade before rolling it out.

The bridge serializes edits through JSON before posting them. Circular values
are skipped, and repeated payloads are not sent again unless the iframe reports
that it is ready.

## Development

```sh
npm install
npm run check
```

`npm run check` type-checks the source, runs the tests, checks formatting,
builds the bundle, and validates the Directus manifest. Use `npm run dev` for a
watch build or `npm run link` to link the package into a local Directus
extensions directory.

The full development dependency audit currently reports an upstream `unhead`
advisory through the Directus SDK. It is not included in the compiled extension
or installed by package consumers. The
[security policy](https://github.com/ritsa-tech/directus-live-preview-bridge/blob/main/SECURITY.md#development-dependency-audit)
records the dependency path and verification commands.

Releases use Conventional Commits and Release Please. The publish job uses npm
trusted publishing. npm requires the package to exist before that trust can be
configured, so maintainers must publish the initial version manually. After
that, configure `ritsa-tech/directus-live-preview-bridge` and
`.github/workflows/release-please.yml` as the trusted publisher. The publish job
uses an `npm` GitHub environment. Add required reviewers to that environment if
releases need manual approval.

## License

[MIT](LICENSE)
