/** ZIP-173 Sapling testnet decoder. Deliberately fail closed for unsupported address
 * types (including Unified Addresses), rather than treating a prefix as validation.
 * Validates Bech32 checksum, HRP, padding and the exact 43-byte receiver length.
 * This is encoding validation, not proof that anyone controls the receiving key.
 */
const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
export function isSaplingTestnetAddress(address: string): boolean {
  if (address !== address.toLowerCase() || address.length !== 88) return false;
  const separator = address.lastIndexOf("1");
  const hrp = address.slice(0, separator);
  if (hrp !== "ztestsapling") return false;
  const words = [...address.slice(separator + 1)].map((char) => ALPHABET.indexOf(char));
  if (words.some((word) => word < 0)) return false;
  const values = [...hrp].map((c) => c.charCodeAt(0) >> 5)
    .concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31), words);
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) checksum ^= GENERATORS[i];
  }
  if (checksum !== 1) return false;
  let accumulator = 0, bits = 0, bytes = 0;
  for (const word of words.slice(0, -6)) {
    accumulator = ((accumulator << 5) | word) & 0xffff;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes++; }
  }
  return bytes === 43 && bits < 5 && ((accumulator << (8 - bits)) & 255) === 0;
}
