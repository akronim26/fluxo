use groth16_solana::groth16::Groth16Verifier;
use serde_json::Value;
use solana_bn254::compression::prelude::{alt_bn128_g1_compress, alt_bn128_g2_compress};
use groth16_solana::decompression::{decompress_g1, decompress_g2};

mod key {
    include!("../../../programs/programs/fluxo_pool/src/vk.rs");
}

fn bytes<const N: usize>(value: &Value) -> [u8; N] {
    let hex = value.as_str().unwrap();
    assert_eq!(hex.len(), N * 2);
    let mut output = [0u8; N];
    for (index, slot) in output.iter_mut().enumerate() {
        *slot = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).unwrap();
    }
    output
}

fn main() {
    let fixture: Value = serde_json::from_str(include_str!("../../build/sample-spend.json")).unwrap();
    let a = bytes::<64>(&fixture["proofA"]);
    let b = bytes::<128>(&fixture["proofB"]);
    let c = bytes::<64>(&fixture["proofC"]);
    let inputs = [bytes::<32>(&fixture["root"]), bytes::<32>(&fixture["nullifierHash"]), bytes::<32>(&fixture["requestBinding"])];
    Groth16Verifier::new(&a, &b, &c, &inputs, &key::VERIFYINGKEY).unwrap().verify().unwrap();
    let compressed_a = alt_bn128_g1_compress(&a).unwrap();
    let compressed_b = alt_bn128_g2_compress(&b).unwrap();
    let compressed_c = alt_bn128_g1_compress(&c).unwrap();
    let round_a = decompress_g1(&compressed_a).unwrap();
    let round_b = decompress_g2(&compressed_b).unwrap();
    let round_c = decompress_g1(&compressed_c).unwrap();
    assert_eq!(round_a, a);
    assert_eq!(round_b, b);
    assert_eq!(round_c, c);
    Groth16Verifier::new(&round_a, &round_b, &round_c, &inputs, &key::VERIFYINGKEY).unwrap().verify().unwrap();
    let hex = |value: &[u8]| value.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let mut compressed = fixture.clone();
    compressed["proofA"] = Value::String(hex(&compressed_a));
    compressed["proofB"] = Value::String(hex(&compressed_b));
    compressed["proofC"] = Value::String(hex(&compressed_c));
    let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../build/sample-spend-compressed.json");
    std::fs::write(target, serde_json::to_string_pretty(&compressed).unwrap() + "\n").unwrap();
    for index in 0..3 {
        let mut tampered = inputs;
        tampered[index][31] ^= 1;
        assert!(Groth16Verifier::new(&a, &b, &c, &tampered, &key::VERIFYINGKEY).unwrap().verify().is_err());
    }
    println!("groth16-solana 0.2.0: converted and compressed/decompressed proofs verify; all three tampered public inputs rejected");
}
