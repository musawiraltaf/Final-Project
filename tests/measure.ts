import {
  seal,
  unseal,
  random,
  scalar,
  extractKey,
  publicParameters,
} from "../public/ibe.js";
const secret = scalar(random(64));
const identity = JSON.stringify([
  "dispatch-v1",
  "measurement",
  "alice@company.local",
  1,
]);
const pub = publicParameters(secret),
  key = extractKey(secret, identity);
const results = [];
for (const size of [32, 512, 2048]) {
  const text = "A".repeat(size);
  const enc: number[] = [],
    dec: number[] = [];
  let wire = 0;
  for (let i = 0; i < 11; i++) {
    let start = performance.now();
    const e = await seal(pub, identity, text);
    const sealed = performance.now() - start;
    start = performance.now();
    if ((await unseal(key, identity, e)) !== text)
      throw Error("Round trip failed");
    const opened = performance.now() - start;
    if (i) {
      enc.push(sealed);
      dec.push(opened);
    }
    wire = Buffer.byteLength(JSON.stringify(e));
  }
  const median = (a: number[]) => {
    a.sort((l, r) => l - r);
    return ((a[4] + a[5]) / 2).toFixed(1);
  };
  results.push({
    plaintextBytes: size,
    envelopeBytes: wire,
    encryptMs: median(enc),
    decryptMs: median(dec),
  });
}
console.log(JSON.stringify(results, null, 2));
