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
  extractDReceiptSignals,
  extractReceiptMetadata,
  verifyStoredViolation,
} from "./paper-evidence.mjs";

import {
  classifyObservation,
} from "./paper-observation.mjs";

import {
  resolvePostconditionFailureEvidence,
} from "./paper-postcondition-trace-preflight.mjs";

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

function rpcResult(
  response,
  label,
) {
  if (
    response.error
  ) {
    fail(
      `${label}: ${JSON.stringify(response.error)}`,
    );
  }

  return response.result;
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

async function readTokenBalance({
  publicClient,
  artifacts,
  token,
  holder,
}) {
  return publicClient.readContract({
    address:
      token,

    abi:
      artifacts.token.abi,

    functionName:
      "balanceOf",

    args: [
      holder,
    ],
  });
}

async function readAllowance({
  publicClient,
  artifacts,
  token,
  owner,
  spender,
}) {
  return publicClient.readContract({
    address:
      token,

    abi:
      artifacts.token.abi,

    functionName:
      "allowance",

    args: [
      owner,
      spender,
    ],
  });
}

async function readNonceUsed({
  row,
  fixture,
  artifacts,
  publicClient,
}) {
  return publicClient.readContract({
    address:
      fixture[
        row.baseline
      ],

    abi:
      artifacts[
        row.baseline
      ].abi,

    functionName:
      "usedNonces",

    args: [
      BigInt(
        row.nonce,
      ),
    ],
  });
}

async function readDAgentState({
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

  return {
    registered:
      state[0],

    quarantined:
      state[1],

    strikes:
      BigInt(
        state[2],
      ),
  };
}

async function captureState({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  const account =
    fixture[
      row.baseline
    ];

  const [
    accountUsdc,
    allowedUsdc,
    thiefUsdc,
    allowedWeth,
    routerAllowance,
    unauthorizedSpenderAllowance,
    nonceUsed,
  ] =
    await Promise.all([
      readTokenBalance({
        publicClient,
        artifacts,
        token:
          fixture.USDC,
        holder:
          account,
      }),

      readTokenBalance({
        publicClient,
        artifacts,
        token:
          fixture.USDC,
        holder:
          accountRoles
            .recipientAllowed
            .address,
      }),

      readTokenBalance({
        publicClient,
        artifacts,
        token:
          fixture.USDC,
        holder:
          accountRoles
            .thief
            .address,
      }),

      readTokenBalance({
        publicClient,
        artifacts,
        token:
          fixture.WETH,
        holder:
          accountRoles
            .recipientAllowed
            .address,
      }),

      readAllowance({
        publicClient,
        artifacts,
        token:
          fixture.USDC,
        owner:
          account,
        spender:
          fixture.ROUTER,
      }),

      readAllowance({
        publicClient,
        artifacts,
        token:
          fixture.USDC,
        owner:
          account,
        spender:
          accountRoles
            .spenderUnauthorized
            .address,
      }),

      readNonceUsed({
        row,
        fixture,
        artifacts,
        publicClient,
      }),
    ]);

  const dAgent =
    row.baseline === "D"
      ? await readDAgentState({
          fixture,
          artifacts,
          accountRoles,
          publicClient,
        })
      : null;

  return {
    accountUsdc:
      BigInt(accountUsdc),

    allowedUsdc:
      BigInt(allowedUsdc),

    thiefUsdc:
      BigInt(thiefUsdc),

    allowedWeth:
      BigInt(allowedWeth),

    routerAllowance:
      BigInt(
        routerAllowance,
      ),

    unauthorizedSpenderAllowance:
      BigInt(
        unauthorizedSpenderAllowance,
      ),

    nonceUsed:
      nonceUsed === true,

    dAgent,
  };
}

function nonceAdvanced(
  pre,
  post,
) {
  return (
    pre.nonceUsed === false
    && post.nonceUsed === true
  );
}

function transferCommitted({
  pre,
  post,
  amount,
  recipientField,
}) {
  return (
    nonceAdvanced(
      pre,
      post,
    )
    && post.accountUsdc
      === pre.accountUsdc
        - amount
    && post[
      recipientField
    ] === pre[
      recipientField
    ] + amount
  );
}

function deriveFinalStateOk({
  row,
  pre,
  post,
}) {
  switch (
    row.scenario_id
  ) {
    case "PILOT-01":
      return transferCommitted({
        pre,
        post,

        amount:
          BigInt(
            row.parameters
              .amount,
          ),

        recipientField:
          "allowedUsdc",
      });

    case "PILOT-02":
      if (
        !["A", "B", "C"]
          .includes(
            row.baseline,
          )
      ) {
        return false;
      }

      return transferCommitted({
        pre,
        post,

        amount:
          BigInt(
            row.parameters
              .amount,
          ),

        recipientField:
          "thiefUsdc",
      });

    case "PILOT-03":
      if (
        row.baseline
          !== "A"
      ) {
        return false;
      }

      return transferCommitted({
        pre,
        post,

        amount:
          BigInt(
            row.parameters
              .amount,
          ),

        recipientField:
          "allowedUsdc",
      });

    case "PILOT-04":
      if (
        !["A", "C"]
          .includes(
            row.baseline,
          )
      ) {
        return false;
      }

      return (
        nonceAdvanced(
          pre,
          post,
        )
        && post
          .unauthorizedSpenderAllowance
          === BigInt(
            row.parameters
              .allowance_requested,
          )
      );

    case "PILOT-05":
      if (
        row.baseline
          !== "A"
      ) {
        return false;
      }

      return (
        nonceAdvanced(
          pre,
          post,
        )
        && post.accountUsdc
          === pre.accountUsdc
            - BigInt(
              row.parameters
                .amount,
            )
        && post.allowedWeth
          === pre.allowedWeth
            + BigInt(
              row.parameters
                .actual_out,
            )
        && post.routerAllowance
          === 0n
      );

    case "PILOT-08":
      if (
        !["A", "C"]
          .includes(
            row.baseline,
          )
      ) {
        return false;
      }

      return (
        nonceAdvanced(
          pre,
          post,
        )
        && post.routerAllowance
          === BigInt(
            row.parameters
              .ac_approval_amount,
          )
      );

    default:
      return false;
  }
}

function deriveRollbackVerified({
  row,
  pre,
  post,
}) {
  if (
    row.baseline
      !== "D"
  ) {
    return false;
  }

  switch (
    row.scenario_id
  ) {
    case "PILOT-02":
      return (
        post.accountUsdc
          === pre.accountUsdc
        && post.thiefUsdc
          === pre.thiefUsdc
      );

    case "PILOT-03":
      return (
        post.accountUsdc
          === pre.accountUsdc
        && post.allowedUsdc
          === pre.allowedUsdc
      );

    case "PILOT-04":
      return (
        post
          .unauthorizedSpenderAllowance
          === pre
            .unauthorizedSpenderAllowance
      );

    case "PILOT-05":
    case "PILOT-08":
      return (
        post.accountUsdc
          === pre.accountUsdc
        && post.allowedWeth
          === pre.allowedWeth
        && post.routerAllowance
          === pre.routerAllowance
      );

    case "PILOT-09":
      return (
        post.accountUsdc
          === pre.accountUsdc
        && post.thiefUsdc
          === pre.thiefUsdc
      );

    default:
      return false;
  }
}

async function recoverRevertEvidence({
  row,
  transaction,
  result,
  accountRoles,
  artifacts,
  rpc,
}) {
  assert(
    result.receipt.status
      === "reverted",
    `${row.scenario_id}/${row.baseline}: revert recovery requested for non-reverted transaction`,
  );

  const parentBlock =
    result.receipt.blockNumber
    - 1n;

  const response =
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
    response.error,
    `${row.scenario_id}/${row.baseline}: parent-state eth_call unexpectedly succeeded`,
  );

  const revertData =
    extractRevertData(
      response.error,
    );

  assert(
    typeof revertData
      === "string"
    && revertData
      .startsWith("0x")
    && revertData.length
      >= 10,
    `${row.scenario_id}/${row.baseline}: revert data unavailable`,
  );

  return decodeObservedError({
    baseline:
      row.baseline,

    data:
      revertData,

    artifacts,
  });
}

function emptyDecodedError() {
  return {
    errorName:
      null,

    errorArgs:
      null,

    errorSelector:
      null,

    revertHash:
      null,
  };
}

function assertClassification({
  row,
  classification,
}) {
  const label =
    `${row.scenario_id}/${row.baseline}`;

  assert(
    classification
      .actual_verdict
      === row
        .expected_verdict,
    `${label}: verdict=${classification.actual_verdict}, expected ${row.expected_verdict}`,
  );

  assert(
    classification
      .failure_class
      === row
        .expected_reason_class,
    `${label}: failure_class=${classification.failure_class}, expected ${row.expected_reason_class}`,
  );

  assert(
    classification
      .reason_code
      === row
        .expected_reason_code,
    `${label}: reason_code=${classification.reason_code}, expected ${row.expected_reason_code}`,
  );
}

export const OBSERVATION_EXECUTION_ROLES =
  Object.freeze({
    DIAGNOSTIC:
      "DIAGNOSTIC",

    MEASURED_PILOT:
      "MEASURED_PILOT",
  });

async function runObservationIntegration({
  executionRole,
  onObservation = null,
}) {
  assert(
    Object.values(
      OBSERVATION_EXECUTION_ROLES,
    ).includes(
      executionRole,
    ),
    `unsupported observation execution role ${executionRole}`,
  );

  const strictExpected =
    executionRole
      === OBSERVATION_EXECUTION_ROLES
        .DIAGNOSTIC;

  assert(
    onObservation === null
    || typeof onObservation
      === "function",
    "onObservation must be null or a function",
  );

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
    `applicable observation rows=${selected.length}, expected 27`,
  );

  const anvil =
    await startAnvil({
      stepsTracing:
        true,
    });

  let observationTransactions =
    0;

  let prerequisiteTransactions =
    0;

  let classifiedAllow =
    0;

  let classifiedReject =
    0;

  let unclassifiedCount =
    0;

  let revertEvidenceCount =
    0;

  let storedViolationCount =
    0;

  let postconditionTraceCount =
    0;

  const observationRecords = [];

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

      const snapshotResponse =
        await rawRpc(
          rpc,
          "evm_snapshot",
          [],
        );

      const snapshot =
        rpcResult(
          snapshotResponse,
          `${label}: evm_snapshot`,
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

        const pre =
          await captureState({
            row,
            fixture,
            artifacts,
            accountRoles,
            publicClient,
          });

        const timestampResponse =
          await rawRpc(
            rpc,
            "evm_setNextBlockTimestamp",
            [
              row.measured_timestamp,
            ],
          );

        rpcResult(
          timestampResponse,
          `${label}: measured timestamp`,
        );

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

        observationTransactions += 1;

        const post =
          await captureState({
            row,
            fixture,
            artifacts,
            accountRoles,
            publicClient,
          });

        const receiptMeta =
          extractReceiptMetadata(
            result.receipt,
          );

        const dSignals =
          row.baseline === "D"
            ? extractDReceiptSignals({
                receipt:
                  result.receipt,

                account:
                  fixture.D,

                abi:
                  artifacts.D.abi,
              })
            : {
                intentExecuted:
                  false,

                intentViolation:
                  false,

                executionFailed:
                  false,

                intentExecutedEvent:
                  null,

                intentViolationEvent:
                  null,

                executionFailedEvent:
                  null,
              };

        let storedViolation =
          false;

        let storedViolationResult =
          null;

        if (
          dSignals
            .intentViolation
        ) {
          storedViolationResult =
            await verifyStoredViolation({
              publicClient,

              account:
                fixture.D,

              abi:
                artifacts.D.abi,

              event:
                dSignals
                  .intentViolationEvent,
            });

          storedViolation =
            storedViolationResult
              .storedViolation;

          if (
            strictExpected
          ) {
            assert(
              storedViolation === true,
              `${label}: durable violation record missing or mismatched`,
            );
          }

          if (
            storedViolation
          ) {
            storedViolationCount += 1;
          }
        }

        const rollbackVerified =
          deriveRollbackVerified({
            row,
            pre,
            post,
          });

        if (
          dSignals
            .intentViolation
          && strictExpected
        ) {
          assert(
            rollbackVerified
              === true,
            `${label}: policy violation did not prove rollback`,
          );

          assert(
            post.nonceUsed
              === true,
            `${label}: durable policy violation did not consume measured nonce`,
          );

          assert(
            pre.dAgent
            && post.dAgent,
            `${label}: D agent state missing`,
          );

          assert(
            post.dAgent.strikes
              === pre.dAgent.strikes
                + 1n,
            `${label}: strike count did not increase exactly once`,
          );

          assert(
            post.dAgent.quarantined
              === dSignals
                .intentViolationEvent
                .quarantined,
            `${label}: agent quarantine state disagrees with IntentViolation`,
          );
        }

        let traceEvidence =
          null;

        if (
          row.validation_provenance
            === "TRACE_REQUIRED_FOR_POSTCONDITION"
        ) {
          if (
            dSignals
              .intentViolation
              === true
          ) {
            const traceCandidate =
              await resolvePostconditionFailureEvidence({
                rpc,

                transactionHash:
                  result
                    .transactionHash,

                scenarioId:
                  row.scenario_id,
              });

            const traceMatchesEvent =
              Number(
                dSignals
                  .intentViolationEvent
                  .code,
              )
              === traceCandidate
                .violationCode;

            if (
              strictExpected
            ) {
              assert(
                traceMatchesEvent,
                `${label}: IntentViolation code disagrees with frozen failure trace`,
              );
            }

            if (
              traceMatchesEvent
            ) {
              traceEvidence =
                traceCandidate;

              postconditionTraceCount += 1;
            }
          } else if (
            strictExpected
          ) {
            fail(
              `${label}: postcondition trace requested without IntentViolation`,
            );
          }
        }

        let decoded =
          emptyDecodedError();

        if (
          result.receipt.status
            === "reverted"
        ) {
          decoded =
            await recoverRevertEvidence({
              row,
              transaction,
              result,
              accountRoles,
              artifacts,
              rpc,
            });

          if (
            strictExpected
          ) {
            assert(
              typeof decoded
                .errorName
                === "string",
              `${label}: reverted transaction has no decoded error name`,
            );
          }

          if (
            decoded.revertHash
              !== null
          ) {
            revertEvidenceCount += 1;
          }

          if (
            strictExpected
          ) {
            assert(
              post.nonceUsed
                === pre.nonceUsed,
              `${label}: reverted transaction changed account nonce state`,
            );
          }
        }

        const finalStateOk =
          deriveFinalStateOk({
            row,
            pre,
            post,
          });

        const observation = {
          applicability:
            row.applicability,

          baseline:
            row.baseline,

          outerReceiptStatus:
            receiptMeta
              .outerReceiptStatus,

          intentExecuted:
            dSignals
              .intentExecuted,

          intentViolation:
            dSignals
              .intentViolation,

          executionFailed:
            dSignals
              .executionFailed,

          storedViolation,

          rollbackVerified,

          traceStage:
            traceEvidence
              ?.traceStage
            ?? null,

          postconditionFailureTrace:
            traceEvidence
              ?.postconditionFailureTrace
            ?? false,

          errorName:
            decoded
              .errorName,

          nonceUsedBefore:
            pre.nonceUsed,

          finalStateOk,

          targetFailureProvenance:
            false,
        };

        const classification =
          classifyObservation(
            observation,
          );

        if (
          strictExpected
        ) {
          assertClassification({
            row,
            classification,
          });
        }

        if (
          classification
            .actual_verdict
            === "ALLOW"
        ) {
          classifiedAllow += 1;
        } else if (
          classification
            .actual_verdict
            === "REJECT"
        ) {
          classifiedReject += 1;
        } else if (
          strictExpected
        ) {
          fail(
            `${label}: unexpected applicable verdict ${classification.actual_verdict}`,
          );
        } else {
          /*
           * The measured pilot must retain an unexpected or
           * insufficient-evidence observation rather than censoring
           * it because it did not fit the preregistered expectation.
           */
          unclassifiedCount += 1;
        }

        const observationRecord = {
          executionRole,

          planRow:
            row,

          transaction,

          fixture,

          addresses: {
            owner:
              accountRoles.owner.address,

            agent:
              accountRoles.agent.address,

            submitter:
              accountRoles.agent.address,

            recipientAllowed:
              accountRoles
                .recipientAllowed
                .address,

            thief:
              accountRoles
                .thief
                .address,

            spenderAllowed:
              accountRoles
                .spenderAllowed
                .address,

            spenderUnauthorized:
              accountRoles
                .spenderUnauthorized
                .address,
          },

          pre,
          post,
          receiptMeta,
          dSignals,
          storedViolationResult,
          rollbackVerified,
          traceEvidence,
          decoded,
          finalStateOk,
          classification,

          result: {
            transactionHash:
              result.transactionHash,

            executionTimeNs:
              result.executionTimeNs,

            executionTimeMs:
              result.executionTimeMs,
          },
        };

        observationRecords.push(
          observationRecord,
        );

        /*
         * Measured mode may journal each completed observation
         * immediately. Diagnostic mode leaves this null.
         */
        if (
          onObservation !== null
        ) {
          await onObservation(
            observationRecord,
          );
        }

        console.log(
          [
            label,
            `receipt=${result.receipt.status}`,
            `verdict=${classification.actual_verdict}`,
            `class=${classification.failure_class}`,
            `reason=${classification.reason_code ?? "null"}`,
            `nonceBefore=${pre.nonceUsed}`,
            `nonceAfter=${post.nonceUsed}`,
            `rollback=${rollbackVerified}`,
            `storedViolation=${storedViolation}`,
            `postTrace=${traceEvidence?.postconditionFailureTrace ?? false}`,
            strictExpected
              ? "CLASSIFICATION_PASS"
              : "OBSERVATION_RECORDED",
          ].join(" "),
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
          `${label}: evm_revert RPC failed`,
        );

        assert(
          revertResponse.result
            === true,
          `${label}: row snapshot revert failed`,
        );
      }
    }

    assert(
      observationTransactions
        === 27,
      `diagnostic observation tx count=${observationTransactions}, expected 27`,
    );

    assert(
      prerequisiteTransactions
        === 9,
      `diagnostic prerequisite tx count=${prerequisiteTransactions}, expected 9`,
    );

    if (
      strictExpected
    ) {
      assert(
        classifiedAllow === 13,
        `ALLOW classifications=${classifiedAllow}, expected 13`,
      );

      assert(
        classifiedReject === 14,
        `REJECT classifications=${classifiedReject}, expected 14`,
      );

      assert(
        revertEvidenceCount === 8,
        `revert evidence count=${revertEvidenceCount}, expected 8`,
      );

      assert(
        storedViolationCount === 6,
        `stored violation count=${storedViolationCount}, expected 6`,
      );

      assert(
        postconditionTraceCount === 2,
        `postcondition failure trace count=${postconditionTraceCount}, expected 2`,
      );

      assert(
        unclassifiedCount === 0,
        `diagnostic unclassified count=${unclassifiedCount}, expected 0`,
      );
    }

    assert(
      classifiedAllow
        + classifiedReject
        + unclassifiedCount
        === 27,
      `accounted observations=${
        classifiedAllow
        + classifiedReject
        + unclassifiedCount
      }, expected 27`,
    );

    await verifyFixture({
      publicClient,
      artifacts,
      fixture,
      accountRoles,
    });

    console.log(
      "OBSERVATION_INTEGRATION_APPLICABLE_ROWS: 27",
    );

    if (
      strictExpected
    ) {
      console.log(
        "OBSERVATION_INTEGRATION_ALLOW: 13",
      );

      console.log(
        "OBSERVATION_INTEGRATION_REJECT: 14",
      );

      console.log(
        "OBSERVATION_INTEGRATION_REVERT_EVIDENCE: 8",
      );

      console.log(
        "OBSERVATION_INTEGRATION_STORED_VIOLATIONS: 6",
      );

      console.log(
        "OBSERVATION_INTEGRATION_POSTCONDITION_TRACES: 2",
      );

      console.log(
        "OBSERVATION_EXPECTED_VERDICT_MATCH: PASS",
      );

      console.log(
        "OBSERVATION_EXPECTED_FAILURE_CLASS_MATCH: PASS",
      );

      console.log(
        "OBSERVATION_EXPECTED_REASON_CODE_MATCH: PASS",
      );

      console.log(
        "POSTCONDITION_TRACE_DERIVED_NOT_ASSERTED: PASS",
      );
    }

    console.log(
      "ROW_LEVEL_PRISTINE_SNAPSHOT_REVERSION: PASS",
    );

    if (
      strictExpected
    ) {
      console.log(
        "DIAGNOSTIC_PREREQUISITE_TRANSACTIONS_EXECUTED: 9",
      );

      console.log(
        "DIAGNOSTIC_OBSERVATION_TRANSACTIONS_EXECUTED: 27",
      );

      console.log(
        "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 0",
      );

      console.log(
        "PILOT_OBSERVATIONS_CREATED: 0",
      );

      console.log(
        "OBSERVATION_INTEGRATION_PREFLIGHT_PASS",
      );
    } else {
      console.log(
        `MEASURED_OBSERVATION_ALLOW: ${classifiedAllow}`,
      );

      console.log(
        `MEASURED_OBSERVATION_REJECT: ${classifiedReject}`,
      );

      console.log(
        `MEASURED_OBSERVATION_REVERT_EVIDENCE: ${revertEvidenceCount}`,
      );

      console.log(
        `MEASURED_OBSERVATION_STORED_VIOLATIONS: ${storedViolationCount}`,
      );

      console.log(
        `MEASURED_OBSERVATION_POSTCONDITION_TRACES: ${postconditionTraceCount}`,
      );

      console.log(
        `MEASURED_OBSERVATION_UNCLASSIFIED: ${unclassifiedCount}`,
      );

      console.log(
        "EXCLUDED_PREREQUISITE_TRANSACTIONS_EXECUTED: 9",
      );

      console.log(
        "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 27",
      );

      console.log(
        "MEASURED_OBSERVATIONS_COLLECTED_IN_MEMORY: 27",
      );

      console.log(
        "PILOT_OBSERVATIONS_PERSISTED: 0",
      );

      console.log(
        "MEASURED_OBSERVATION_COLLECTION_IN_MEMORY_ONLY: PASS",
      );
    }

    return observationRecords;
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}

export async function runObservationIntegrationPreflight() {
  return runObservationIntegration({
    executionRole:
      OBSERVATION_EXECUTION_ROLES
        .DIAGNOSTIC,
  });
}

/*
 * Reserved exclusively for the future immutable --output writer.
 *
 * Do not expose this through paper-pilot.mjs as a standalone CLI command.
 * Calling this function constitutes the designated measured pilot run.
 */
export async function collectMeasuredPilotObservationsForWriter({
  onObservation = null,
} = {}) {
  return runObservationIntegration({
    executionRole:
      OBSERVATION_EXECUTION_ROLES
        .MEASURED_PILOT,

    onObservation,
  });
}
