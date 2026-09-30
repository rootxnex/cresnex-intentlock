import {
  createWalletClient,
  http,
} from "viem";

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
  buildPilotPlan,
  validatePilotPlan,
} from "./paper-scenario-plan.mjs";

import {
  buildSimplePilotTransaction,
} from "./paper-transaction-builders.mjs";

import {
  buildAdvancedPilotTransaction,
} from "./paper-advanced-transaction-builders.mjs";

import {
  applyPilotPrerequisites,
} from "./paper-prerequisite-preflight.mjs";

const MEASURED_GAS_LIMIT =
  8_000_000n;

const SIMPLE_SCENARIOS =
  new Set([
    "PILOT-01",
    "PILOT-02",
    "PILOT-03",
    "PILOT-04",
    "PILOT-07",
  ]);

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

  const body =
    await response.json();

  if (body.error) {
    fail(
      `${method}: ${JSON.stringify(body.error)}`,
    );
  }

  return body.result;
}

export async function buildPilotTransaction({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  if (
    SIMPLE_SCENARIOS.has(
      row.scenario_id,
    )
  ) {
    return buildSimplePilotTransaction({
      row,
      fixture,
      artifacts,
      accountRoles,
      publicClient,
    });
  }

  return buildAdvancedPilotTransaction({
    row,
    fixture,
    artifacts,
    accountRoles,
    publicClient,
  });
}

export async function prepareMeasuredOuterTransaction({
  transaction,
  account,
  publicClient,
}) {
  /*
   * Every quantity needed to create the outer Ethereum
   * transaction is resolved before the latency clock starts.
   *
   * No gas estimation is performed. The fixed gas limit is
   * deliberate so expected-revert baselines can still be sent.
   */
  const [
    outerNonce,
    gasPrice,
  ] =
    await Promise.all([
      publicClient.getTransactionCount({
        address:
          account.address,

        blockTag:
          "pending",
      }),

      publicClient.getGasPrice(),
    ]);

  const serialized =
    await account.signTransaction({
      chainId:
        CHAIN_ID,

      nonce:
        outerNonce,

      gas:
        MEASURED_GAS_LIMIT,

      gasPrice,

      to:
        transaction.to,

      value:
        0n,

      data:
        transaction.calldata,
    });

  assert(
    typeof serialized
      === "string"
    && serialized.startsWith("0x")
    && serialized.length > 10,
    "serialized measured transaction missing",
  );

  return {
    serialized,
    outerNonce,
    gasPrice,
    gasLimit:
      MEASURED_GAS_LIMIT,
  };
}

export async function sendPreparedMeasuredTransaction({
  rpc,
  publicClient,
  prepared,
}) {
  /*
   * Frozen timing boundary:
   *
   * start: immediately before sending an already-signed
   *        raw outer transaction
   *
   * stop:  immediately after its receipt is available
   *
   * Signing, nonce lookup, fee lookup, fixture setup,
   * prerequisites and post-state reads are excluded.
   */
  const startedNs =
    process.hrtime.bigint();

  const transactionHash =
    await rawRpc(
      rpc,
      "eth_sendRawTransaction",
      [
        prepared.serialized,
      ],
    );

  const receipt =
    await publicClient
      .waitForTransactionReceipt({
        hash:
          transactionHash,
      });

  const endedNs =
    process.hrtime.bigint();

  const executionTimeNs =
    endedNs - startedNs;

  assert(
    executionTimeNs > 0n,
    "measured execution time must be positive",
  );

  assert(
    typeof transactionHash
      === "string"
    && /^0x[0-9a-fA-F]{64}$/
      .test(transactionHash),
    "transaction hash malformed",
  );

  assert(
    receipt.transactionHash
      .toLowerCase()
      === transactionHash
        .toLowerCase(),
    "receipt transaction hash mismatch",
  );

  assert(
    receipt.gasUsed > 0n,
    "measured receipt gasUsed must be positive",
  );

  return {
    transactionHash,

    receipt,

    executionTimeNs,

    executionTimeMs:
      Number(executionTimeNs)
      / 1_000_000,
  };
}

function findRow(
  plan,
  scenarioId,
  baseline,
) {
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
    `${scenarioId}/${baseline}: row missing`,
  );

  assert(
    row.applicability
      === "APPLICABLE",
    `${scenarioId}/${baseline}: row not applicable`,
  );

  return row;
}

async function diagnosticCase({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
  rpc,
}) {
  const snapshot =
    await rawRpc(
      rpc,
      "evm_snapshot",
      [],
    );

  try {
    const transaction =
      await buildPilotTransaction({
        row,
        fixture,
        artifacts,
        accountRoles,
        publicClient,
      });

    await rawRpc(
      rpc,
      "evm_setNextBlockTimestamp",
      [
        row.measured_timestamp,
      ],
    );

    const prepared =
      await prepareMeasuredOuterTransaction({
        transaction,
        account:
          accountRoles.agent,
        publicClient,
      });

    const outerNonceBefore =
      await publicClient
        .getTransactionCount({
          address:
            accountRoles
              .agent
              .address,

          blockTag:
            "pending",
        });

    assert(
      outerNonceBefore
        === prepared.outerNonce,
      `${row.scenario_id}/${row.baseline}: prepared outer nonce changed before send`,
    );

    const result =
      await sendPreparedMeasuredTransaction({
        rpc,
        publicClient,
        prepared,
      });

    const outerNonceAfter =
      await publicClient
        .getTransactionCount({
          address:
            accountRoles
              .agent
              .address,

          blockTag:
            "latest",
        });

    assert(
      outerNonceAfter
        === prepared.outerNonce + 1,
      `${row.scenario_id}/${row.baseline}: outer nonce did not advance exactly once`,
    );

    const block =
      await publicClient.getBlock({
        blockNumber:
          result.receipt
            .blockNumber,
      });

    assert(
      block.timestamp
        === BigInt(
          row.measured_timestamp,
        ),
      `${row.scenario_id}/${row.baseline}: measured timestamp mismatch`,
    );

    console.log(
      `${row.scenario_id}/${row.baseline}_RAW_SIGNED_BEFORE_TIMER: PASS`,
    );

    console.log(
      `${row.scenario_id}/${row.baseline}_OUTER_RECEIPT_STATUS:`,
      result.receipt.status,
    );

    console.log(
      `${row.scenario_id}/${row.baseline}_GAS_USED:`,
      result.receipt.gasUsed.toString(),
    );

    console.log(
      `${row.scenario_id}/${row.baseline}_EXECUTION_TIME_NS:`,
      result.executionTimeNs.toString(),
    );

    console.log(
      `${row.scenario_id}/${row.baseline}_EXECUTION_TIME_MS:`,
      result.executionTimeMs,
    );

    console.log(
      `${row.scenario_id}/${row.baseline}_TRANSACTION_HASH:`,
      result.transactionHash,
    );

    console.log(
      `${row.scenario_id}/${row.baseline}_BLOCK_NUMBER:`,
      result.receipt
        .blockNumber
        .toString(),
    );

    console.log(
      `${row.scenario_id}/${row.baseline}_MEASURED_SEND_DIAGNOSTIC: PASS`,
    );

    return result;
  } finally {
    const reverted =
      await rawRpc(
        rpc,
        "evm_revert",
        [
          snapshot,
        ],
      );

    assert(
      reverted === true,
      `${row.scenario_id}/${row.baseline}: snapshot revert failed`,
    );
  }
}

export async function runMeasuredSendPreflight() {
  const artifacts =
    loadArtifacts();

  const accountRoles =
    roles();

  const plan =
    buildPilotPlan();

  validatePilotPlan(
    plan,
  );

  const selected = [
    findRow(
      plan,
      "PILOT-01",
      "A",
    ),

    findRow(
      plan,
      "PILOT-02",
      "D",
    ),
  ];

  const anvil =
    await startAnvil();

  let diagnosticTransactions =
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
      const result =
        await diagnosticCase({
          row,
          fixture,
          artifacts,
          accountRoles,
          publicClient,
          rpc,
        });

      diagnosticTransactions += 1;

      /*
       * P01/A should succeed normally.
       *
       * P02/D is intentionally useful here because IntentLock
       * persists the violation while the outer Ethereum
       * transaction itself remains successful.
       */
      assert(
        result.receipt.status
          === "success",
        `${row.scenario_id}/${row.baseline}: unexpected outer receipt status`,
      );
    }

    assert(
      diagnosticTransactions === 2,
      `diagnostic measured-send tx count=${diagnosticTransactions}, expected 2`,
    );

    await verifyFixture({
      publicClient,
      artifacts,
      fixture,
      accountRoles,
    });

    console.log(
      "MEASURED_SEND_PREFLIGHT_CASES: 2",
    );

    console.log(
      "RAW_TRANSACTION_PREPARED_BEFORE_TIMER: PASS",
    );

    console.log(
      "MEASUREMENT_BOUNDARY_SEND_TO_RECEIPT: PASS",
    );

    console.log(
      "FIXED_GAS_LIMIT_NO_ESTIMATION: PASS",
    );

    console.log(
      "EOA_OUTER_NONCE_SINGLE_INCREMENT: PASS",
    );

    console.log(
      "MEASURED_TIMESTAMP_BINDING: PASS",
    );

    console.log(
      "DIAGNOSTIC_MEASURED_SEND_TRANSACTIONS_EXECUTED: 2",
    );

    console.log(
      "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 0",
    );

    console.log(
      "PILOT_OBSERVATIONS_CREATED: 0",
    );

    console.log(
      "MEASURED_TRANSACTION_SEND_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}

export async function runMeasuredMatrixPreflight() {
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
    plan.filter(
      (row) =>
        row.applicability
          === "APPLICABLE",
    );

  assert(
    selected.length === 27,
    `applicable measured matrix rows=${selected.length}, expected 27`,
  );

  const counts =
    Object.fromEntries(
      ["A", "B", "C", "D"]
        .map(
          (baseline) => [
            baseline,

            selected.filter(
              (row) =>
                row.baseline
                  === baseline,
            ).length,
          ],
        ),
    );

  assert(
    counts.A === 7
    && counts.B === 4
    && counts.C === 6
    && counts.D === 10,
    `unexpected measured matrix counts ${JSON.stringify(counts)}`,
  );

  const anvil =
    await startAnvil();

  let diagnosticMeasuredTransactions =
    0;

  let diagnosticPrerequisiteTransactions =
    0;

  let successReceipts =
    0;

  let revertedReceipts =
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
      const label =
        `${row.scenario_id}/${row.baseline}`;

      const snapshot =
        await rawRpc(
          rpc,
          "evm_snapshot",
          [],
        );

      try {
        /*
         * Build exactly once before prerequisites.
         *
         * This is required for PILOT-07: the excluded
         * prior execution and the measured replay must
         * reuse byte-identical account calldata.
         */
        const transaction =
          await buildPilotTransaction({
            row,
            fixture,
            artifacts,
            accountRoles,
            publicClient,
          });

        const prerequisiteResult =
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

        diagnosticPrerequisiteTransactions +=
          prerequisiteResult
            .excludedTransactions;

        if (
          row.scenario_id
            === "PILOT-07"
        ) {
          assert(
            prerequisiteResult
              .reusedMeasuredCalldata
              === true,
            `${label}: exact measured calldata was not reused for replay prerequisite`,
          );
        }

        await rawRpc(
          rpc,
          "evm_setNextBlockTimestamp",
          [
            row.measured_timestamp,
          ],
        );

        const prepared =
          await prepareMeasuredOuterTransaction({
            transaction,

            account:
              accountRoles.agent,

            publicClient,
          });

        const outerNonceBefore =
          await publicClient
            .getTransactionCount({
              address:
                accountRoles
                  .agent
                  .address,

              blockTag:
                "pending",
            });

        assert(
          outerNonceBefore
            === prepared.outerNonce,
          `${label}: prepared outer nonce changed before send`,
        );

        const result =
          await sendPreparedMeasuredTransaction({
            rpc,
            publicClient,
            prepared,
          });

        diagnosticMeasuredTransactions += 1;

        const outerNonceAfter =
          await publicClient
            .getTransactionCount({
              address:
                accountRoles
                  .agent
                  .address,

              blockTag:
                "latest",
            });

        assert(
          outerNonceAfter
            === prepared.outerNonce + 1,
          `${label}: outer nonce did not advance exactly once`,
        );

        const block =
          await publicClient.getBlock({
            blockNumber:
              result.receipt
                .blockNumber,
          });

        assert(
          block.timestamp
            === BigInt(
              row.measured_timestamp,
            ),
          `${label}: measured timestamp mismatch`,
        );

        assert(
          result.receipt.status
            === "success"
          || result.receipt.status
            === "reverted",
          `${label}: unknown receipt status ${result.receipt.status}`,
        );

        if (
          result.receipt.status
            === "success"
        ) {
          successReceipts += 1;
        } else {
          revertedReceipts += 1;
        }

        console.log(
          [
            label,
            `receipt=${result.receipt.status}`,
            `gas=${result.receipt.gasUsed}`,
            `ns=${result.executionTimeNs}`,
            `prereq=${prerequisiteResult.excludedTransactions}`,
            "DIAGNOSTIC_PASS",
          ].join(" "),
        );
      } finally {
        const reverted =
          await rawRpc(
            rpc,
            "evm_revert",
            [
              snapshot,
            ],
          );

        assert(
          reverted === true,
          `${label}: row snapshot revert failed`,
        );
      }
    }

    assert(
      diagnosticMeasuredTransactions
        === 27,
      `diagnostic measured tx count=${diagnosticMeasuredTransactions}, expected 27`,
    );

    assert(
      diagnosticPrerequisiteTransactions
        === 9,
      `diagnostic prerequisite tx count=${diagnosticPrerequisiteTransactions}, expected 9`,
    );

    assert(
      successReceipts
        + revertedReceipts
        === 27,
      "receipt accounting does not sum to 27",
    );

    await verifyFixture({
      publicClient,
      artifacts,
      fixture,
      accountRoles,
    });

    console.log(
      "MEASURED_MATRIX_APPLICABLE_ROWS: 27",
    );

    console.log(
      `MEASURED_MATRIX_COUNTS: A=${counts.A} B=${counts.B} C=${counts.C} D=${counts.D}`,
    );

    console.log(
      `MEASURED_MATRIX_SUCCESS_RECEIPTS: ${successReceipts}`,
    );

    console.log(
      `MEASURED_MATRIX_REVERTED_RECEIPTS: ${revertedReceipts}`,
    );

    console.log(
      "PILOT_07_EXACT_ACCOUNT_CALLDATA_REPLAY: PASS",
    );

    console.log(
      "ROW_LEVEL_PRISTINE_SNAPSHOT_REVERSION: PASS",
    );

    console.log(
      "DIAGNOSTIC_PREREQUISITE_TRANSACTIONS_EXECUTED: 9",
    );

    console.log(
      "DIAGNOSTIC_MEASURED_MATRIX_TRANSACTIONS_EXECUTED: 27",
    );

    console.log(
      "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 0",
    );

    console.log(
      "PILOT_OBSERVATIONS_CREATED: 0",
    );

    console.log(
      "MEASURED_MATRIX_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}
