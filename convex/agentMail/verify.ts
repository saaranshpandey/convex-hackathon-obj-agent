/**
 * AgentMail signs webhooks with Svix (svix-id / svix-timestamp / svix-signature
 * headers, HMAC-SHA256 over "{id}.{timestamp}.{body}", secret prefixed
 * "whsec_"). Implemented from scratch with Web Crypto — no svix dependency,
 * and Convex's default runtime already has crypto.subtle without "use node".
 */

const TOLERANCE_MS = 5 * 60 * 1000;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Base64(secretBytes: Uint8Array, content: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifySvixSignature(input: {
  secret: string;
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
  body: string;
}): Promise<boolean> {
  const timestampSeconds = Number(input.svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Date.now() - timestampSeconds * 1000) > TOLERANCE_MS) return false;

  const secretBase64 = input.secret.startsWith("whsec_") ? input.secret.slice(6) : input.secret;
  const secretBytes = base64ToBytes(secretBase64);
  const signedContent = `${input.svixId}.${input.svixTimestamp}.${input.body}`;
  const expected = await hmacSha256Base64(secretBytes, signedContent);

  for (const candidate of input.svixSignature.split(" ")) {
    const [version, value] = candidate.split(",");
    if (version === "v1" && value && timingSafeEqual(value, expected)) return true;
  }
  return false;
}
