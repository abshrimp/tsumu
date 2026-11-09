/** SHA-1 of a Git blob ("blob <length>\0" + content), shared by GitHub and GitLab publishing. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const prefix = new TextEncoder().encode("blob " + bytes.length + "\0");
  const data = new Uint8Array(prefix.length + bytes.length);
  data.set(prefix);
  data.set(bytes, prefix.length);
  const digest = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
