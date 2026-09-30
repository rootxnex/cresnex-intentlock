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

function scenarioTransferRecipient(
  row,
  accountRoles,
) {
  if (
    row.scenario_id
    === "PILOT-02"
  ) {
    return accountRoles
      .thief
      .address;
  }

  return accountRoles
    .recipientAllowed
    .address;
}

function scenarioTransferAmount(
  row,
) {
  return BigInt(
    row.parameters.amount,
  );
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

async function buildA({
  row,
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

  let target;
  let innerData;

  if (
    row.scenario_id
    === "PILOT-04"
  ) {
    target =
      fixture.USDC;

    innerData =
      buildApprovalData({
        artifacts,

        spender:
          accountRoles
            .spenderUnauthorized
            .address,

        amount:
          BigInt(
            row.parameters
              .allowance_requested,
          ),
      });
  } else {
    target =
      fixture.USDC;

    innerData =
      buildTransferData({
        artifacts,

        recipient:
          scenarioTransferRecipient(
            row,
            accountRoles,
          ),

        amount:
          scenarioTransferAmount(
            row,
          ),
      });
  }

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

async function buildB({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  assert(
    row.scenario_id
      !== "PILOT-04",
    "PILOT-04/B must be NOT_APPLICABLE",
  );

  const nonce =
    BigInt(row.nonce);

  const validUntil =
    BigInt(
      row.parameters.valid_until,
    );

  const maximum =
    BigInt(
      row.parameters.max_spend,
    );

  const recipient =
    scenarioTransferRecipient(
      row,
      accountRoles,
    );

  const amount =
    scenarioTransferAmount(
      row,
    );

  const digest =
    await publicClient.readContract({
      address:
        fixture.B,

      abi:
        artifacts.B.abi,

      functionName:
        "authorizationHash",

      args: [
        accountRoles.agent.address,
        fixture.USDC,
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
        `${row.scenario_id}/B`,
    });

  const calldata =
    encodeFunctionData({
      abi:
        artifacts.B.abi,

      functionName:
        "transfer",

      args: [
        fixture.USDC,
        recipient,
        amount,
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
      "B",

    from:
      accountRoles.agent.address,

    to:
      fixture.B,

    nonce,

    digest,

    signature,

    calldata,

    target:
      fixture.USDC,

    recipient,

    amount,

    maximum,
  };
}

async function buildC({
  row,
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

  let selector;
  let maximum;
  let innerData;

  if (
    row.scenario_id
    === "PILOT-04"
  ) {
    selector =
      toFunctionSelector(
        "approve(address,uint256)",
      );

    maximum =
      BigInt(
        row.parameters
          .allowance_limit,
      );

    innerData =
      buildApprovalData({
        artifacts,

        spender:
          accountRoles
            .spenderUnauthorized
            .address,

        amount:
          BigInt(
            row.parameters
              .allowance_requested,
          ),
      });
  } else {
    selector =
      toFunctionSelector(
        "transfer(address,uint256)",
      );

    maximum =
      BigInt(
        row.parameters.max_spend,
      );

    innerData =
      buildTransferData({
        artifacts,

        recipient:
          scenarioTransferRecipient(
            row,
            accountRoles,
          ),

        amount:
          scenarioTransferAmount(
            row,
          ),
      });
  }

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
        fixture.USDC,
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
        fixture.USDC,
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

    target:
      fixture.USDC,

    selector,

    maximum,

    innerData,
  };
}

function buildDTransferPolicy({
  row,
  fixture,
  accountRoles,
}) {
  const transferSelector =
    toFunctionSelector(
      "transfer(address,uint256)",
    );

  const maximum =
    BigInt(
      row.parameters.max_spend,
    );

  const recipient =
    accountRoles
      .recipientAllowed
      .address;

  const moduleData =
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
        transferSelector,
      ],
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

    moduleData,
  };
}

function buildDApprovalPolicy({
  row,
  fixture,
  accountRoles,
}) {
  const maximum =
    BigInt(
      row.parameters
        .allowance_limit,
    );

  const spender =
    accountRoles
      .spenderAllowed
      .address;

  const moduleData =
    encodeAbiParameters(
      parseAbiParameters(
        "address,address,uint256,bool",
      ),
      [
        fixture.USDC,
        spender,
        maximum,
        false,
      ],
    );

  return {
    module:
      PolicyModule.Approval,

    assets:
      [],

    allowances: [
      {
        token:
          fixture.USDC,

        spender,

        maxFinalAllowance:
          maximum,
      },
    ],

    nativeConstraint: {
      maxSpend:
        0n,

      minFinalBalance:
        0n,
    },

    moduleData,
  };
}

async function buildD({
  row,
  fixture,
  artifacts,
  accountRoles,
  publicClient,
}) {
  const nonce =
    BigInt(row.nonce);

  let innerData;
  let policy;

  if (
    row.scenario_id
    === "PILOT-04"
  ) {
    innerData =
      buildApprovalData({
        artifacts,

        spender:
          accountRoles
            .spenderUnauthorized
            .address,

        amount:
          BigInt(
            row.parameters
              .allowance_requested,
          ),
      });

    policy =
      buildDApprovalPolicy({
        row,
        fixture,
        accountRoles,
      });
  } else {
    innerData =
      buildTransferData({
        artifacts,

        recipient:
          scenarioTransferRecipient(
            row,
            accountRoles,
          ),

        amount:
          scenarioTransferAmount(
            row,
          ),
      });

    policy =
      buildDTransferPolicy({
        row,
        fixture,
        accountRoles,
      });
  }

  const calls = [
    {
      target:
        fixture.USDC,

      value:
        0n,

      data:
        innerData,

      operation:
        0,
    },
  ];

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
        calls,
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

    calls,

    policy,

    manifest,

    callsHash:
      callsHashContract,

    policyHash:
      policyHashContract,
  };
}

export async function buildSimplePilotTransaction({
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
    SIMPLE_SCENARIOS.has(
      row.scenario_id,
    ),
    `${row.scenario_id}: not part of simple builder phase`,
  );

  if (
    row.baseline === "A"
  ) {
    return buildA({
      row,
      fixture,
      artifacts,
      accountRoles,
      publicClient,
    });
  }

  if (
    row.baseline === "B"
  ) {
    return buildB({
      row,
      fixture,
      artifacts,
      accountRoles,
      publicClient,
    });
  }

  if (
    row.baseline === "C"
  ) {
    return buildC({
      row,
      fixture,
      artifacts,
      accountRoles,
      publicClient,
    });
  }

  if (
    row.baseline === "D"
  ) {
    return buildD({
      row,
      fixture,
      artifacts,
      accountRoles,
      publicClient,
    });
  }

  fail(
    `unknown baseline ${row.baseline}`,
  );
}

export async function runSimpleBuilderPreflight() {
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
        SIMPLE_SCENARIOS.has(
          row.scenario_id,
        )
        && row.applicability
          === "APPLICABLE",
    );

  assert(
    selected.length === 19,
    `simple builder row count=${selected.length}, expected 19`,
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
        await buildSimplePilotTransaction({
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

    const p07 =
      built.filter(
        (item) =>
          item.scenarioId
            === "PILOT-07",
      );

    assert(
      p07.length === 4,
      "PILOT-07 must produce four baseline packages",
    );

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
      counts.A === 5
      && counts.B === 4
      && counts.C === 5
      && counts.D === 5,
      `unexpected baseline builder counts ${JSON.stringify(counts)}`,
    );

    console.log(
      "SIMPLE_BUILDER_PACKAGES: 19",
    );

    console.log(
      `SIMPLE_BUILDER_COUNTS: A=${counts.A} B=${counts.B} C=${counts.C} D=${counts.D}`,
    );

    console.log(
      "SIMPLE_BUILDER_SIGNATURE_RECOVERY: PASS",
    );

    console.log(
      "SIMPLE_BUILDER_D_HASH_BINDING: PASS",
    );

    console.log(
      "SIMPLE_BUILDER_P07_REPLAY_PACKAGE_READY: PASS",
    );

    console.log(
      "PILOT_TRANSACTIONS_EXECUTED: 0",
    );

    console.log(
      "PILOT_OBSERVATIONS_CREATED: 0",
    );

    console.log(
      "SIMPLE_TRANSACTION_BUILDER_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}
