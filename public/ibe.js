import { bls12_381 as curve } from "./vendor/curves/bls12-381.js";
import { sha256, sha512 } from "./vendor/hashes/sha2.js";
import { bytesToHex, hexToBytes, concatBytes } from "./vendor/hashes/utils.js";

const utf8 = new TextEncoder();
const order = curve.fields.Fr.ORDER;
const identityDomain = "DISPATCH_V1_BLS12381G1_XMD:SHA-256_SSWU_RO_";
const xor = (left, right) =>
  Uint8Array.from(left, (value, index) => value ^ right[index]);
const digest = (label, ...parts) =>
  sha256(concatBytes(utf8.encode("Dispatch-v1/" + label + "\0"), ...parts));
export const hex = bytesToHex;
export const bytes = hexToBytes;
export const random = (length) =>
  crypto.getRandomValues(new Uint8Array(length));
export const fingerprint = (value) => hex(sha256(utf8.encode(value)));
export function scalar(input) {
  return (BigInt("0x" + hex(sha512(input))) % (order - 1n)) + 1n;
}
function identityPoint(identity) {
  return curve.G1.hashToCurve(utf8.encode(identity), { DST: identityDomain });
}
export function publicParameters(secret) {
  return curve.G2.Point.BASE.multiply(secret).toHex();
}
export function extractKey(secret, identity) {
  return identityPoint(identity).multiply(secret).toHex();
}
function pairingMask(g1, g2) {
  const pairing = curve.pairing(g1, g2);
  return digest("pairing", curve.fields.Fp12.toBytes(pairing));
}
function exponent(seed, key) {
  return scalar(concatBytes(utf8.encode("Dispatch-v1/exponent\0"), seed, key));
}
export async function seal(publicKey, identity, text) {
  const seed = random(32);
  const key = random(32);
  const r = exponent(seed, key);
  const u = curve.G2.Point.BASE.multiply(r).toHex();
  const publicPoint = curve.G2.Point.fromHex(publicKey);
  const mask = pairingMask(identityPoint(identity).multiply(r), publicPoint);
  const iv = random(12);
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "encrypt",
  ]);
  const body = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8.encode(identity) },
    aes,
    utf8.encode(text),
  );
  return {
    u,
    v: hex(xor(seed, mask)),
    w: hex(xor(key, digest("seed", seed))),
    iv: hex(iv),
    body: hex(new Uint8Array(body)),
  };
}
export async function unseal(privateKey, identity, envelope) {
  const point = curve.G2.Point.fromHex(envelope.u);
  const mask = pairingMask(curve.G1.Point.fromHex(privateKey), point);
  const seed = xor(bytes(envelope.v), mask);
  const key = xor(bytes(envelope.w), digest("seed", seed));
  if (!curve.G2.Point.BASE.multiply(exponent(seed, key)).equals(point))
    throw Error("Key does not match this envelope.");
  const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
    "decrypt",
  ]);
  const result = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes(envelope.iv),
      additionalData: utf8.encode(identity),
    },
    aes,
    bytes(envelope.body),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(result);
}
export function validateEnvelope(e) {
  if (
    !e ||
    typeof e !== "object" ||
    Object.keys(e).sort().join(",") !== "body,iv,u,v,w"
  )
    return false;
  for (const [name, len] of Object.entries({ u: 192, v: 64, w: 64, iv: 24 })) {
    if (
      typeof e[name] !== "string" ||
      e[name].length !== len ||
      !/^[0-9a-f]+$/.test(e[name])
    )
      return false;
  }
  if (typeof e.body !== "string" || !/^(?:[0-9a-f]{2}){17,8208}$/.test(e.body))
    return false;
  try {
    return !curve.G2.Point.fromHex(e.u).is0();
  } catch {
    return false;
  }
}
