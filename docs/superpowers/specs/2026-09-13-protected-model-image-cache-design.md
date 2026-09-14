# Protected model image cache design

## Problem

Model images are served by the authenticated `/api/files/...` route. On Android, React Native's native `Image` pipeline receives a source containing an `Authorization` header but sends the request without that header. The server correctly returns `401`, leaving the model list cover and detail gallery blank. A direct `fetch` with the same URL and header returns `200`.

## Chosen approach

Add a shared protected-image component backed by an authenticated local cache. The component will be used by both `ModelsScreen` and `ModelDetailScreen`.

- Native: download the image with `expo-file-system/legacy` and the bearer header into `FileSystem.cacheDirectory`, then render the resulting `file://` URI.
- Web: fetch with the bearer header, create a temporary object URL, render it, and revoke it when the component unmounts or its source changes.
- Keep `/api/files/...` protected. Tokens must never be added to query strings, filenames, logs, or persisted cache metadata.

## Cache identity and lifecycle

Native cache filenames will be deterministic hashes of the server key, session epoch, and resolved image URL. Concurrent requests in the same session for the same cache key will share one in-flight download. The server key prevents collisions across servers, while the session epoch prevents an invalidated user's late download from colliding with the next user's cache; image URLs are unique for uploaded revisions.

Every downloaded native image is registered through the existing `trackSessionFile(serverKey, uri)` mechanism. Existing session cleanup already deletes registered cache files when the user logs out or changes/removes the configured server, including retry-on-next-start behavior after interrupted cleanup.

To cover an expired session followed by login as a different user on the same server, a successful sign-in will clear previously tracked cache files before exposing the new authenticated user. This purge affects only app-owned cache files validated by `isAppCacheFile`; it does not delete user documents or server data. Web object URLs are memory-only and are revoked on source/session change.

The loader captures the current server runtime before work starts. If the runtime changes before the download finishes, it deletes the result and reports a stale-session outcome rather than displaying data from the previous server or user.

## Component states and errors

The shared component accepts the same layout props needed by the two screens plus a fallback element.

- While downloading, it shows the existing tinted placeholder/fallback.
- After a successful authenticated download, it renders the local image.
- On `401` or another download/decode failure, it keeps the fallback visible and may report the failure through `onError`; it does not expose the bearer token.
- When the source changes, stale async completion cannot replace the newer image.

## Verification

1. Reproduce the original Android failure against the real protected image route and retain the `401` result as the red signal.
2. Add loader tests with mocked file-system/network/session dependencies covering bearer headers, cache hits, concurrent deduplication, stale-session deletion, and failed-download cleanup.
3. Add lifecycle coverage proving successful sign-in clears tracked files for the current server, while existing logout and server-switch cleanup continues to pass.
4. Verify on Android that the model-list cover and both detail-gallery images render, then navigate away/back to exercise cache hits.
5. Run client verification and a fresh Expo web export. Remove all temporary `[DEBUG-model-image]` instrumentation before completion.

## Non-goals

- Making protected model assets public.
- Adding signed-URL infrastructure.
- Persisting an unbounded media library outside the operating system cache directory.
