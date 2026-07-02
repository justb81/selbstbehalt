// SPDX-License-Identifier: Apache-2.0
/**
 * Web Share Target (issue #158): sharing a PDF from another app POSTs
 * `multipart/form-data` to the manifest's `share_target.action`
 * (`/share-target`). `adapter-static` has no server route to receive it, so
 * the service worker intercepts the POST (see `service-worker.ts`), stores
 * the file here, and redirects the navigation to `/invoices/new?share=<id>`;
 * the page then calls {@link consumeSharedFile} with the same id to pick it
 * up and feeds it straight into the OCR scanner.
 *
 * Kept free of `ServiceWorkerGlobalScope`/`CacheStorage` globals (only a
 * minimal cache interface is used) so both directions are unit-testable with
 * a fake cache, mirroring `./strategies.ts`.
 *
 * The file never touches the network or IndexedDB — it round-trips through
 * Cache Storage only, and is deleted as soon as the client consumes it
 * (docs/design.md §1.3/§8: invoice files never leave the device).
 */

/** Manifest `share_target.action` path the service worker intercepts. */
export const SHARE_TARGET_PATH = '/share-target';
/** Dedicated Cache Storage bucket the shared file round-trips through. */
export const SHARE_CACHE_NAME = 'share-target-files';
/** Form field name the manifest's `share_target.params.files` declares. */
const SHARE_FIELD_NAME = 'pdf';

function shareCacheKey(id: string): string {
  return `https://share-target.invalid/${id}`;
}

/** The slice of the Cache API this module needs (so tests can fake it). */
export interface ShareCacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string): Promise<boolean>;
}

/** The slice of `Request` this module needs — just enough to be fakeable in tests. */
export interface ShareRequestLike {
  formData(): Promise<FormData>;
}

/**
 * SW side: extract the shared PDF from the share-target POST body and store
 * it under a fresh one-time id. Returns the id to redirect the client to.
 */
export async function storeSharedFile(
  request: ShareRequestLike,
  cache: ShareCacheLike,
  newId: () => string = () => crypto.randomUUID(),
): Promise<string> {
  const formData = await request.formData();
  const file = formData.get(SHARE_FIELD_NAME);
  // Per the FormData spec a file field is either `null` (absent) or a
  // `File`/`Blob`, never a string — checked this way (rather than
  // `instanceof Blob`) because `fetch`'s multipart parser and the test/SW
  // globals can construct `Blob`s from different realms.
  if (file === null || typeof file === 'string') {
    throw new Error('Share-Target-Request enthält keine Datei.');
  }
  const id = newId();
  // Store the raw bytes, not the Blob/File itself: `Response` requires its
  // body to implement `.stream()`, which a `Blob`/`File` from a different
  // realm than the global `Response` (e.g. jsdom's File vs. undici's
  // Response in tests) does not.
  const buffer = await file.arrayBuffer();
  await cache.put(
    shareCacheKey(id),
    new Response(buffer, { headers: { 'Content-Type': file.type || 'application/pdf' } }),
  );
  return id;
}

/**
 * Client side: retrieve and remove a previously stored shared file. Returns
 * `null` if the id is unknown (already consumed, or the SW never stored it).
 */
export async function consumeSharedFile(id: string, cache: ShareCacheLike): Promise<File | null> {
  const key = shareCacheKey(id);
  const response = await cache.match(key);
  if (!response) return null;
  await cache.delete(key);
  // Read via arrayBuffer(), not blob(): the SW/browser and this module can be
  // handed different `Blob`/`File` realms (e.g. in tests), and wrapping a
  // foreign-realm Blob directly in `new File([blob], ...)` silently stringifies
  // it instead of copying its bytes. ArrayBuffer has no such split.
  const buffer = await response.arrayBuffer();
  const type = response.headers.get('Content-Type') || 'application/pdf';
  return new File([buffer], 'geteilte-rechnung.pdf', { type });
}
