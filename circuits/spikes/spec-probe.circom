pragma circom 2.2.3;

// Throwaway S7 contract probe, NOT the production credit circuit.
// Reproduces circomlib LessThan(8)'s Num2Bits(9) semantics without dependencies.
// Reference: https://github.com/iden3/circomlib/blob/master/circuits/comparators.circom
template SpecProbe() {
    signal input requestBinding;
    signal input i;
    signal bits[9];
    var reconstructed = 0;
    for (var j = 0; j < 9; j++) {
        bits[j] <-- ((i + 256 - 200) >> j) & 1;
        bits[j] * (bits[j] - 1) === 0;
        reconstructed += bits[j] * (1 << j);
    }
    reconstructed === i + 256 - 200;
    bits[8] === 0;
    requestBinding * requestBinding === requestBinding * requestBinding;
}

component main { public [requestBinding] } = SpecProbe();
