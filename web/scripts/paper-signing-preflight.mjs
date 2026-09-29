import {
  createWalletClient,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  parseAbiParameters,
  recoverAddress,
  toFunctionSelector,
} from "viem";

import {
  hashCallsV2,
  hashPolicyV2,
  PolicyModule,
} from "../lib/intentV2.ts";

import {
  CHAIN_ID,
  deployFixture,
  loadArtifacts,
  roles,
  startAnvil,
  stopAnvil,
  verifyFixture,
} from "./paper-fixture-preflight.mjs";

const VALID_AFTER = 1699999940n;
const VALID_UNTIL = 1700003600n;
const AMOUNT = 1_000_000n;
const MAXIMUM = 1_000_000n;

const NONCES = Object.freeze({
  A: 990001n,
  B: 990002n,
  C: 990003n,
  D: 990004n,
});

function fail(message) {
  throw new Error(message);
}

function assertHexEqual(label, actual, expected) {
  if (
    actual.toLowerCase()
    !== expected.toLowerCase()
  ) {
    fail(
      `${label} mismatch: ${actual} != ${expected}`,
    );
  }
}

async function signDigestAndVerify(
  owner,
  digest,
  label,
) {
  /*
   * IMPORTANT:
   * The digest returned by authorizationHash/hashIntent
   * is already the digest expected by the contracts.
   *
   * Do not use signMessage() here.
   */
  const signature =
    await owner.sign({
      hash: digest,
    });

  const recovered =
    await recoverAddress({
      hash: digest,
      signature,
    });

  if (
    recovered.toLowerCase()
    !== owner.address.toLowerCase()
  ) {
    fail(
      `${label}: recovered signer mismatch`,
    );
  }

  console.log(
    `${label}_digest: ${digest}`,
  );

  console.log(
    `${label}_owner_recovered: true`,
  );

  return signature;
}

async function assertNonceUnused(
  publicClient,
  address,
  abi,
  nonce,
  label,
) {
  const used =
    await publicClient.readContract({
      address,
      abi,
      functionName: "usedNonces",
      args: [nonce],
    });

  if (used !== false) {
    fail(
      `${label}: simulation consumed nonce ${nonce}`,
    );
  }
}

async function simulateBuiltCall(
  publicClient,
  from,
  to,
  data,
  label,
) {
  const response =
    await publicClient.call({
      account: from,
      to,
      data,
    });

  console.log(
    `${label}_eth_call: PASS`,
  );

  return response.data ?? "0x";
}

export async function runSigningPreflight() {
  const artifacts =
    loadArtifacts();

  const accountRoles =
    roles();

  const anvil =
    await startAnvil();

  try {
    const {
      publicClient,
      chain,
      rpc,
    } = anvil;

    const ownerWallet =
      createWalletClient({
        account:
          accountRoles.owner,
        chain,
        transport: http(rpc),
      });

    const fixture =
      await deployFixture({
        walletClient: ownerWallet,
        publicClient,
        artifacts,
        accountRoles,
      });

    await verifyFixture({
      publicClient,
      artifacts,
      fixture,
      accountRoles,
    });

    const transferSelector =
      toFunctionSelector(
        "transfer(address,uint256)",
      );

    const transferData =
      encodeFunctionData({
        abi: artifacts.token.abi,
        functionName: "transfer",
        args: [
          accountRoles
            .recipientAllowed
            .address,
          AMOUNT,
        ],
      });

    /*
     * BASELINE A
     */

    const digestA =
      await publicClient.readContract({
        address: fixture.A,
        abi: artifacts.A.abi,
        functionName:
          "authorizationHash",
        args: [
          accountRoles.agent.address,
          NONCES.A,
          VALID_UNTIL,
        ],
      });

    const signatureA =
      await signDigestAndVerify(
        accountRoles.owner,
        digestA,
        "A",
      );

    const calldataA =
      encodeFunctionData({
        abi: artifacts.A.abi,
        functionName: "execute",
        args: [
          fixture.USDC,
          0n,
          transferData,
          NONCES.A,
          VALID_UNTIL,
          signatureA,
        ],
      });

    await simulateBuiltCall(
      publicClient,
      accountRoles.agent.address,
      fixture.A,
      calldataA,
      "A",
    );

    /*
     * BASELINE B
     */

    const digestB =
      await publicClient.readContract({
        address: fixture.B,
        abi: artifacts.B.abi,
        functionName:
          "authorizationHash",
        args: [
          accountRoles.agent.address,
          fixture.USDC,
          MAXIMUM,
          NONCES.B,
          VALID_UNTIL,
        ],
      });

    const signatureB =
      await signDigestAndVerify(
        accountRoles.owner,
        digestB,
        "B",
      );

    const calldataB =
      encodeFunctionData({
        abi: artifacts.B.abi,
        functionName: "transfer",
        args: [
          fixture.USDC,
          accountRoles
            .recipientAllowed
            .address,
          AMOUNT,
          MAXIMUM,
          NONCES.B,
          VALID_UNTIL,
          signatureB,
        ],
      });

    await simulateBuiltCall(
      publicClient,
      accountRoles.agent.address,
      fixture.B,
      calldataB,
      "B",
    );

    /*
     * BASELINE C
     */

    const digestC =
      await publicClient.readContract({
        address: fixture.C,
        abi: artifacts.C.abi,
        functionName:
          "authorizationHash",
        args: [
          accountRoles.agent.address,
          fixture.USDC,
          transferSelector,
          MAXIMUM,
          NONCES.C,
          VALID_UNTIL,
        ],
      });

    const signatureC =
      await signDigestAndVerify(
        accountRoles.owner,
        digestC,
        "C",
      );

    const calldataC =
      encodeFunctionData({
        abi: artifacts.C.abi,
        functionName: "execute",
        args: [
          fixture.USDC,
          transferData,
          transferSelector,
          MAXIMUM,
          NONCES.C,
          VALID_UNTIL,
          signatureC,
        ],
      });

    await simulateBuiltCall(
      publicClient,
      accountRoles.agent.address,
      fixture.C,
      calldataC,
      "C",
    );

    /*
     * INTENTLOCK D
     */

    const calls = [
      {
        target: fixture.USDC,
        value: 0n,
        data: transferData,
        operation: 0,
      },
    ];

    const moduleData =
      encodeAbiParameters(
        parseAbiParameters(
          "address,address,uint256,bool,address,bytes4",
        ),
        [
          fixture.USDC,
          accountRoles
            .recipientAllowed
            .address,
          MAXIMUM,
          false,
          fixture.USDC,
          transferSelector,
        ],
      );

    const policy = {
      module: PolicyModule.Transfer,
      assets: [
        {
          token: fixture.USDC,
          maxSpend: MAXIMUM,
          recipient:
            accountRoles
              .recipientAllowed
              .address,
          minReceive: 0n,
          minFinalBalance: 0n,
        },
      ],
      allowances: [],
      nativeConstraint: {
        maxSpend: 0n,
        minFinalBalance: 0n,
      },
      moduleData,
    };

    const callsHashContract =
      await publicClient.readContract({
        address: fixture.D,
        abi: artifacts.D.abi,
        functionName: "hashCalls",
        args: [calls],
      });

    const callsHashJs =
      hashCallsV2(calls);

    assertHexEqual(
      "D callsHash",
      callsHashContract,
      callsHashJs,
    );

    console.log(
      "D_calls_hash_match: true",
    );

    const policyHashContract =
      await publicClient.readContract({
        address: fixture.D,
        abi: artifacts.D.abi,
        functionName: "hashPolicy",
        args: [policy],
      });

    const policyHashJs =
      hashPolicyV2(policy);

    assertHexEqual(
      "D policyHash",
      policyHashContract,
      policyHashJs,
    );

    console.log(
      "D_policy_hash_match: true",
    );

    const manifest = {
      version: 2,
      account: fixture.D,
      owner:
        accountRoles.owner.address,
      agent:
        accountRoles.agent.address,
      chainId: BigInt(CHAIN_ID),
      callsHash:
        callsHashContract,
      policyHash:
        policyHashContract,
      nonce: NONCES.D,
      validAfter: VALID_AFTER,
      validUntil: VALID_UNTIL,
      allowBatch: false,
      evidenceMode: 1,
    };

    const digestD =
      await publicClient.readContract({
        address: fixture.D,
        abi: artifacts.D.abi,
        functionName: "hashIntent",
        args: [manifest],
      });

    const signatureD =
      await signDigestAndVerify(
        accountRoles.owner,
        digestD,
        "D",
      );

    const calldataD =
      encodeFunctionData({
        abi: artifacts.D.abi,
        functionName:
          "executeIntent",
        args: [
          manifest,
          calls,
          policy,
          signatureD,
        ],
      });

    const resultDataD =
      await simulateBuiltCall(
        publicClient,
        accountRoles.agent.address,
        fixture.D,
        calldataD,
        "D",
      );

    const resultD =
      decodeFunctionResult({
        abi: artifacts.D.abi,
        functionName:
          "executeIntent",
        data: resultDataD,
      });

    const successD =
      Array.isArray(resultD)
        ? resultD[0]
        : resultD;

    if (successD !== true) {
      fail(
        "D: valid simulated intent was not accepted",
      );
    }

    console.log(
      "D_valid_intent_result: true",
    );

    /*
     * eth_call must leave all state untouched.
     */

    await assertNonceUnused(
      publicClient,
      fixture.A,
      artifacts.A.abi,
      NONCES.A,
      "A",
    );

    await assertNonceUnused(
      publicClient,
      fixture.B,
      artifacts.B.abi,
      NONCES.B,
      "B",
    );

    await assertNonceUnused(
      publicClient,
      fixture.C,
      artifacts.C.abi,
      NONCES.C,
      "C",
    );

    await assertNonceUnused(
      publicClient,
      fixture.D,
      artifacts.D.abi,
      NONCES.D,
      "D",
    );

    const recipientBalance =
      await publicClient.readContract({
        address: fixture.USDC,
        abi: artifacts.token.abi,
        functionName: "balanceOf",
        args: [
          accountRoles
            .recipientAllowed
            .address,
        ],
      });

    if (recipientBalance !== 0n) {
      fail(
        "eth_call simulation leaked recipient state",
      );
    }

    const [
      registered,
      quarantined,
      strikes,
    ] =
      await publicClient.readContract({
        address: fixture.D,
        abi: artifacts.D.abi,
        functionName: "agents",
        args: [
          accountRoles.agent.address,
        ],
      });

    if (
      registered !== true
      || quarantined !== false
      || strikes !== 0n
    ) {
      fail(
        "eth_call simulation changed D agent state",
      );
    }

    console.log(
      "SIMULATION_STATE_UNCHANGED: true",
    );

    console.log(
      "PILOT_NONCES_USED: 0",
    );

    console.log(
      "PILOT_SCENARIOS_EXECUTED: 0",
    );

    console.log(
      "SIGNING_BUILDER_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}
