# Contributing

Bug reports and focused pull requests are welcome. For behavior changes, open an
issue first so the protocol and Directus compatibility can be discussed before
implementation.

## Local checks

Use Node.js 22 or later, then run:

```sh
npm install
npm run check
```

Keep commits in the [Conventional Commits](https://www.conventionalcommits.org/)
format. Release Please uses those commit types to prepare the changelog and
version bump.

Do not include Directus credentials, project URLs, preview content, or customer
data in issues, fixtures, screenshots, or test output.
