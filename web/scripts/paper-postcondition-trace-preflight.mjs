import {
  readFileSync,
} from "node:fs";

import {
  dirname,
  resolve,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

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
  buildAdvancedPilotTransaction,
} from "./paper-advanced-transaction-builders.mjs";

import {
  extractDReceiptSignals,
} from "./paper-evidence.mjs";

import {
  loadTraceProvenanceContext,
  resolveTraceStage,
  sourceEntryInValidateOutcomes,
} from "./paper-trace-provenance.mjs";

const SCRIPT_DIR =
  dirname(fileURLToPath(import.meta.url));

const CONTRACT_SOURCE_PATH =
  resolve(
    SCRIPT_DIR,
    "../../contracts/src/CresnexIntentLockAccountV2.sol",
  );

const EXPECTED_CASES =
  Object.freeze({
    "PILOT-05": Object.freeze({
      violationCode: 2,
      violationName: "MinOutputNotMet",

      frozenTrace:
        Object.freeze({
          pc: 3726,
          op: "PUSH1",
          depth2StepsToRevert: 5,
          sourceStart: 40286,
          sourceLength: 29,
          sourceNeedle:
            "ViolationCode.MinOutputNotMet",
        }),
    }),

    "PILOT-08": Object.freeze({
      violationCode: 4,
      violationName: "AllowanceExceeded",

      frozenTrace:
        Object.freeze({
          pc: 4169,
          op: "KECCAK256",
          depth2StepsToRevert: 11,
          sourceStart: 40923,
          sourceLength: 61,
          sourceNeedle:
            "finalAllowance, a.maxFinalAllowance",
        }),
    }),
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
            jsonrpc: "2.0",
            id: 1,
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

function findDRow(
  plan,
  scenarioId,
) {
  const row =
    plan.find(
      (candidate) =>
        candidate.scenario_id
          === scenarioId
        && candidate.baseline
          === "D",
    );

  assert(
    row,
    `${scenarioId}/D row missing`,
  );

  assert(
    row.applicability
      === "APPLICABLE",
    `${scenarioId}/D not applicable`,
  );

  assert(
    row.validation_provenance
      === "TRACE_REQUIRED_FOR_POSTCONDITION",
    `${scenarioId}/D provenance requirement changed`,
  );

  return row;
}

function sourceSnippet(
  sourceBuffer,
  entry,
) {
  if (
    !entry
    || !Number.isInteger(entry.start)
    || !Number.isInteger(entry.length)
  ) {
    return null;
  }

  return sourceBuffer
    .subarray(
      entry.start,
      entry.start + entry.length,
    )
    .toString("utf8")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function nearestValidateOutcomesBeforeRevert({
  structLogs,
  revertIndex,
  context,
}) {
  for (
    let index = revertIndex - 1;
    index >= 0;
    index -= 1
  ) {
    const log =
      structLogs[index];

    if (
      Number(log.depth) !== 2
    ) {
      continue;
    }

    const pc =
      Number(log.pc);

    if (!Number.isInteger(pc)) {
      continue;
    }

    const entry =
      context.pcMap.get(pc);

    if (
      sourceEntryInValidateOutcomes(
        entry,
        context,
      )
    ) {
      const depth2Steps =
        structLogs
          .slice(
            index,
            revertIndex + 1,
          )
          .filter(
            (candidate) =>
              Number(candidate.depth)
                === 2,
          )
          .length - 1;

      return {
        traceIndex:
          index,

        pc,

        op:
          log.op ?? null,

        depth:
          2,

        depth2StepsToRevert:
          depth2Steps,

        sourceEntry:
          entry,
      };
    }
  }

  return null;
}

async function assertRollbackState({
  publicClient,
  fixture,
  artifacts,
  accountRoles,
  scenarioId,
}) {
  const accountUsdc =
    await publicClient.readContract({
      address:
        fixture.USDC,

      abi:
        artifacts.token.abi,

      functionName:
        "balanceOf",

      args: [
        fixture.D,
      ],
    });

  const recipientWeth =
    await publicClient.readContract({
      address:
        fixture.WETH,

      abi:
        artifacts.token.abi,

      functionName:
        "balanceOf",

      args: [
        accountRoles
          .recipientAllowed
          .address,
      ],
    });

  const allowance =
    await publicClient.readContract({
      address:
        fixture.USDC,

      abi:
        artifacts.token.abi,

      functionName:
        "allowance",

      args: [
        fixture.D,
        fixture.ROUTER,
      ],
    });

  assert(
    accountUsdc
      === 1_000_000_000_000n,
    `${scenarioId}/D account USDC did not roll back`,
  );

  assert(
    recipientWeth === 0n,
    `${scenarioId}/D recipient WETH did not roll back`,
  );

  assert(
    allowance === 0n,
    `${scenarioId}/D router allowance did not roll back`,
  );
}

export async function runPostconditionTracePreflight() {
  const artifacts =
    loadArtifacts();

  const accountRoles =
    roles();

  const plan =
    buildPilotPlan();

  validatePilotPlan(
    plan,
  );

  const rows =
    Object.keys(
      EXPECTED_CASES,
    ).map(
      (scenarioId) =>
        findDRow(
          plan,
          scenarioId,
        ),
    );

  const traceContext =
    loadTraceProvenanceContext();

  const sourceBuffer =
    readFileSync(
      CONTRACT_SOURCE_PATH,
    );

  const anvil =
    await startAnvil({
      stepsTracing:
        true,
    });

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
      of rows
    ) {
      const expected =
        EXPECTED_CASES[
          row.scenario_id
        ];

      const snapshot =
        await rawRpc(
          rpc,
          "evm_snapshot",
          [],
        );

      try {
        const transaction =
          await buildAdvancedPilotTransaction({
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

        const transactionHash =
          await agentWallet
            .sendTransaction({
              to:
                transaction.to,

              data:
                transaction.calldata,

              value:
                0n,

              gas:
                8_000_000n,
            });

        const receipt =
          await publicClient
            .waitForTransactionReceipt({
              hash:
                transactionHash,
            });

        diagnosticTransactions += 1;

        assert(
          receipt.status === "success",
          `${row.scenario_id}/D outer transaction reverted`,
        );

        const signals =
          extractDReceiptSignals({
            receipt,

            account:
              fixture.D,

            abi:
              artifacts.D.abi,
          });

        assert(
          signals.intentViolation
            === true,
          `${row.scenario_id}/D missing IntentViolation`,
        );

        assert(
          signals.intentExecuted
            === false,
          `${row.scenario_id}/D unexpectedly emitted IntentExecuted`,
        );

        assert(
          signals.executionFailed
            === false,
          `${row.scenario_id}/D unexpectedly emitted ExecutionFailed`,
        );

        const observedCode =
          Number(
            signals
              .intentViolationEvent
              .code,
          );

        assert(
          observedCode
            === expected.violationCode,
          `${row.scenario_id}/D violation code=${observedCode}, expected ${expected.violationCode}`,
        );

        await assertRollbackState({
          publicClient,
          fixture,
          artifacts,
          accountRoles,
          scenarioId:
            row.scenario_id,
        });

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
                  false,
              },
            ],
          );

        assert(
          trace
          && Array.isArray(
            trace.structLogs,
          )
          && trace.structLogs.length
            > 0,
          `${row.scenario_id}/D trace missing`,
        );

        const traversal =
          resolveTraceStage({
            structLogs:
              trace.structLogs,

            context:
              traceContext,

            expectedDepth:
              2,
          });

        assert(
          traversal.traceStage
            === "_validateOutcomes",
          `${row.scenario_id}/D did not traverse _validateOutcomes`,
        );

        const depth2Reverts =
          trace.structLogs
            .map(
              (entry, index) => ({
                entry,
                index,
              }),
            )
            .filter(
              ({ entry }) =>
                Number(entry.depth)
                  === 2
                && entry.op
                  === "REVERT",
            );

        assert(
          depth2Reverts.length
            >= 1,
          `${row.scenario_id}/D has no depth-2 REVERT`,
        );

        const terminalRevert =
          depth2Reverts[
            depth2Reverts.length - 1
          ];

        const nearest =
          nearestValidateOutcomesBeforeRevert({
            structLogs:
              trace.structLogs,

            revertIndex:
              terminalRevert.index,

            context:
              traceContext,
          });

        assert(
          nearest,
          `${row.scenario_id}/D has no _validateOutcomes source match before depth-2 REVERT`,
        );

        const snippet =
          sourceSnippet(
            sourceBuffer,
            nearest.sourceEntry,
          );

        /*
         * Frozen 2E.3C failure-associated provenance.
         *
         * A generic traversal through _validateOutcomes is
         * insufficient. The final depth-2 failure path must
         * reproduce the exact frozen compiler/source-map
         * coordinates discovered before measured execution.
         */
        assert(
          nearest.pc
            === expected.frozenTrace.pc,
          `${row.scenario_id}/D failure PC=${nearest.pc}, expected ${expected.frozenTrace.pc}`,
        );

        assert(
          nearest.op
            === expected.frozenTrace.op,
          `${row.scenario_id}/D failure op=${nearest.op}, expected ${expected.frozenTrace.op}`,
        );

        assert(
          nearest.depth2StepsToRevert
            === expected
              .frozenTrace
              .depth2StepsToRevert,
          `${row.scenario_id}/D depth-2 steps-to-revert=${nearest.depth2StepsToRevert}, expected ${expected.frozenTrace.depth2StepsToRevert}`,
        );

        assert(
          nearest.sourceEntry.start
            === expected
              .frozenTrace
              .sourceStart,
          `${row.scenario_id}/D source start=${nearest.sourceEntry.start}, expected ${expected.frozenTrace.sourceStart}`,
        );

        assert(
          nearest.sourceEntry.length
            === expected
              .frozenTrace
              .sourceLength,
          `${row.scenario_id}/D source length=${nearest.sourceEntry.length}, expected ${expected.frozenTrace.sourceLength}`,
        );

        assert(
          typeof snippet === "string"
          && snippet.includes(
            expected
              .frozenTrace
              .sourceNeedle,
          ),
          `${row.scenario_id}/D frozen failure source snippet mismatch`,
        );

        console.log(
          `${row.scenario_id}/D_TRANSACTION_HASH:`,
          transactionHash,
        );

        console.log(
          `${row.scenario_id}/D_VIOLATION_CODE:`,
          observedCode,
          expected.violationName,
        );

        console.log(
          `${row.scenario_id}/D_VALIDATE_OUTCOMES_MATCHES:`,
          traversal.matches.length,
        );

        console.log(
          `${row.scenario_id}/D_DEPTH2_REVERT_COUNT:`,
          depth2Reverts.length,
        );

        console.log(
          `${row.scenario_id}/D_NEAREST_VALIDATE_PC:`,
          nearest.pc,
        );

        console.log(
          `${row.scenario_id}/D_NEAREST_VALIDATE_OP:`,
          nearest.op,
        );

        console.log(
          `${row.scenario_id}/D_DEPTH2_STEPS_TO_REVERT:`,
          nearest.depth2StepsToRevert,
        );

        console.log(
          `${row.scenario_id}/D_SOURCE_START:`,
          nearest
            .sourceEntry
            .start,
        );

        console.log(
          `${row.scenario_id}/D_SOURCE_LENGTH:`,
          nearest
            .sourceEntry
            .length,
        );

        console.log(
          `${row.scenario_id}/D_SOURCE_SNIPPET:`,
          snippet,
        );

        console.log(
          `${row.scenario_id}/D_DIAGNOSTIC: PASS`,
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
          `${row.scenario_id}/D snapshot revert failed`,
        );
      }
    }

    assert(
      diagnosticTransactions === 2,
      `diagnostic tx count=${diagnosticTransactions}, expected 2`,
    );

    await verifyFixture({
      publicClient,
      artifacts,
      fixture,
      accountRoles,
    });

    console.log(
      "POSTCONDITION_TRACE_PREFLIGHT_CASES: 2",
    );

    console.log(
      "DIAGNOSTIC_TRANSACTIONS_EXECUTED: 2",
    );

    console.log(
      "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 0",
    );

    console.log(
      "PILOT_OBSERVATIONS_CREATED: 0",
    );

    console.log(
      "POSTCONDITION_FAILURE_PROVENANCE: PASS",
    );

    console.log(
      "POSTCONDITION_TRACE_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}
