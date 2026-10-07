import { createHash } from 'node:crypto';

export const SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export function proofToSolanaCompressed(proof, signals) {
  const result = proofToSolana(proof, signals);
  const compress = (hex, g2Point = false) => {
    const width = g2Point ? 128 : 64;
    const x = Buffer.from(hex.slice(0, width), 'hex');
    const y = hex.slice(width);
    const high = BigInt(`0x${y.slice(0, 64)}`);
    const negativeHigh = (BASE_FIELD - high) % BASE_FIELD;
    let negative = high > negativeHigh;
    if (g2Point && high === negativeHigh) {
      const low = BigInt(`0x${y.slice(64)}`);
      negative = low > (BASE_FIELD - low) % BASE_FIELD;
    }
    // Arkworks SWFlags: bit 7 means y > -y; Fq2 compares imaginary then real.
    if (negative) x[0] |= 0x80;
    return x.toString('hex');
  };
  return { ...result, proofA: compress(result.proofA), proofB: compress(result.proofB, true), proofC: compress(result.proofC) };
}

export function decodeBase64(value, length) {
  if (typeof value !== 'string' || value.length > 65536 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (length !== undefined && bytes.length !== length)) throw new Error('Invalid base64 length or encoding');
  return bytes;
}

export function requestBinding(requestId, ciphertext) {
  if (typeof requestId !== 'string' || !/^[0-9a-f]{32}$/.test(requestId)) throw new Error('Invalid request ID');
  const digest = createHash('sha256').update(Buffer.from(requestId, 'hex')).update(decodeBase64(ciphertext)).digest('hex');
  return String(BigInt(`0x${digest}`) % SCALAR_FIELD);
}

function fieldHex(value, modulus) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error('Invalid canonical field value');
  const number = BigInt(value);
  if (number >= modulus) throw new Error('Field value out of range');
  return number.toString(16).padStart(64, '0');
}
export const scalarHex = value => fieldHex(value, SCALAR_FIELD);
export const baseHex = value => fieldHex(value, BASE_FIELD);

function g1(point) {
  if (!Array.isArray(point) || point.length !== 3 || point[2] !== '1') throw new Error('Invalid G1 shape');
  return baseHex(point[0]) + baseHex(point[1]);
}
function g2(point) {
  if (!Array.isArray(point) || point.length !== 3 || point.some(x => !Array.isArray(x) || x.length !== 2) || point[2][0] !== '1' || point[2][1] !== '0') throw new Error('Invalid G2 shape');
  // Solana Fq2 order is imaginary, real for each of x and y.
  return [point[0][1], point[0][0], point[1][1], point[1][0]].map(baseHex).join('');
}
export function proofToSolana(proof, signals) {
  if (!proof || proof.protocol !== 'groth16' || proof.curve !== 'bn128' || !Array.isArray(signals) || signals.length !== 3) throw new Error('Invalid Groth16 envelope');
  const [root, nullifierHash, binding] = signals.map(scalarHex);
  const a = g1(proof.pi_a);
  const negatedY = (BASE_FIELD - BigInt(proof.pi_a[1])) % BASE_FIELD;
  return {
    root, nullifierHash, requestBinding: binding,
    proofA: a.slice(0, 64) + baseHex(String(negatedY)),
    proofB: g2(proof.pi_b), proofC: g1(proof.pi_c),
  };
}
export function verifyingKeyRust(vk) {
  if (vk.protocol !== 'groth16' || vk.curve !== 'bn128' || vk.nPublic !== 3 || vk.IC.length !== 4) throw new Error('Expected three-public-input verifying key');
  const array = hex => `[${Array.from(Buffer.from(hex, 'hex')).join(', ')}]`;
  return `// Generated for groth16-solana =0.2.0; input order root, nullifierHash, requestBinding.\nuse groth16_solana::groth16::Groth16Verifyingkey;\n\npub const VERIFYINGKEY: Groth16Verifyingkey = Groth16Verifyingkey {\n    nr_pubinputs: ${vk.IC.length},\n    vk_alpha_g1: ${array(g1(vk.vk_alpha_1))},\n    vk_beta_g2: ${array(g2(vk.vk_beta_2))},\n    vk_gamme_g2: ${array(g2(vk.vk_gamma_2))},\n    vk_delta_g2: ${array(g2(vk.vk_delta_2))},\n    vk_ic: &[${vk.IC.map(point => array(g1(point))).join(',\n        ')}],\n};\n`;
}
