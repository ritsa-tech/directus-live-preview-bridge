# Use the bridge with Next.js Draft Mode

This example uses the Next.js App Router and its async request APIs. It matches
Next.js 15 and 16, where `draftMode()` returns a promise. The example collection
is `articles`, with `id`, `status`, `title`, and `body` fields.

Draft Mode and this bridge solve different parts of previewing:

| Part                 | Responsibility                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Directus item status | Determines whether a saved item is a draft or published.                                                                   |
| Next.js Draft Mode   | Sets a browser cookie so Next.js renders the request using draft-aware data fetching instead of a cached published result. |
| Live Preview bridge  | Sends the values currently typed in the Directus form, including changes that have not been saved.                         |

The request flow is straightforward. Directus opens a protected Next.js route
inside its Live Preview iframe. That route validates the request, enables Draft
Mode, and redirects to the article page. The Server Component fetches the saved
draft as its initial value. After hydration, the client component receives
unsaved form edits from the bridge and merges the supported fields into React
state.

Next.js documents the Draft Mode cookie and async API in its
[Draft Mode guide](https://nextjs.org/docs/app/guides/draft-mode). Directus
documents the collection Preview URL in its
[Live Preview guide](https://directus.io/docs/tutorials/getting-started/set-up-live-preview-with-next-js).

## 1. Configure environment variables

Add these values to the Next.js project:

```env
# Available to the client. This is an origin, not an API token.
NEXT_PUBLIC_DIRECTUS_URL=https://directus.example.com

# Server-only token with read access to the fields used by the preview.
DIRECTUS_SERVER_TOKEN=replace-with-a-limited-read-token

# Shared by the Next.js preview route and the Directus Preview URL.
DIRECTUS_PREVIEW_SECRET=replace-with-a-long-random-value
```

Keep `DIRECTUS_SERVER_TOKEN` and `DIRECTUS_PREVIEW_SECRET` out of variables with
the `NEXT_PUBLIC_` prefix. The browser does not need either secret. Give the
Directus token read access only to the collections and fields the preview uses.

## 2. Fetch saved Directus data on the server

Create `lib/directus.ts`. This helper fetches the saved draft while Draft Mode
is enabled. Normal visitors only receive items whose status is `published`.

```ts
export type Article = {
  id: string;
  status: 'draft' | 'published' | 'archived';
  title: string;
  body: string;
};

type DirectusListResponse<T> = {
  data: T[];
};

const directusUrl = process.env.NEXT_PUBLIC_DIRECTUS_URL;
const directusToken = process.env.DIRECTUS_SERVER_TOKEN;

if (!directusUrl || !directusToken) {
  throw new Error(
    'NEXT_PUBLIC_DIRECTUS_URL and DIRECTUS_SERVER_TOKEN are required.',
  );
}

export async function getArticle(
  id: string,
  includeDrafts: boolean,
): Promise<Article | null> {
  const baseUrl = directusUrl.endsWith('/') ? directusUrl : `${directusUrl}/`;
  const url = new URL('items/articles', baseUrl);
  const filter = {
    id: { _eq: id },
    ...(includeDrafts ? {} : { status: { _eq: 'published' } }),
  };

  url.searchParams.set('filter', JSON.stringify(filter));
  url.searchParams.set('fields', 'id,status,title,body');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${directusToken}`,
    },
    ...(includeDrafts
      ? { cache: 'no-store' as const }
      : { next: { revalidate: 60 } }),
  });

  if (!response.ok) {
    throw new Error(`Directus returned ${response.status}.`);
  }

  const result = (await response.json()) as DirectusListResponse<Article>;
  return result.data[0] ?? null;
}
```

The `no-store` branch is deliberate. Draft requests should not share a cached
response with another request. Change the published revalidation interval to
match the site's normal caching policy. Adjust the status names and fields if
the Directus collection uses different values. Keep any Directus reverse-proxy
path in `NEXT_PUBLIC_DIRECTUS_URL`; the URL construction above preserves it.

## 3. Enable Draft Mode through a protected route

Create `app/api/draft/route.ts`:

```ts
import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';

import { getArticle } from '@/lib/directus';

const VALID_ID = /^[A-Za-z0-9_-]+$/;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const id = searchParams.get('id');

  if (
    !process.env.DIRECTUS_PREVIEW_SECRET ||
    secret !== process.env.DIRECTUS_PREVIEW_SECRET
  ) {
    return new Response('Invalid preview secret.', { status: 401 });
  }

  if (!id || !VALID_ID.test(id)) {
    return new Response('Invalid article ID.', { status: 400 });
  }

  const article = await getArticle(id, true);

  if (!article) {
    return new Response('Article not found.', { status: 404 });
  }

  const draft = await draftMode();
  draft.enable();

  redirect(`/articles/${encodeURIComponent(article.id)}`);
}
```

The route checks that the item exists before setting the Draft Mode cookie. It
also constructs the redirect from the verified item instead of redirecting to an
arbitrary query parameter. That avoids turning the route into an open redirect.

The cookie is named `__prerender_bypass`. Next.js generates a new value for each
build, so a deployment invalidates older Draft Mode cookies. Draft Mode does not
grant Directus access by itself. The server-only Directus token still controls
which saved records the page can fetch.

## 4. Configure the Directus Preview URL

In Directus, open **Settings > Data Model > Articles** and set the Preview URL
to this pattern:

```text
https://frontend.example.com/api/draft?secret=YOUR_SECRET&id=ID
```

Use the Directus field picker to insert the `ID` field after `id=`. Replace
`YOUR_SECRET` with the same value as `DIRECTUS_PREVIEW_SECRET`. Use HTTPS
outside local development because the secret is part of the URL.

When an editor opens Live Preview, Directus loads this URL in its iframe. The
route sets the cookie and redirects the iframe to `/articles/<id>`.

If the Next.js application sends a Content Security Policy, its
`frame-ancestors` directive must allow the Directus origin. Remove conflicting
`X-Frame-Options: SAMEORIGIN` headers. Otherwise the browser will refuse to
render the site inside Directus.

## 5. Read Draft Mode in the page

Create `app/articles/[id]/page.tsx`:

```tsx
import { draftMode } from 'next/headers';
import { notFound } from 'next/navigation';

import { ArticlePreview } from '@/components/article-preview';
import { getArticle } from '@/lib/directus';

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, { isEnabled }] = await Promise.all([params, draftMode()]);
  const article = await getArticle(id, isEnabled);

  if (!article) notFound();

  const directusUrl = process.env.NEXT_PUBLIC_DIRECTUS_URL;

  if (!directusUrl) {
    throw new Error('NEXT_PUBLIC_DIRECTUS_URL is required.');
  }

  return (
    <ArticlePreview
      key={article.id}
      initialArticle={article}
      directusUrl={directusUrl}
      livePreviewEnabled={isEnabled}
    />
  );
}
```

`draftMode()` is async in current Next.js releases. The page starts `params` and
`draftMode()` together to avoid waiting for them one at a time. The item fetch
begins after both values are available because it needs the ID and the Draft
Mode state.

## 6. Apply unsaved edits in a client component

Create `components/article-preview.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';

import type { Article } from '@/lib/directus';

const EDITS_MESSAGE_TYPE = 'directus-live-preview-bridge:edits';
const READY_MESSAGE_TYPE = 'directus-live-preview-bridge:ready';
const ALLOWED_COLLECTIONS = new Set(['articles']);

type LivePreviewMessage = {
  type: typeof EDITS_MESSAGE_TYPE;
  collection: string;
  primaryKey: unknown;
  edits: Record<string, unknown>;
};

function useDirectusLivePreview({
  directusUrl,
  enabled,
  onEdits,
}: {
  directusUrl: string;
  enabled: boolean;
  onEdits: (message: LivePreviewMessage) => void;
}) {
  const onEditsRef = useRef(onEdits);

  useEffect(() => {
    onEditsRef.current = onEdits;
  }, [onEdits]);

  useEffect(() => {
    if (!enabled || window.parent === window) return;

    const directusOrigin = new URL(directusUrl).origin;

    function receiveEdits(event: MessageEvent) {
      if (event.origin !== directusOrigin || event.source !== window.parent) {
        return;
      }

      const message = event.data;

      if (
        !message ||
        message.type !== EDITS_MESSAGE_TYPE ||
        typeof message.collection !== 'string' ||
        !ALLOWED_COLLECTIONS.has(message.collection) ||
        typeof message.edits !== 'object' ||
        message.edits === null ||
        Array.isArray(message.edits)
      ) {
        return;
      }

      onEditsRef.current(message);
    }

    window.addEventListener('message', receiveEdits);
    window.parent.postMessage({ type: READY_MESSAGE_TYPE }, directusOrigin);

    return () => window.removeEventListener('message', receiveEdits);
  }, [directusUrl, enabled]);
}

export function ArticlePreview({
  initialArticle,
  directusUrl,
  livePreviewEnabled,
}: {
  initialArticle: Article;
  directusUrl: string;
  livePreviewEnabled: boolean;
}) {
  const [article, setArticle] = useState(initialArticle);

  useDirectusLivePreview({
    directusUrl,
    enabled: livePreviewEnabled,
    onEdits(message) {
      if (
        message.collection !== 'articles' ||
        String(message.primaryKey) !== String(initialArticle.id)
      ) {
        return;
      }

      setArticle((current) => ({
        ...current,
        title:
          typeof message.edits.title === 'string'
            ? message.edits.title
            : current.title,
        body:
          typeof message.edits.body === 'string'
            ? message.edits.body
            : current.body,
      }));
    },
  });

  return (
    <main>
      <h1>{article.title}</h1>
      <p>{article.body}</p>
    </main>
  );
}
```

The effect installs one global listener and removes it during cleanup. The
callback ref lets React use the latest edit handler without removing and adding
the window listener after every render. The merge names the fields it accepts
instead of spreading an untrusted message over the whole article.

Keep the listener in one client component near the preview page root. If many
descendants need the edited article, put the state in a React context provider
and keep this same single listener in the provider.

## 7. Add an optional exit route

Draft Mode lasts until its cookie is cleared or the browser session ends. To
provide an explicit exit, create `app/api/draft/disable/route.ts`:

```ts
import { draftMode } from 'next/headers';
import { redirect } from 'next/navigation';

export async function GET() {
  const draft = await draftMode();
  draft.disable();
  redirect('/');
}
```

Link to `/api/draft/disable` with a normal anchor. If `next/link` is used, set
`prefetch={false}` so prefetching cannot clear Draft Mode before the editor
clicks the link.

## Cookies inside the Directus iframe

Draft Mode relies on a browser cookie. A Directus instance and preview site on
different sites can trigger third-party cookie restrictions because the Next.js
page runs inside a Directus iframe. For local HTTP testing, Next.js explicitly
requires third-party cookies and storage access to be allowed. If the cookie is
blocked, host Directus and the preview site under the same parent site or adjust
the browser policy used by editors.

You can confirm Draft Mode is active by inspecting the iframe request for the
`__prerender_bypass` cookie. You can confirm the bridge separately by watching
for `directus-live-preview-bridge:ready` and
`directus-live-preview-bridge:edits` messages in the browser developer tools.
