import {
  createWalletClient,
  http,
} from "viem";

import {
  deployFixture,
  loadArtifacts,
  roles,
  startAnvil,
  stopAnvil,
  verifyFixture,
} from "./paper-fixture-preflight.mjs";

import {
  buildPilotPlan,
  validatePilotPlan,
} from "./paper-scenario-plan.mjs";

import {
  applyPilotPrerequisites,
} from "./paper-prerequisite-preflight.mjs";

import {
  buildPilotTransaction,
  prepareMeasuredOuterTransaction,
  sendPreparedMeasuredTransaction,
} from "./paper-measured-transaction-executor.mjs";

import {
  decodeObservedError,
} from "./paper-evidence.mjs";

const EXPECTED_REVERTS =
  Object.freeze({
    "PILOT-03/B":
      "SpendExceeded",

    "PILOT-03/C":
      "PathRejected",

    "PILOT-06/D":
      "CallsHashMismatch",

    "PILOT-07/A":
      "InvalidAuthorization",

    "PILOT-07/B":
      "InvalidAuthorization",

    "PILOT-07/C":
      "InvalidAuthorization",

    "PILOT-07/D":
      "NonceAlreadyUsed",

    "PILOT-10/D":
      "AgentQuarantinedError",
  });

function fail(message) {
  throw new Error(message);
}

function assert(
  condition,
  message,
) {
  if (!condition) {
    fail(message);
  }
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

  return response.json();
}

function extractRevertData(
  error,
) {
  if (
    !error
    || typeof error
      !== "object"
  ) {
    return null;
  }

  if (
    typeof error.data
      === "string"
    && error.data
      .startsWith("0x")
  ) {
    return error.data;
  }

  if (
    error.data
    && typeof error.data
      === "object"
  ) {
    if (
      typeof error.data.data
        === "string"
      && error.data.data
        .startsWith("0x")
    ) {
      return error.data.data;
    }

    if (
      typeof error.data.result
        === "string"
      && error.data.result
        .startsWith("0x")
    ) {
      return error.data.result;
    }
  }

  return null;
}

function findRow(
  plan,
  key,
) {
  const [
    scenarioId,
    baseline,
  ] =
    key.split("/");

  const row =
    plan.find(
      (candidate) =>
        candidate.scenario_id
          === scenarioId
        && candidate.baseline
          === baseline,
    );

  assert(
    row,
    `${key}: row missing`,
  );

  assert(
    row.applicability
      === "APPLICABLE",
    `${key}: row not applicable`,
  );

  return row;
}

async function readNonceUsed({
  row,
  fixture,
  artifacts,
  publicClient,
}) {
  return publicClient.readContract({
    address:
      fixture[row.baseline],

    abi:
      artifacts[
        row.baseline
      ].abi,

    functionName:
      "usedNonces",

    args: [
      BigInt(row.nonce),
    ],
  });
}

async function readDQuarantined({
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  const state =
    await publicClient.readContract({
      address:
        fixture.D,

      abi:
        artifacts.D.abi,

      functionName:
        "agents",

      args: [
        accountRoles
          .agent
          .address,
      ],
    });

  return state[1];
}

export async function runRevertEvidencePreflight() {
  const artifacts =
    loadArtifacts();

  const accountRoles =
    roles();

  const plan =
    buildPilotPlan();

  validatePilotPlan(
    plan,
  );

  const selected =
    Object.keys(
      EXPECTED_REVERTS,
    ).map(
      (key) =>
        findRow(
          plan,
          key,
        ),
    );

  assert(
    selected.length === 8,
    `revert evidence rows=${selected.length}, expected 8`,
  );

  const anvil =
    await startAnvil();

  let diagnosticTransactions =
    0;

  let prerequisiteTransactions =
    0;

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

    for (
      const row
      of selected
    ) {
      const key =
        `${row.scenario_id}/${row.baseline}`;

      const expectedError =
        EXPECTED_REVERTS[key];

      const snapshotResponse =
        await rawRpc(
          rpc,
          "evm_snapshot",
          [],
        );

      if (
        snapshotResponse.error
        || typeof snapshotResponse.result
          !== "string"
      ) {
        fail(
          `${key}: evm_snapshot failed`,
        );
      }

      const snapshot =
        snapshotResponse.result;

      try {
        const transaction =
          await buildPilotTransaction({
            row,
            fixture,
            artifacts,
            accountRoles,
            publicClient,
          });

        const prerequisite =
          await applyPilotPrerequisites({
            row,

            measuredTransaction:
              transaction,

            fixture,
            artifacts,
            accountRoles,
            publicClient,
            ownerWallet,
            agentWallet,
            rpc,
          });

        prerequisiteTransactions +=
          prerequisite
            .excludedTransactions;

        if (
          row.scenario_id
            === "PILOT-07"
        ) {
          const nonceUsedBefore =
            await readNonceUsed({
              row,
              fixture,
              artifacts,
              publicClient,
            });

          assert(
            nonceUsedBefore === true,
            `${key}: nonce must already be used before replay`,
          );
        }

        if (
          key === "PILOT-10/D"
        ) {
          const quarantinedBefore =
            await readDQuarantined({
              fixture,
              artifacts,
              accountRoles,
              publicClient,
            });

          assert(
            quarantinedBefore === true,
            "PILOT-10/D: agent must already be quarantined",
          );
        }

        const timestampResponse =
          await rawRpc(
            rpc,
            "evm_setNextBlockTimestamp",
            [
              row.measured_timestamp,
            ],
          );

        if (timestampResponse.error) {
          fail(
            `${key}: timestamp setup failed`,
          );
        }

        const prepared =
          await prepareMeasuredOuterTransaction({
            transaction,

            account:
              accountRoles.agent,

            publicClient,
          });

        const result =
          await sendPreparedMeasuredTransaction({
            rpc,
            publicClient,
            prepared,
          });

        diagnosticTransactions += 1;

        assert(
          result.receipt.status
            === "reverted",
          `${key}: expected reverted outer receipt, got ${result.receipt.status}`,
        );

        assert(
          result.receipt.blockNumber
            > 0n,
          `${key}: invalid block number`,
        );

        const parentBlock =
          result.receipt.blockNumber
          - 1n;

        const callResponse =
          await rawRpc(
            rpc,
            "eth_call",
            [
              {
                from:
                  accountRoles
                    .agent
                    .address,

                to:
                  transaction.to,

                data:
                  transaction.calldata,

                value:
                  "0x0",

                gas:
                  "0x7a1200",
              },

              `0x${parentBlock.toString(16)}`,
            ],
          );

        assert(
          callResponse.error,
          `${key}: parent-state eth_call unexpectedly succeeded`,
        );

        const revertData =
          extractRevertData(
            callResponse.error,
          );

        assert(
          typeof revertData
            === "string"
          && revertData.startsWith(
            "0x",
          )
          && revertData.length
            >= 10,
          `${key}: revert data unavailable`,
        );

        const decoded =
          decodeObservedError({
            baseline:
              row.baseline,

            data:
              revertData,

            artifacts,
          });

        assert(
          decoded.errorName
            === expectedError,
          `${key}: decoded error=${decoded.errorName}, expected ${expectedError}`,
        );

        assert(
          typeof decoded.errorSelector
            === "string"
          && /^0x[0-9a-fA-F]{8}$/
            .test(
              decoded.errorSelector,
            ),
          `${key}: malformed error selector`,
        );

        assert(
          typeof decoded.revertHash
            === "string"
          && /^0x[0-9a-fA-F]{64}$/
            .test(
              decoded.revertHash,
            ),
          `${key}: malformed revert hash`,
        );

        console.log(
          `${key}_REVERT_ERROR:`,
          decoded.errorName,
        );

        console.log(
          `${key}_ERROR_SELECTOR:`,
          decoded.errorSelector,
        );

        console.log(
          `${key}_REVERT_HASH:`,
          decoded.revertHash,
        );

        console.log(
          `${key}_REVERT_EVIDENCE: PASS`,
        );
      } finally {
        const revertResponse =
          await rawRpc(
            rpc,
            "evm_revert",
            [
              snapshot,
            ],
          );

        assert(
          revertResponse.error
            === undefined,
          `${key}: evm_revert RPC failed`,
        );

        assert(
          revertResponse.result
            === true,
          `${key}: snapshot revert returned false`,
        );
      }
    }

    assert(
      diagnosticTransactions === 8,
      `diagnostic reverted tx count=${diagnosticTransactions}, expected 8`,
    );

    assert(
      prerequisiteTransactions === 6,
      `diagnostic prerequisite tx count=${prerequisiteTransactions}, expected 6`,
    );

    await verifyFixture({
      publicClient,
      artifacts,
      fixture,
      accountRoles,
    });

    console.log(
      "REVERT_EVIDENCE_CASES: 8",
    );

    console.log(
      "REVERT_DATA_PARENT_STATE_REPLAY: PASS",
    );

    console.log(
      "REVERT_CUSTOM_ERROR_DECODING: PASS",
    );

    console.log(
      "KNOWN_NONCE_REPLAY_PRESTATE: PASS",
    );

    console.log(
      "KNOWN_QUARANTINE_PRESTATE: PASS",
    );

    console.log(
      "DIAGNOSTIC_PREREQUISITE_TRANSACTIONS_EXECUTED: 6",
    );

    console.log(
      "DIAGNOSTIC_REVERT_EVIDENCE_TRANSACTIONS_EXECUTED: 8",
    );

    console.log(
      "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 0",
    );

    console.log(
      "PILOT_OBSERVATIONS_CREATED: 0",
    );

    console.log(
      "REVERT_EVIDENCE_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}
