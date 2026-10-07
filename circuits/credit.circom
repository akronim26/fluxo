pragma circom 2.2.3;

include "./node_modules/circomlib/circuits/poseidon.circom";
include "./node_modules/circomlib/circuits/comparators.circom";

template Credit(depth) {
    signal input secret;
    signal input nk;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input i;
    signal input root;
    signal input nullifierHash;
    signal input requestBinding;

    component commitment = Poseidon(2);
    commitment.inputs[0] <== secret;
    commitment.inputs[1] <== nk;

    signal nodes[depth + 1];
    signal left[depth];
    signal right[depth];
    component hashes[depth];
    nodes[0] <== commitment.out;
    for (var level = 0; level < depth; level++) {
        pathIndices[level] * (pathIndices[level] - 1) === 0;
        left[level] <== nodes[level] + pathIndices[level] * (pathElements[level] - nodes[level]);
        right[level] <== pathElements[level] + pathIndices[level] * (nodes[level] - pathElements[level]);
        hashes[level] = Poseidon(2);
        hashes[level].inputs[0] <== left[level];
        hashes[level].inputs[1] <== right[level];
        nodes[level + 1] <== hashes[level].out;
    }
    nodes[depth] === root;

    component indexBits = Num2Bits(8);
    indexBits.in <== i;
    component creditLimit = LessThan(8);
    creditLimit.in[0] <== i;
    creditLimit.in[1] <== 200;
    creditLimit.out === 1;

    component nullifier = Poseidon(2);
    nullifier.inputs[0] <== nk;
    nullifier.inputs[1] <== i;
    nullifier.out === nullifierHash;

    // Constrain the external binding without publishing a fourth public signal.
    signal bindingSquare;
    bindingSquare <== requestBinding * requestBinding;
}

component main { public [root, nullifierHash, requestBinding] } = Credit(10);
