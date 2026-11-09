/** Check original, immutable resource bytes before rewriting them during one import or export. */
export function createIntegrityVerifier() {
  const digests = new WeakMap<Uint8Array<ArrayBuffer>, Map<number, string>>();
  return async (bytes: Uint8Array<ArrayBuffer>, metadata: string) => {
    if (metadata.length > 65536) throw new Error("Resource integrity metadata exceeds the size limit.");
    if (!metadata.trim()) return;
    const hashes = metadata.trim().split(/\s+/).map(token =>
      /^sha(256|384|512)-([A-Za-z0-9+/=_-]+)(?:\?.*)?$/.exec(token)).filter(hash => hash !== null);
    const strongest = hashes.reduce((best, hash) => Math.max(best, Number(hash[1])), 0);
    if (hashes.length && globalThis.crypto?.subtle) {
      const cached = digests.get(bytes) ?? new Map<number, string>();
      let expected = cached.get(strongest);
      if (expected === undefined) {
        const digest = await crypto.subtle.digest("SHA-" + strongest, bytes);
        expected = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/=+$/, "");
        cached.set(strongest, expected);
        digests.set(bytes, cached);
      }
      if (hashes.some(hash => Number(hash[1]) === strongest &&
          hash[2].replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "") === expected)) return;
    }
    throw new Error("Cannot embed resource: integrity metadata could not be verified.");
  };
}
