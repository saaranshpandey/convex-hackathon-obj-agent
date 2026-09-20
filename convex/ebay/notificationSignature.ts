function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** eBay's handshake: SHA-256 (hex) of the challenge code, verification token and endpoint URL. */
export async function challengeResponse(
  challengeCode: string,
  verificationToken: string,
  endpoint: string,
): Promise<string> {
  const data = new TextEncoder().encode(challengeCode + verificationToken + endpoint);
  return toHex(await crypto.subtle.digest("SHA-256", data as BufferSource));
}

/** The `X-EBAY-SIGNATURE` header is base64 JSON carrying the key ID and the signature. */
export function decodeSignatureHeader(
  header: string | null | undefined,
): { kid: string; signature: string } | null {
  if (!header) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64(header))) as {
      kid?: unknown;
      signature?: unknown;
    };
    if (typeof parsed.kid !== "string" || typeof parsed.signature !== "string") return null;
    return { kid: parsed.kid, signature: parsed.signature };
  } catch {
    return null;
  }
}

function pemToDer(pem: string): Uint8Array {
  return fromBase64(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
}

/** eBay signs with DER-encoded ECDSA (SEQUENCE { INTEGER r, INTEGER s }); WebCrypto wants raw r||s. */
function derToRaw(der: Uint8Array, size: number): Uint8Array {
  let offset = 2;
  if ((der[1] & 0x80) !== 0) offset += der[1] & 0x7f;

  const readInteger = (): Uint8Array => {
    offset += 1;
    const length = der[offset];
    offset += 1;
    let value = der.slice(offset, offset + length);
    offset += length;
    while (value.length > size && value[0] === 0) value = value.slice(1);
    const padded = new Uint8Array(size);
    padded.set(value, size - value.length);
    return padded;
  };

  const r = readInteger();
  const s = readInteger();
  const raw = new Uint8Array(size * 2);
  raw.set(r, 0);
  raw.set(s, size);
  return raw;
}

/** eBay only signs with ECDSA over SHA-1, on the P-256 curve. */
export async function verifyEbaySignature(input: {
  publicKeyPem: string;
  body: string;
  signature: string;
}): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(input.publicKeyPem) as BufferSource,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const raw = derToRaw(fromBase64(input.signature), 32);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-1" },
      key,
      raw as BufferSource,
      new TextEncoder().encode(input.body) as BufferSource,
    );
  } catch {
    return false;
  }
}

export function readDeletedUserId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      metadata?: { topic?: unknown };
      notification?: { data?: { userId?: unknown } };
    };
    if (parsed.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION") return null;
    const userId = parsed.notification?.data?.userId;
    return typeof userId === "string" && userId !== "" ? userId : null;
  } catch {
    return null;
  }
}
