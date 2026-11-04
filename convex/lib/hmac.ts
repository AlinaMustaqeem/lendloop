const encoder = new TextEncoder();

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function canonicalMessage(
  timestamp: string,
  method: string,
  path: string,
  rawBody: string,
) {
  return `${timestamp}.${method.toUpperCase()}.${path}.${rawBody}`;
}

export async function signMessage(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
}

export async function verifyMessage(secret: string, message: string, signature: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = new Uint8Array(
    signature.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)),
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(message));
}
