# Security policy

Please do not report security problems in a public issue. Send a
[private vulnerability report](https://github.com/ritsa-tech/directus-live-preview-bridge/security/advisories/new)
through GitHub.

Include the affected version, a minimal reproduction, and the impact you
observed. Remove tokens, project URLs, and content from the report unless they
are required to reproduce the problem.

Only the latest released version receives security fixes.

## Development dependency audit

`npm audit` may report `unhead` vulnerabilities through this development-only
dependency path:

```text
@directus/extensions-sdk
└─ @directus/themes
   └─ @unhead/vue
      └─ unhead
```

The advisories cover HTML sanitization bypasses in Unhead APIs such as
`useHeadSafe`. This project does not import Unhead or call those APIs. The
Directus SDK is a development dependency used to type-check and build the
extension. npm does not install a package's development dependencies for its
consumers, and the compiled `dist/` files do not contain Unhead.

Use these commands to check the distinction:

```sh
npm audit
npm audit --omit=dev
npm pack --dry-run --ignore-scripts
```

The complete development tree currently reports the upstream advisory, while the
production audit reports no vulnerabilities. npm's automated fix proposes
downgrading `@directus/extensions-sdk` from version 18 to version 15. That
downgrade is not suitable for this Directus 12 package. Dependabot tracks the
SDK, so the dependency path can be updated when Directus publishes a compatible
fix.

Reassess this conclusion if `unhead`, `@unhead/vue`, or `@directus/themes` ever
moves into `dependencies` or appears in the built package.
