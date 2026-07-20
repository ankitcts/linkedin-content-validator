// SHA-256 hex digest, used as the content-cache key so identical post text is
// only scored / fact-checked once. Uses the WebCrypto API available in the
// Vercel Node runtime.
import { webcrypto } from 'node:crypto';

export async function sha256(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
