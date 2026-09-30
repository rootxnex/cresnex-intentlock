import {
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  parseAbiParameters,
  toFunctionSelector,
} from "viem";

import {
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

import {
  loadTraceProvenanceContext,
  resolveTraceStage,
} from "./paper-trace-provenance.mjs";

const DIAGNOSTIC_NONCE =
  991001n;

const VALID_AFTER =
  1699999940n;

const VALID_UNTIL =
  1700003600n;

const AMOUNT =
  1_000_000n;

const MAXIMUM =
  1_000_000n;

function fail(message) {
  throw new Error(message);
}

async function rawRpc(
  rpc,
  method,
  params = [],
) {
  const response =
    await fetch(
      rpc,
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/json",
        },

        body:
          JSON.stringify({
            jsonrpc:
              "2.0",

            id:
              1,

            method,

            params,
          }),
      },
    );

  const body =
    await response.json();

  if (body.error) {
    fail(
      `${method}: `
      + `${JSON.stringify(body.error)}`,
    );
  }

  return body.result;
}

function assert(
  condition,
  message,
) {
  if (!condition) {
    fail(message);
  }
}

async function diagnosticNonceUsed({
  publicClient,
  fixture,
  artifacts,
}) {
  return publicClient.readContract({
    address:
      fixture.D,

    abi:
      artifacts.D.abi,

    functionName:
      "usedNonces",

    args: [
      DIAGNOSTIC_NONCE,
    ],
  });
}

export async function runLiveTracePreflight() {
  const artifacts =
    loadArtifacts();

  const accountRoles =
    roles();

  const traceContext =
    loadTraceProvenanceContext();

  const anvil =
    await startAnvil({
      stepsTracing: true,
    });

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

        transport:
          http(rpc),
      });

    const agentWallet =
      createWalletClient({
        account:
          accountRoles.agent,

        chain,

        transport:
          http(rpc),
      });

    const fixture =
      await deployFixture({
        walletClient:
          ownerWallet,

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

    const fixtureSnapshot =
      await rawRpc(
        rpc,
        "evm_snapshot",
      );

    console.log(
      "LIVE_TRACE_FIXTURE_SNAPSHOT:",
      fixtureSnapshot,
    );

    const nonceBefore =
      await diagnosticNonceUsed({
        publicClient,
        fixture,
        artifacts,
      });

    assert(
      nonceBefore === false,
      "diagnostic nonce already used before transaction",
    );

    console.log(
      "DIAGNOSTIC_NONCE_UNUSED_BEFORE: true",
    );

    const transferSelector =
      toFunctionSelector(
        "transfer(address,uint256)",
      );

    const transferData =
      encodeFunctionData({
        abi:
          artifacts.token.abi,

        functionName:
          "transfer",

        args: [
          accountRoles
            .recipientAllowed
            .address,

          AMOUNT,
        ],
      });

    const calls = [
      {
        target:
          fixture.USDC,

        value:
          0n,

        data:
          transferData,

        operation:
          0,
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
      module:
        PolicyModule.Transfer,

      assets: [
        {
          token:
            fixture.USDC,

          maxSpend:
            MAXIMUM,

          recipient:
            accountRoles
              .recipientAllowed
              .address,

          minReceive:
            0n,

          minFinalBalance:
            0n,
        },
      ],

      allowances:
        [],

      nativeConstraint: {
        maxSpend:
          0n,

        minFinalBalance:
          0n,
      },

      moduleData,
    };

    const callsHash =
      await publicClient.readContract({
        address:
          fixture.D,

        abi:
          artifacts.D.abi,

        functionName:
          "hashCalls",

        args: [
          calls,
        ],
      });

    const policyHash =
      await publicClient.readContract({
        address:
          fixture.D,

        abi:
          artifacts.D.abi,

        functionName:
          "hashPolicy",

        args: [
          policy,
        ],
      });

    const manifest = {
      version:
        2,

      account:
        fixture.D,

      owner:
        accountRoles.owner.address,

      agent:
        accountRoles.agent.address,

      chainId:
        BigInt(CHAIN_ID),

      callsHash,

      policyHash,

      nonce:
        DIAGNOSTIC_NONCE,

      validAfter:
        VALID_AFTER,

      validUntil:
        VALID_UNTIL,

      allowBatch:
        false,

      evidenceMode:
        1,
    };

    const digest =
      await publicClient.readContract({
        address:
          fixture.D,

        abi:
          artifacts.D.abi,

        functionName:
          "hashIntent",

        args: [
          manifest,
        ],
      });

    /*
     * hashIntent() already returns the EIP-712 digest.
     * Sign the digest directly; do not use signMessage().
     */
    const ownerSignature =
      await accountRoles.owner.sign({
        hash:
          digest,
      });

    const calldata =
      encodeFunctionData({
        abi:
          artifacts.D.abi,

        functionName:
          "executeIntent",

        args: [
          manifest,
          calls,
          policy,
          ownerSignature,
        ],
      });

    const transactionHash =
      await agentWallet.sendTransaction({
        to:
          fixture.D,

        data:
          calldata,
      });

    const receipt =
      await publicClient
        .waitForTransactionReceipt({
          hash:
            transactionHash,
        });

    assert(
      receipt.status === "success",
      "diagnostic IntentLock transaction reverted",
    );

    console.log(
      "DIAGNOSTIC_TRANSACTION_HASH:",
      transactionHash,
    );

    console.log(
      "DIAGNOSTIC_OUTER_RECEIPT_STATUS: success",
    );

    const nonceAfter =
      await diagnosticNonceUsed({
        publicClient,
        fixture,
        artifacts,
      });

    assert(
      nonceAfter === true,
      "diagnostic transaction did not consume diagnostic nonce",
    );

    console.log(
      "DIAGNOSTIC_NONCE_USED_AFTER: true",
    );

    const trace =
      await rawRpc(
        rpc,
        "debug_traceTransaction",
        [
          transactionHash,
          {
            disableStorage:
              true,

            disableMemory:
              true,

            disableStack:
              true,
          },
        ],
      );

    assert(
      trace
      && Array.isArray(
        trace.structLogs,
      ),
      "debug_traceTransaction did not return structLogs",
    );

    assert(
      trace.structLogs.length > 0,
      "debug_traceTransaction returned empty structLogs",
    );

    console.log(
      "LIVE_TRACE_STRUCTLOG_COUNT:",
      trace.structLogs.length,
    );

    const depths =
      [
        ...new Set(
          trace.structLogs.map(
            (entry) =>
              Number(
                entry.depth,
              ),
          ),
        ),
      ].sort(
        (left, right) =>
          left - right,
      );

    console.log(
      "LIVE_TRACE_DEPTHS:",
      depths.join(","),
    );

    assert(
      depths.includes(1),
      "trace does not contain outer depth 1",
    );

    assert(
      depths.includes(2),
      "trace does not contain IntentLock self-call depth 2",
    );

    assert(
      depths.some(
        (depth) =>
          depth >= 3,
      ),
      "trace does not contain nested target/validator depth >=3",
    );

    console.log(
      "LIVE_TRACE_DEPTH_CONVENTION: PASS",
    );

    const provenance =
      resolveTraceStage({
        structLogs:
          trace.structLogs,

        context:
          traceContext,

        expectedDepth:
          2,
      });

    assert(
      provenance.traceStage
        === "_validateOutcomes",
      "real trace did not map depth-2 execution into _validateOutcomes",
    );

    assert(
      provenance.matches.length
        > 0,
      "real trace contains no _validateOutcomes source-map match",
    );

    console.log(
      "LIVE_TRACE_VALIDATE_OUTCOMES_MATCHES:",
      provenance.matches.length,
    );

    console.log(
      "LIVE_TRACE_POSTCONDITION_SOURCE_ATTRIBUTION: PASS",
    );

    const matchedDepths =
      [
        ...new Set(
          provenance.matches.map(
            (entry) =>
              entry.depth,
          ),
        ),
      ];

    assert(
      matchedDepths.length === 1
      && matchedDepths[0] === 2,
      "source-map matches occurred at unexpected depth",
    );

    console.log(
      "LIVE_TRACE_VALIDATE_OUTCOMES_DEPTH: 2",
    );

    const reverted =
      await rawRpc(
        rpc,
        "evm_revert",
        [
          fixtureSnapshot,
        ],
      );

    assert(
      reverted === true,
      "fixture snapshot revert failed",
    );

    console.log(
      "DIAGNOSTIC_STATE_REVERTED: true",
    );

    const nonceAfterRevert =
      await diagnosticNonceUsed({
        publicClient,
        fixture,
        artifacts,
      });

    assert(
      nonceAfterRevert === false,
      "diagnostic nonce remained used after snapshot revert",
    );

    console.log(
      "DIAGNOSTIC_NONCE_UNUSED_AFTER_REVERT: true",
    );

    /*
     * Re-verify the full frozen fixture after diagnostic rollback.
     * This also proves all pilot nonces remain unused.
     */
    await verifyFixture({
      publicClient,
      artifacts,
      fixture,
      accountRoles,
    });

    console.log(
      "DIAGNOSTIC_TRANSACTIONS_EXECUTED: 1",
    );

    console.log(
      "PILOT_TRANSACTIONS_EXECUTED: 0",
    );

    console.log(
      "PILOT_OBSERVATIONS_CREATED: 0",
    );

    console.log(
      "LIVE_TRACE_ACQUISITION_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}
