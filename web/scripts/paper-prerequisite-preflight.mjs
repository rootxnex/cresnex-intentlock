import {
  createWalletClient,
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

import {
  buildPilotPlan,
  validatePilotPlan,
} from "./paper-scenario-plan.mjs";

import {
  buildSimplePilotTransaction,
} from "./paper-transaction-builders.mjs";

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

function hexEqual(
  left,
  right,
) {
  return (
    typeof left === "string"
    && typeof right === "string"
    && left.toLowerCase()
      === right.toLowerCase()
  );
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

async function setNextTimestamp(
  rpc,
  timestamp,
) {
  await rawRpc(
    rpc,
    "evm_setNextBlockTimestamp",
    [timestamp],
  );
}

async function signChecked({
  owner,
  digest,
  label,
}) {
  const signature =
    await owner.sign({
      hash:
        digest,
    });

  const recovered =
    await recoverAddress({
      hash:
        digest,

      signature,
    });

  assert(
    recovered.toLowerCase()
      === owner.address.toLowerCase(),
    `${label}: signer recovery mismatch`,
  );

  return signature;
}

function buildApprovalData({
  artifacts,
  spender,
  amount,
}) {
  return encodeFunctionData({
    abi:
      artifacts.token.abi,

    functionName:
      "approve",

    args: [
      spender,
      amount,
    ],
  });
}

function buildTransferData({
  artifacts,
  recipient,
  amount,
}) {
  return encodeFunctionData({
    abi:
      artifacts.token.abi,

    functionName:
      "transfer",

    args: [
      recipient,
      amount,
    ],
  });
}

async function buildAPrerequisiteApproval({
  row,
  nonce,
  amount,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  const validUntil =
    BigInt(
      row.parameters.valid_until,
    );

  const digest =
    await publicClient.readContract({
      address:
        fixture.A,

      abi:
        artifacts.A.abi,

      functionName:
        "authorizationHash",

      args: [
        accountRoles.agent.address,
        nonce,
        validUntil,
      ],
    });

  const signature =
    await signChecked({
      owner:
        accountRoles.owner,

      digest,

      label:
        "PILOT-05/A prerequisite",
    });

  const innerData =
    buildApprovalData({
      artifacts,

      spender:
        fixture.ROUTER,

      amount,
    });

  const calldata =
    encodeFunctionData({
      abi:
        artifacts.A.abi,

      functionName:
        "execute",

      args: [
        fixture.USDC,
        0n,
        innerData,
        nonce,
        validUntil,
        signature,
      ],
    });

  return {
    to:
      fixture.A,

    calldata,

    nonce,
  };
}

function buildTransferPolicy({
  fixture,
  recipient,
  maximum,
}) {
  const selector =
    toFunctionSelector(
      "transfer(address,uint256)",
    );

  return {
    module:
      PolicyModule.Transfer,

    assets: [
      {
        token:
          fixture.USDC,

        maxSpend:
          maximum,

        recipient,

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

    moduleData:
      encodeAbiParameters(
        parseAbiParameters(
          "address,address,uint256,bool,address,bytes4",
        ),
        [
          fixture.USDC,
          recipient,
          maximum,
          false,
          fixture.USDC,
          selector,
        ],
      ),
  };
}

async function buildDTransferPrerequisite({
  row,
  nonce,
  executedRecipient,
  policyRecipient,
  amount,
  maximum,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
  label,
}) {
  const calls = [
    {
      target:
        fixture.USDC,

      value:
        0n,

      data:
        buildTransferData({
          artifacts,

          recipient:
            executedRecipient,

          amount,
        }),

      operation:
        0,
    },
  ];

  const policy =
    buildTransferPolicy({
      fixture,

      recipient:
        policyRecipient,

      maximum,
    });

  const callsHashContract =
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

  const callsHashJs =
    hashCallsV2(
      calls,
    );

  assert(
    hexEqual(
      callsHashContract,
      callsHashJs,
    ),
    `${label}: calls hash mismatch`,
  );

  const policyHashContract =
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

  const policyHashJs =
    hashPolicyV2(
      policy,
    );

  assert(
    hexEqual(
      policyHashContract,
      policyHashJs,
    ),
    `${label}: policy hash mismatch`,
  );

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

    callsHash:
      callsHashContract,

    policyHash:
      policyHashContract,

    nonce,

    validAfter:
      Number(
        row.parameters.valid_after,
      ),

    validUntil:
      Number(
        row.parameters.valid_until,
      ),

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

  const signature =
    await signChecked({
      owner:
        accountRoles.owner,

      digest,

      label,
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
        signature,
      ],
    });

  return {
    to:
      fixture.D,

    calldata,

    nonce,

    digest,

    manifest,

    calls,

    policy,
  };
}

async function sendExcludedTransaction({
  walletClient,
  publicClient,
  transaction,
  label,
}) {
  const hash =
    await walletClient.sendTransaction({
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
        hash,
      });

  assert(
    receipt.status === "success",
    `${label}: outer transaction reverted`,
  );

  return receipt;
}

async function readUsedNonce({
  publicClient,
  address,
  abi,
  nonce,
}) {
  return publicClient.readContract({
    address,
    abi,
    functionName:
      "usedNonces",
    args: [
      nonce,
    ],
  });
}

async function readAgentState({
  publicClient,
  fixture,
  artifacts,
  accountRoles,
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
        accountRoles.agent.address,
      ],
    });

  return {
    registered:
      state[0],

    quarantined:
      state[1],

    strikes:
      state[2],
  };
}

async function withFixtureSnapshot({
  rpc,
  operation,
}) {
  const snapshot =
    await rawRpc(
      rpc,
      "evm_snapshot",
      [],
    );

  try {
    return await operation();
  } finally {
    const reverted =
      await rawRpc(
        rpc,
        "evm_revert",
        [snapshot],
      );

    assert(
      reverted === true,
      "fixture snapshot revert failed",
    );
  }
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

export async function runPrerequisitePreflight() {
  const artifacts =
    loadArtifacts();

  const accountRoles =
    roles();

  const plan =
    buildPilotPlan();

  validatePilotPlan(
    plan,
  );

  const p05a =
    findRow(
      plan,
      "PILOT-05",
      "A",
    );

  const p07Rows =
    ["A", "B", "C", "D"]
      .map(
        (baseline) =>
          findRow(
            plan,
            "PILOT-07",
            baseline,
          ),
      );

  const p09d =
    findRow(
      plan,
      "PILOT-09",
      "D",
    );

  const p10d =
    findRow(
      plan,
      "PILOT-10",
      "D",
    );

  const anvil =
    await startAnvil();

  let diagnosticTxCount =
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

    /*
     * PILOT-05/A:
     * excluded approval prerequisite.
     */
    await withFixtureSnapshot({
      rpc,

      operation:
        async () => {
          const prerequisite =
            p05a
              .prerequisite_parameters;

          assert(
            prerequisite
              .action
              === "USDC_APPROVE_ROUTER",
            "PILOT-05/A prerequisite action mismatch",
          );

          assert(
            prerequisite.measured
              === false,
            "PILOT-05/A prerequisite must be excluded",
          );

          const nonce =
            BigInt(
              prerequisite.nonce,
            );

          const amount =
            BigInt(
              prerequisite.amount,
            );

          const tx =
            await buildAPrerequisiteApproval({
              row:
                p05a,

              nonce,

              amount,
              fixture,
              artifacts,
              accountRoles,
              publicClient,
            });

          await setNextTimestamp(
            rpc,
            prerequisite.timestamp,
          );

          await sendExcludedTransaction({
            walletClient:
              agentWallet,

            publicClient,

            transaction:
              tx,

            label:
              "PILOT-05/A prerequisite",
          });

          diagnosticTxCount += 1;

          const allowance =
            await publicClient.readContract({
              address:
                fixture.USDC,

              abi:
                artifacts.token.abi,

              functionName:
                "allowance",

              args: [
                fixture.A,
                fixture.ROUTER,
              ],
            });

          assert(
            allowance === amount,
            `PILOT-05/A allowance=${allowance}, expected ${amount}`,
          );

          assert(
            await readUsedNonce({
              publicClient,

              address:
                fixture.A,

              abi:
                artifacts.A.abi,

              nonce,
            }) === true,
            "PILOT-05/A prerequisite nonce not consumed",
          );

          assert(
            await readUsedNonce({
              publicClient,

              address:
                fixture.A,

              abi:
                artifacts.A.abi,

              nonce:
                700005n,
            }) === false,
            "PILOT-05/A measured nonce consumed by prerequisite",
          );

          console.log(
            "PILOT-05/A_PREREQUISITE: PASS",
          );
        },
    });

    /*
     * PILOT-07:
     * execute the exact already-built package once.
     * The future measured replay must reuse this package.
     */
    for (
      const row
      of p07Rows
    ) {
      await withFixtureSnapshot({
        rpc,

        operation:
          async () => {
            const prerequisite =
              row.prerequisite_parameters;

            assert(
              prerequisite.action
                === "PRIOR_IDENTICAL_SUCCESS",
              `${row.baseline}: P07 prerequisite action mismatch`,
            );

            assert(
              prerequisite.nonce
                === row.nonce,
              `${row.baseline}: P07 prerequisite nonce differs from measured nonce`,
            );

            const transaction =
              await buildSimplePilotTransaction({
                row,
                fixture,
                artifacts,
                accountRoles,
                publicClient,
              });

            await setNextTimestamp(
              rpc,
              prerequisite.timestamp,
            );

            await sendExcludedTransaction({
              walletClient:
                agentWallet,

              publicClient,

              transaction,

              label:
                `PILOT-07/${row.baseline} prerequisite`,
            });

            diagnosticTxCount += 1;

            assert(
              await readUsedNonce({
                publicClient,

                address:
                  fixture[row.baseline],

                abi:
                  artifacts[
                    row.baseline
                  ].abi,

                nonce:
                  700007n,
              }) === true,
              `PILOT-07/${row.baseline}: nonce 700007 not consumed`,
            );

            console.log(
              `PILOT-07/${row.baseline}_PRIOR_IDENTICAL_SUCCESS: PASS`,
            );
          },
      });
    }

    /*
     * PILOT-09/D:
     * two authenticated policy violations.
     */
    await withFixtureSnapshot({
      rpc,

      operation:
        async () => {
          const prerequisite =
            p09d
              .prerequisite_parameters;

          assert(
            prerequisite
              .action
              === "TWO_AUTHENTICATED_POLICY_VIOLATIONS",
            "PILOT-09/D prerequisite action mismatch",
          );

          assert(
            prerequisite.nonces.length
              === 2
            && prerequisite.timestamps.length
              === 2,
            "PILOT-09/D prerequisite cardinality mismatch",
          );

          for (
            let index = 0;
            index < 2;
            index += 1
          ) {
            const nonce =
              BigInt(
                prerequisite
                  .nonces[index],
              );

            const transaction =
              await buildDTransferPrerequisite({
                row:
                  p09d,

                nonce,

                executedRecipient:
                  accountRoles
                    .thief
                    .address,

                policyRecipient:
                  accountRoles
                    .recipientAllowed
                    .address,

                amount:
                  BigInt(
                    p09d.parameters
                      .violation_amount,
                  ),

                maximum:
                  BigInt(
                    p09d.parameters
                      .violation_max_spend,
                  ),

                fixture,
                artifacts,
                accountRoles,
                publicClient,

                label:
                  `PILOT-09/D prerequisite ${index + 1}`,
              });

            await setNextTimestamp(
              rpc,
              prerequisite
                .timestamps[index],
            );

            await sendExcludedTransaction({
              walletClient:
                agentWallet,

              publicClient,

              transaction,

              label:
                `PILOT-09/D prerequisite ${index + 1}`,
            });

            diagnosticTxCount += 1;

            const state =
              await readAgentState({
                publicClient,
                fixture,
                artifacts,
                accountRoles,
              });

            assert(
              state.strikes
                === BigInt(
                  index + 1,
                ),
              `PILOT-09/D strikes=${state.strikes}, expected ${index + 1}`,
            );

            assert(
              state.quarantined
                === false,
              "PILOT-09/D quarantined before third violation",
            );

            assert(
              await readUsedNonce({
                publicClient,

                address:
                  fixture.D,

                abi:
                  artifacts.D.abi,

                nonce,
              }) === true,
              `PILOT-09/D prerequisite nonce ${nonce} not consumed`,
            );
          }

          assert(
            await readUsedNonce({
              publicClient,

              address:
                fixture.D,

              abi:
                artifacts.D.abi,

              nonce:
                700009n,
            }) === false,
            "PILOT-09/D measured nonce consumed during prerequisites",
          );

          console.log(
            "PILOT-09/D_TWO_PRIOR_VIOLATIONS: PASS",
          );
        },
    });

    /*
     * PILOT-10/D:
     * owner threshold setup + one authenticated violation.
     */
    await withFixtureSnapshot({
      rpc,

      operation:
        async () => {
          const prerequisite =
            p10d
              .prerequisite_parameters;

          assert(
            prerequisite
              .action
              === "ONE_AUTHENTICATED_POLICY_VIOLATION",
            "PILOT-10/D prerequisite action mismatch",
          );

          assert(
            prerequisite.threshold
              === 1,
            "PILOT-10/D threshold mismatch",
          );

          const thresholdData =
            encodeFunctionData({
              abi:
                artifacts.D.abi,

              functionName:
                "setQuarantineThreshold",

              args: [
                1n,
              ],
            });

          const thresholdHash =
            await ownerWallet.sendTransaction({
              to:
                fixture.D,

              data:
                thresholdData,

              gas:
                1_000_000n,
            });

          const thresholdReceipt =
            await publicClient
              .waitForTransactionReceipt({
                hash:
                  thresholdHash,
              });

          assert(
            thresholdReceipt.status
              === "success",
            "PILOT-10/D threshold prerequisite failed",
          );

          diagnosticTxCount += 1;

          const threshold =
            await publicClient.readContract({
              address:
                fixture.D,

              abi:
                artifacts.D.abi,

              functionName:
                "quarantineThreshold",
            });

          assert(
            threshold === 1n,
            `PILOT-10/D threshold=${threshold}, expected 1`,
          );

          assert(
            p10d.parameters
              .prerequisite_amount
              === p09d.parameters
                .violation_amount
            && p10d.parameters
              .prerequisite_max_spend
              === p09d.parameters
                .violation_max_spend,
            "PILOT-10/D prerequisite no longer matches frozen P09 violation shape",
          );

          const nonce =
            BigInt(
              prerequisite.nonce,
            );

          const transaction =
            await buildDTransferPrerequisite({
              row:
                p10d,

              nonce,

              executedRecipient:
                accountRoles
                  .thief
                  .address,

              policyRecipient:
                accountRoles
                  .recipientAllowed
                  .address,

              amount:
                BigInt(
                  p10d.parameters
                    .prerequisite_amount,
                ),

              maximum:
                BigInt(
                  p10d.parameters
                    .prerequisite_max_spend,
                ),

              fixture,
              artifacts,
              accountRoles,
              publicClient,

              label:
                "PILOT-10/D prerequisite violation",
            });

          await setNextTimestamp(
            rpc,
            prerequisite.timestamp,
          );

          await sendExcludedTransaction({
            walletClient:
              agentWallet,

            publicClient,

            transaction,

            label:
              "PILOT-10/D prerequisite violation",
          });

          diagnosticTxCount += 1;

          const state =
            await readAgentState({
              publicClient,
              fixture,
              artifacts,
              accountRoles,
            });

          assert(
            state.strikes === 1n,
            `PILOT-10/D strikes=${state.strikes}, expected 1`,
          );

          assert(
            state.quarantined
              === true,
            "PILOT-10/D agent not quarantined after prerequisite",
          );

          assert(
            await readUsedNonce({
              publicClient,

              address:
                fixture.D,

              abi:
                artifacts.D.abi,

              nonce,
            }) === true,
            "PILOT-10/D prerequisite nonce not consumed",
          );

          assert(
            await readUsedNonce({
              publicClient,

              address:
                fixture.D,

              abi:
                artifacts.D.abi,

              nonce:
                700010n,
            }) === false,
            "PILOT-10/D measured nonce consumed during prerequisite",
          );

          console.log(
            "PILOT-10/D_QUARANTINE_PREREQUISITE: PASS",
          );
        },
    });

    assert(
      diagnosticTxCount === 9,
      `diagnostic prerequisite tx count=${diagnosticTxCount}, expected 9`,
    );

    /*
     * Every diagnostic case reverted its snapshot.
     * Confirm the base fixture is pristine.
     */
    await verifyFixture({
      publicClient,
      artifacts,
      fixture,
      accountRoles,
    });

    console.log(
      "PREREQUISITE_CASES: 7",
    );

    console.log(
      "DIAGNOSTIC_PREREQUISITE_TRANSACTIONS_EXECUTED: 9",
    );

    console.log(
      "PREREQUISITE_STATE_ASSERTIONS: PASS",
    );

    console.log(
      "PREREQUISITE_SNAPSHOT_REVERSION: PASS",
    );

    console.log(
      "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 0",
    );

    console.log(
      "PILOT_OBSERVATIONS_CREATED: 0",
    );

    console.log(
      "PREREQUISITE_EXECUTION_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}
