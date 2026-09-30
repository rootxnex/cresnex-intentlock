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

const ADVANCED_SCENARIOS =
  new Set([
    "PILOT-05",
    "PILOT-06",
    "PILOT-08",
    "PILOT-09",
    "PILOT-10",
  ]);

const ROUTER_BEHAVIOR =
  Object.freeze({
    Valid: 0,
    InsufficientOutput: 2,
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

function buildSwapData({
  artifacts,
  fixture,
  inputAmount,
  outputAmount,
  recipient,
  behavior,
}) {
  return encodeFunctionData({
    abi:
      artifacts.router.abi,

    functionName:
      "swap",

    args: [
      fixture.USDC,
      fixture.WETH,
      inputAmount,
      outputAmount,
      recipient,
      behavior,
    ],
  });
}

async function buildAGenericCall({
  row,
  target,
  innerData,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  const nonce =
    BigInt(row.nonce);

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
        `${row.scenario_id}/A`,
    });

  const calldata =
    encodeFunctionData({
      abi:
        artifacts.A.abi,

      functionName:
        "execute",

      args: [
        target,
        0n,
        innerData,
        nonce,
        validUntil,
        signature,
      ],
    });

  return {
    scenarioId:
      row.scenario_id,

    baseline:
      "A",

    from:
      accountRoles.agent.address,

    to:
      fixture.A,

    nonce,

    digest,

    signature,

    calldata,

    target,

    innerData,
  };
}

async function buildCGenericPath({
  row,
  target,
  selector,
  maximum,
  innerData,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  const nonce =
    BigInt(row.nonce);

  const validUntil =
    BigInt(
      row.parameters.valid_until,
    );

  const digest =
    await publicClient.readContract({
      address:
        fixture.C,

      abi:
        artifacts.C.abi,

      functionName:
        "authorizationHash",

      args: [
        accountRoles.agent.address,
        target,
        selector,
        maximum,
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
        `${row.scenario_id}/C`,
    });

  const calldata =
    encodeFunctionData({
      abi:
        artifacts.C.abi,

      functionName:
        "execute",

      args: [
        target,
        innerData,
        selector,
        maximum,
        nonce,
        validUntil,
        signature,
      ],
    });

  return {
    scenarioId:
      row.scenario_id,

    baseline:
      "C",

    from:
      accountRoles.agent.address,

    to:
      fixture.C,

    nonce,

    digest,

    signature,

    calldata,

    target,

    selector,

    maximum,

    innerData,
  };
}

function buildSwapPolicy({
  fixture,
  accountRoles,
  maxInput,
  minOutput,
  allowanceCap,
}) {
  return {
    module:
      PolicyModule.Swap,

    assets: [
      {
        token:
          fixture.USDC,

        maxSpend:
          maxInput,

        recipient:
          fixture.D,

        minReceive:
          0n,

        minFinalBalance:
          0n,
      },

      {
        token:
          fixture.WETH,

        maxSpend:
          0n,

        recipient:
          accountRoles
            .recipientAllowed
            .address,

        minReceive:
          minOutput,

        minFinalBalance:
          0n,
      },
    ],

    allowances: [
      {
        token:
          fixture.USDC,

        spender:
          fixture.ROUTER,

        maxFinalAllowance:
          allowanceCap,
      },
    ],

    nativeConstraint: {
      maxSpend:
        0n,

      minFinalBalance:
        0n,
    },

    moduleData:
      encodeAbiParameters(
        parseAbiParameters(
          "address,address,address,address",
        ),
        [
          fixture.ROUTER,
          fixture.USDC,
          fixture.WETH,
          accountRoles
            .recipientAllowed
            .address,
        ],
      ),
  };
}

function buildBatchPolicy({
  row,
  fixture,
  accountRoles,
}) {
  return {
    module:
      PolicyModule.Batch,

    assets: [
      {
        token:
          fixture.USDC,

        maxSpend:
          BigInt(
            row.parameters
              .batch_max_spend,
          ),

        recipient:
          accountRoles
            .recipientAllowed
            .address,

        minReceive:
          BigInt(
            row.parameters
              .batch_min_receive,
          ),

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
      "0x",
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

async function buildDPackage({
  row,
  signedCalls,
  executedCalls = signedCalls,
  policy,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  const nonce =
    BigInt(row.nonce);

  const callsHashContract =
    await publicClient.readContract({
      address:
        fixture.D,

      abi:
        artifacts.D.abi,

      functionName:
        "hashCalls",

      args: [
        signedCalls,
      ],
    });

  const callsHashJs =
    hashCallsV2(
      signedCalls,
    );

  assert(
    hexEqual(
      callsHashContract,
      callsHashJs,
    ),
    `${row.scenario_id}/D calls hash mismatch`,
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
    `${row.scenario_id}/D policy hash mismatch`,
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
      signedCalls.length > 1,

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

      label:
        `${row.scenario_id}/D`,
    });

  const calldata =
    encodeFunctionData({
      abi:
        artifacts.D.abi,

      functionName:
        "executeIntent",

      args: [
        manifest,
        executedCalls,
        policy,
        signature,
      ],
    });

  return {
    scenarioId:
      row.scenario_id,

    baseline:
      "D",

    from:
      accountRoles.agent.address,

    to:
      fixture.D,

    nonce,

    digest,

    signature,

    calldata,

    signedCalls,

    executedCalls,

    policy,

    manifest,

    callsHash:
      callsHashContract,

    executedCallsHash:
      hashCallsV2(
        executedCalls,
      ),

    policyHash:
      policyHashContract,
  };
}

async function buildP05({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  const inputAmount =
    BigInt(
      row.parameters.amount,
    );

  const requestedOutput =
    BigInt(
      row.parameters.min_out,
    );

  const swapData =
    buildSwapData({
      artifacts,
      fixture,

      inputAmount,

      outputAmount:
        requestedOutput,

      recipient:
        accountRoles
          .recipientAllowed
          .address,

      behavior:
        ROUTER_BEHAVIOR
          .InsufficientOutput,
    });

  if (
    row.baseline === "A"
  ) {
    return buildAGenericCall({
      row,

      target:
        fixture.ROUTER,

      innerData:
        swapData,

      fixture,
      artifacts,
      accountRoles,
      publicClient,
    });
  }

  assert(
    row.baseline === "D",
    `PILOT-05 unexpected baseline ${row.baseline}`,
  );

  const approvalData =
    buildApprovalData({
      artifacts,

      spender:
        fixture.ROUTER,

      amount:
        BigInt(
          row.parameters
            .d_approval_amount,
        ),
    });

  const calls = [
    {
      target:
        fixture.USDC,

      value:
        0n,

      data:
        approvalData,

      operation:
        0,
    },

    {
      target:
        fixture.ROUTER,

      value:
        0n,

      data:
        swapData,

      operation:
        0,
    },
  ];

  const policy =
    buildSwapPolicy({
      fixture,
      accountRoles,

      maxInput:
        BigInt(
          row.parameters.max_spend,
        ),

      minOutput:
        requestedOutput,

      allowanceCap:
        BigInt(
          row.parameters
            .d_final_allowance_cap,
        ),
    });

  return buildDPackage({
    row,
    signedCalls:
      calls,
    policy,
    fixture,
    artifacts,
    accountRoles,
    publicClient,
  });
}

async function buildP06({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  assert(
    row.baseline === "D",
    "PILOT-06 only baseline D is applicable",
  );

  const [
    firstSigned,
    secondSigned,
  ] =
    row.parameters
      .batch_signed_amounts
      .map(BigInt);

  const [
    firstExecuted,
    secondExecuted,
  ] =
    row.parameters
      .batch_executed_amounts
      .map(BigInt);

  const recipient =
    accountRoles
      .recipientAllowed
      .address;

  const signedCalls = [
    {
      target:
        fixture.USDC,

      value:
        0n,

      data:
        buildTransferData({
          artifacts,
          recipient,
          amount:
            firstSigned,
        }),

      operation:
        0,
    },

    {
      target:
        fixture.USDC,

      value:
        0n,

      data:
        buildTransferData({
          artifacts,
          recipient,
          amount:
            secondSigned,
        }),

      operation:
        0,
    },
  ];

  const executedCalls = [
    {
      target:
        fixture.USDC,

      value:
        0n,

      data:
        buildTransferData({
          artifacts,
          recipient,
          amount:
            firstExecuted,
        }),

      operation:
        0,
    },

    {
      target:
        fixture.USDC,

      value:
        0n,

      data:
        buildTransferData({
          artifacts,
          recipient,
          amount:
            secondExecuted,
        }),

      operation:
        0,
    },
  ];

  const policy =
    buildBatchPolicy({
      row,
      fixture,
      accountRoles,
    });

  return buildDPackage({
    row,
    signedCalls,
    executedCalls,
    policy,
    fixture,
    artifacts,
    accountRoles,
    publicClient,
  });
}

async function buildP08({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  if (
    row.baseline === "A"
  ) {
    const innerData =
      buildApprovalData({
        artifacts,

        spender:
          fixture.ROUTER,

        amount:
          BigInt(
            row.parameters
              .ac_approval_amount,
          ),
      });

    return buildAGenericCall({
      row,

      target:
        fixture.USDC,

      innerData,
      fixture,
      artifacts,
      accountRoles,
      publicClient,
    });
  }

  if (
    row.baseline === "C"
  ) {
    const selector =
      toFunctionSelector(
        "approve(address,uint256)",
      );

    const maximum =
      BigInt(
        row.parameters
          .ac_approval_amount,
      );

    const innerData =
      buildApprovalData({
        artifacts,

        spender:
          fixture.ROUTER,

        amount:
          maximum,
      });

    return buildCGenericPath({
      row,

      target:
        fixture.USDC,

      selector,

      maximum,

      innerData,
      fixture,
      artifacts,
      accountRoles,
      publicClient,
    });
  }

  assert(
    row.baseline === "D",
    `PILOT-08 unexpected baseline ${row.baseline}`,
  );

  const approvalData =
    buildApprovalData({
      artifacts,

      spender:
        fixture.ROUTER,

      amount:
        BigInt(
          row.parameters
            .d_approval_amount,
        ),
    });

  const swapData =
    buildSwapData({
      artifacts,
      fixture,

      inputAmount:
        BigInt(
          row.parameters
            .d_swap_input,
        ),

      outputAmount:
        BigInt(
          row.parameters
            .d_swap_output,
        ),

      recipient:
        accountRoles
          .recipientAllowed
          .address,

      behavior:
        ROUTER_BEHAVIOR.Valid,
    });

  const calls = [
    {
      target:
        fixture.USDC,

      value:
        0n,

      data:
        approvalData,

      operation:
        0,
    },

    {
      target:
        fixture.ROUTER,

      value:
        0n,

      data:
        swapData,

      operation:
        0,
    },
  ];

  const policy =
    buildSwapPolicy({
      fixture,
      accountRoles,

      maxInput:
        BigInt(
          row.parameters
            .d_swap_input,
        ),

      minOutput:
        BigInt(
          row.parameters
            .d_min_receive,
        ),

      allowanceCap:
        BigInt(
          row.parameters
            .allowance_limit,
        ),
    });

  return buildDPackage({
    row,
    signedCalls:
      calls,
    policy,
    fixture,
    artifacts,
    accountRoles,
    publicClient,
  });
}

async function buildP09({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  assert(
    row.baseline === "D",
    "PILOT-09 only baseline D is applicable",
  );

  const amount =
    BigInt(
      row.parameters
        .violation_amount,
    );

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
            accountRoles
              .thief
              .address,

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
        accountRoles
          .recipientAllowed
          .address,

      maximum:
        BigInt(
          row.parameters
            .violation_max_spend,
        ),
    });

  return buildDPackage({
    row,
    signedCalls:
      calls,
    policy,
    fixture,
    artifacts,
    accountRoles,
    publicClient,
  });
}

async function buildP10({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  assert(
    row.baseline === "D",
    "PILOT-10 only baseline D is applicable",
  );

  const amount =
    BigInt(
      row.parameters
        .measured_amount,
    );

  const recipient =
    accountRoles
      .recipientAllowed
      .address;

  const calls = [
    {
      target:
        fixture.USDC,

      value:
        0n,

      data:
        buildTransferData({
          artifacts,
          recipient,
          amount,
        }),

      operation:
        0,
    },
  ];

  const policy =
    buildTransferPolicy({
      fixture,
      recipient,

      maximum:
        BigInt(
          row.parameters
            .measured_max_spend,
        ),
    });

  return buildDPackage({
    row,
    signedCalls:
      calls,
    policy,
    fixture,
    artifacts,
    accountRoles,
    publicClient,
  });
}

export async function buildAdvancedPilotTransaction({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  assert(
    row.applicability
      === "APPLICABLE",
    `${row.scenario_id}/${row.baseline}: cannot build NOT_APPLICABLE row`,
  );

  assert(
    ADVANCED_SCENARIOS.has(
      row.scenario_id,
    ),
    `${row.scenario_id}: not part of advanced builder phase`,
  );

  switch (
    row.scenario_id
  ) {
    case "PILOT-05":
      return buildP05({
        row,
        fixture,
        artifacts,
        accountRoles,
        publicClient,
      });

    case "PILOT-06":
      return buildP06({
        row,
        fixture,
        artifacts,
        accountRoles,
        publicClient,
      });

    case "PILOT-08":
      return buildP08({
        row,
        fixture,
        artifacts,
        accountRoles,
        publicClient,
      });

    case "PILOT-09":
      return buildP09({
        row,
        fixture,
        artifacts,
        accountRoles,
        publicClient,
      });

    case "PILOT-10":
      return buildP10({
        row,
        fixture,
        artifacts,
        accountRoles,
        publicClient,
      });

    default:
      fail(
        `unhandled advanced scenario ${row.scenario_id}`,
      );
  }
}

export async function runAdvancedBuilderPreflight() {
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
        ADVANCED_SCENARIOS.has(
          row.scenario_id,
        )
        && row.applicability
          === "APPLICABLE",
    );

  assert(
    selected.length === 8,
    `advanced builder row count=${selected.length}, expected 8`,
  );

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

    const built = [];

    for (
      const row
      of selected
    ) {
      const transaction =
        await buildAdvancedPilotTransaction({
          row,
          fixture,
          artifacts,
          accountRoles,
          publicClient,
        });

      assert(
        typeof transaction.calldata
          === "string"
        && transaction.calldata
          .startsWith("0x")
        && transaction.calldata.length
          > 10,
        `${row.scenario_id}/${row.baseline}: calldata missing`,
      );

      assert(
        transaction.from
          .toLowerCase()
        === accountRoles
          .agent.address
          .toLowerCase(),
        `${row.scenario_id}/${row.baseline}: wrong submitter`,
      );

      assert(
        transaction.nonce
          === BigInt(row.nonce),
        `${row.scenario_id}/${row.baseline}: nonce mismatch`,
      );

      built.push(
        transaction,
      );

      console.log(
        [
          row.scenario_id,
          row.baseline,
          `nonce=${transaction.nonce}`,
          "BUILT",
        ].join(" "),
      );
    }

    const counts =
      Object.fromEntries(
        ["A", "B", "C", "D"]
          .map(
            (baseline) => [
              baseline,
              built.filter(
                (item) =>
                  item.baseline
                    === baseline,
              ).length,
            ],
          ),
      );

    assert(
      counts.A === 2
      && counts.B === 0
      && counts.C === 1
      && counts.D === 5,
      `unexpected advanced counts ${JSON.stringify(counts)}`,
    );

    const p06 =
      built.find(
        (item) =>
          item.scenarioId
            === "PILOT-06"
          && item.baseline
            === "D",
      );

    assert(
      p06,
      "PILOT-06/D package missing",
    );

    assert(
      p06.signedCalls.length === 2
      && p06.executedCalls.length === 2,
      "PILOT-06/D batch size mismatch",
    );

    assert(
      !hexEqual(
        p06.callsHash,
        p06.executedCallsHash,
      ),
      "PILOT-06/D executed order did not change calls hash",
    );

    assert(
      hexEqual(
        p06.manifest.callsHash,
        p06.callsHash,
      ),
      "PILOT-06/D manifest lost signed-order calls hash",
    );

    const p05d =
      built.find(
        (item) =>
          item.scenarioId
            === "PILOT-05"
          && item.baseline
            === "D",
      );

    assert(
      p05d
      && p05d.executedCalls.length
        === 2
      && p05d.policy.module
        === PolicyModule.Swap
      && p05d.policy
        .allowances[0]
        .maxFinalAllowance
        === 0n,
      "PILOT-05/D swap package mismatch",
    );

    const p08d =
      built.find(
        (item) =>
          item.scenarioId
            === "PILOT-08"
          && item.baseline
            === "D",
      );

    assert(
      p08d
      && p08d.executedCalls.length
        === 2
      && p08d.policy.module
        === PolicyModule.Swap
      && p08d.policy
        .allowances[0]
        .maxFinalAllowance
        === 1000000n,
      "PILOT-08/D residual allowance package mismatch",
    );

    const p09d =
      built.find(
        (item) =>
          item.scenarioId
            === "PILOT-09"
          && item.baseline
            === "D",
      );

    const p10d =
      built.find(
        (item) =>
          item.scenarioId
            === "PILOT-10"
          && item.baseline
            === "D",
      );

    assert(
      p09d
      && p09d.policy.module
        === PolicyModule.Transfer,
      "PILOT-09/D transfer violation package mismatch",
    );

    assert(
      p10d
      && p10d.policy.module
        === PolicyModule.Transfer,
      "PILOT-10/D benign measured package mismatch",
    );

    console.log(
      "ADVANCED_BUILDER_PACKAGES: 8",
    );

    console.log(
      `ADVANCED_BUILDER_COUNTS: A=${counts.A} B=${counts.B} C=${counts.C} D=${counts.D}`,
    );

    console.log(
      "ADVANCED_BUILDER_SIGNATURE_RECOVERY: PASS",
    );

    console.log(
      "ADVANCED_BUILDER_D_HASH_BINDING: PASS",
    );

    console.log(
      "ADVANCED_BUILDER_P05_SWAP: PASS",
    );

    console.log(
      "ADVANCED_BUILDER_P06_POST_SIGNATURE_REORDER: PASS",
    );

    console.log(
      "ADVANCED_BUILDER_P08_RESIDUAL_ALLOWANCE: PASS",
    );

    console.log(
      "ADVANCED_BUILDER_P09_VIOLATION_PACKAGE: PASS",
    );

    console.log(
      "ADVANCED_BUILDER_P10_BENIGN_MEASURED_PACKAGE: PASS",
    );

    console.log(
      "PILOT_TRANSACTIONS_EXECUTED: 0",
    );

    console.log(
      "PILOT_OBSERVATIONS_CREATED: 0",
    );

    console.log(
      "ADVANCED_TRANSACTION_BUILDER_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}
