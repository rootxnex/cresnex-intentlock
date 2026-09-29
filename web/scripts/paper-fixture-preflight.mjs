import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
} from "viem";

import { mnemonicToAccount } from "viem/accounts";

const SCRIPT_DIR =
  dirname(fileURLToPath(import.meta.url));

const REPO_ROOT =
  resolve(SCRIPT_DIR, "../..");

export const MNEMONIC =
  "test test test test test test test test test test test junk";

export const CHAIN_ID = 31337;
export const GENESIS_TIMESTAMP = 1700000000n;

const INITIAL_USDC =
  1_000_000n * 10n ** 6n;

const PILOT_NONCES = [
  700001n,
  700002n,
  700003n,
  700004n,
  700005n,
  700006n,
  700007n,
  700008n,
  700009n,
  700010n,
];

const EXPECTED_ACCOUNTS = [
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
];

const ARTIFACT_PATHS = {
  A: join(
    REPO_ROOT,
    "contracts/out/SignatureOnlyAccount.sol/SignatureOnlyAccount.json",
  ),
  B: join(
    REPO_ROOT,
    "contracts/out/SpendLimitGuardAccount.sol/SpendLimitGuardAccount.json",
  ),
  C: join(
    REPO_ROOT,
    "contracts/out/PathAndSpendGuardAccount.sol/PathAndSpendGuardAccount.json",
  ),
  D: join(
    REPO_ROOT,
    "contracts/out/CresnexIntentLockAccountV2.sol/CresnexIntentLockAccountV2.json",
  ),
  token: join(
    REPO_ROOT,
    "contracts/out/MockERC20.sol/MockERC20.json",
  ),
  router: join(
    REPO_ROOT,
    "contracts/out/MockDexRouter.sol/MockDexRouter.json",
  ),
};

function fail(message) {
  throw new Error(message);
}

function loadArtifact(path, label) {
  const artifact =
    JSON.parse(readFileSync(path, "utf8"));

  let bytecode =
    artifact.bytecode?.object;

  if (
    typeof bytecode !== "string"
    || bytecode.length === 0
  ) {
    fail(`${label}: creation bytecode missing`);
  }

  if (!bytecode.startsWith("0x")) {
    bytecode = `0x${bytecode}`;
  }

  if (!Array.isArray(artifact.abi)) {
    fail(`${label}: ABI missing`);
  }

  return {
    abi: artifact.abi,
    bytecode,
  };
}

export function loadArtifacts() {
  return {
    A: loadArtifact(
      ARTIFACT_PATHS.A,
      "baseline A",
    ),
    B: loadArtifact(
      ARTIFACT_PATHS.B,
      "baseline B",
    ),
    C: loadArtifact(
      ARTIFACT_PATHS.C,
      "baseline C",
    ),
    D: loadArtifact(
      ARTIFACT_PATHS.D,
      "baseline D",
    ),
    token: loadArtifact(
      ARTIFACT_PATHS.token,
      "MockERC20",
    ),
    router: loadArtifact(
      ARTIFACT_PATHS.router,
      "MockDexRouter",
    ),
  };
}

export function roles() {
  const accounts =
    Array.from(
      { length: 6 },
      (_, addressIndex) =>
        mnemonicToAccount(
          MNEMONIC,
          { addressIndex },
        ),
    );

  const actual =
    accounts.map(
      (account) =>
        account.address.toLowerCase(),
    );

  if (
    actual.some(
      (address, index) =>
        address !== EXPECTED_ACCOUNTS[index],
    )
  ) {
    fail(
      "deterministic account mapping mismatch",
    );
  }

  return {
    owner: accounts[0],
    agent: accounts[1],
    recipientAllowed: accounts[2],
    thief: accounts[3],
    spenderAllowed: accounts[4],
    spenderUnauthorized: accounts[5],
  };
}

function delay(ms) {
  return new Promise(
    (resolvePromise) =>
      setTimeout(resolvePromise, ms),
  );
}

async function findFreePort() {
  return new Promise(
    (resolvePromise, rejectPromise) => {
      const server = createServer();

      server.once(
        "error",
        rejectPromise,
      );

      server.listen(
        0,
        "127.0.0.1",
        () => {
          const address =
            server.address();

          if (
            !address
            || typeof address === "string"
          ) {
            server.close();
            rejectPromise(
              new Error(
                "failed to allocate Anvil port",
              ),
            );
            return;
          }

          const { port } = address;

          server.close((error) => {
            if (error) {
              rejectPromise(error);
              return;
            }

            resolvePromise(port);
          });
        },
      );
    },
  );
}

export async function stopAnvil(child) {
  if (
    !child
    || child.exitCode !== null
  ) {
    return;
  }

  child.kill("SIGTERM");

  for (let i = 0; i < 20; i += 1) {
    if (child.exitCode !== null) {
      return;
    }

    await delay(100);
  }

  child.kill("SIGKILL");
  await delay(100);
}

async function rawRpc(
  rpc,
  method,
  params = [],
) {
  const response = await fetch(
    rpc,
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
      },
      body: JSON.stringify({
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

export async function startAnvil() {
  const port =
    await findFreePort();

  const rpc =
    `http://127.0.0.1:${port}`;

  const logs = [];

  const child = spawn(
    "anvil",
    [
      "--port",
      String(port),
      "--chain-id",
      String(CHAIN_ID),
      "--hardfork",
      "cancun",
      "--timestamp",
      String(GENESIS_TIMESTAMP),
      "--mnemonic",
      MNEMONIC,
    ],
    {
      stdio: [
        "ignore",
        "pipe",
        "pipe",
      ],
    },
  );

  child.stdout.on(
    "data",
    (chunk) =>
      logs.push(chunk.toString()),
  );

  child.stderr.on(
    "data",
    (chunk) =>
      logs.push(chunk.toString()),
  );

  const chain = defineChain({
    id: CHAIN_ID,
    name:
      "IntentLock Paper Anvil",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [rpc],
      },
    },
  });

  const publicClient =
    createPublicClient({
      chain,
      transport: http(rpc),
    });

  for (
    let attempt = 0;
    attempt < 100;
    attempt += 1
  ) {
    if (child.exitCode !== null) {
      fail(
        "Anvil exited during startup:\n"
        + logs.join("").slice(-4000),
      );
    }

    try {
      const chainId =
        await publicClient.getChainId();

      if (chainId === CHAIN_ID) {
        return {
          child,
          rpc,
          chain,
          publicClient,
        };
      }
    } catch {
      // Still starting.
    }

    await delay(100);
  }

  await stopAnvil(child);

  fail(
    "Anvil did not become ready:\n"
    + logs.join("").slice(-4000),
  );
}

export async function deployFixture({
  walletClient,
  publicClient,
  artifacts,
  accountRoles,
}) {
  async function deploy(
    label,
    artifact,
    args = [],
  ) {
    const hash =
      await walletClient.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode,
        args,
      });

    const receipt =
      await publicClient
        .waitForTransactionReceipt({
          hash,
        });

    if (
      receipt.status !== "success"
      || !receipt.contractAddress
    ) {
      fail(
        `${label}: deployment failed`,
      );
    }

    console.log(
      `${label}: ${receipt.contractAddress}`,
    );

    return receipt.contractAddress;
  }

  async function send(
    address,
    abi,
    functionName,
    args = [],
  ) {
    const hash =
      await walletClient.writeContract({
        address,
        abi,
        functionName,
        args,
      });

    const receipt =
      await publicClient
        .waitForTransactionReceipt({
          hash,
        });

    if (
      receipt.status !== "success"
    ) {
      fail(
        `${functionName}: setup transaction failed`,
      );
    }
  }

  /*
   * Frozen pre-execution amendment 2:
   *
   * A -> B -> C -> D
   * -> Mock USDC
   * -> Mock WETH
   * -> Mock Router
   */

  const A = await deploy(
    "A",
    artifacts.A,
    [accountRoles.owner.address],
  );

  const B = await deploy(
    "B",
    artifacts.B,
    [accountRoles.owner.address],
  );

  const C = await deploy(
    "C",
    artifacts.C,
    [accountRoles.owner.address],
  );

  const D = await deploy(
    "D",
    artifacts.D,
    [accountRoles.owner.address],
  );

  const USDC = await deploy(
    "USDC",
    artifacts.token,
    [
      "Mock USDC",
      "mUSDC",
      6,
    ],
  );

  const WETH = await deploy(
    "WETH",
    artifacts.token,
    [
      "Mock WETH",
      "mWETH",
      18,
    ],
  );

  const ROUTER = await deploy(
    "ROUTER",
    artifacts.router,
  );

  await send(
    D,
    artifacts.D.abi,
    "registerAgent",
    [accountRoles.agent.address],
  );

  for (
    const account
    of [A, B, C, D]
  ) {
    await send(
      USDC,
      artifacts.token.abi,
      "mint",
      [
        account,
        INITIAL_USDC,
      ],
    );
  }

  return {
    A,
    B,
    C,
    D,
    USDC,
    WETH,
    ROUTER,
  };
}

export async function verifyFixture({
  publicClient,
  artifacts,
  fixture,
  accountRoles,
}) {
  async function read(
    address,
    abi,
    functionName,
    args = [],
  ) {
    return publicClient.readContract({
      address,
      abi,
      functionName,
      args,
    });
  }

  for (
    const [label, address, abi]
    of [
      [
        "A",
        fixture.A,
        artifacts.A.abi,
      ],
      [
        "B",
        fixture.B,
        artifacts.B.abi,
      ],
      [
        "C",
        fixture.C,
        artifacts.C.abi,
      ],
      [
        "D",
        fixture.D,
        artifacts.D.abi,
      ],
    ]
  ) {
    const owner =
      await read(
        address,
        abi,
        "owner",
      );

    if (
      owner.toLowerCase()
      !== accountRoles.owner
        .address.toLowerCase()
    ) {
      fail(
        `${label}: owner mismatch`,
      );
    }
  }

  const usdcDecimals =
    await read(
      fixture.USDC,
      artifacts.token.abi,
      "decimals",
    );

  const wethDecimals =
    await read(
      fixture.WETH,
      artifacts.token.abi,
      "decimals",
    );

  if (
    usdcDecimals !== 6
    || wethDecimals !== 18
  ) {
    fail(
      "mock token decimal mismatch",
    );
  }

  console.log(
    `token_decimals: ${usdcDecimals} ${wethDecimals}`,
  );

  for (
    const [label, address]
    of [
      ["A", fixture.A],
      ["B", fixture.B],
      ["C", fixture.C],
      ["D", fixture.D],
    ]
  ) {
    const usdc =
      await read(
        fixture.USDC,
        artifacts.token.abi,
        "balanceOf",
        [address],
      );

    const weth =
      await read(
        fixture.WETH,
        artifacts.token.abi,
        "balanceOf",
        [address],
      );

    const allowance =
      await read(
        fixture.USDC,
        artifacts.token.abi,
        "allowance",
        [
          address,
          fixture.ROUTER,
        ],
      );

    if (
      usdc !== INITIAL_USDC
      || weth !== 0n
      || allowance !== 0n
    ) {
      fail(
        `${label}: fixture balance/allowance mismatch`,
      );
    }

    console.log(
      `${label}: USDC=${usdc} WETH=${weth} allowance=${allowance}`,
    );
  }

  for (
    const [label, address]
    of [
      [
        "recipient",
        accountRoles
          .recipientAllowed
          .address,
      ],
      [
        "thief",
        accountRoles.thief.address,
      ],
    ]
  ) {
    const usdc =
      await read(
        fixture.USDC,
        artifacts.token.abi,
        "balanceOf",
        [address],
      );

    const weth =
      await read(
        fixture.WETH,
        artifacts.token.abi,
        "balanceOf",
        [address],
      );

    if (
      usdc !== 0n
      || weth !== 0n
    ) {
      fail(
        `${label}: initial token balance mismatch`,
      );
    }
  }

  const agentState =
    await read(
      fixture.D,
      artifacts.D.abi,
      "agents",
      [accountRoles.agent.address],
    );

  const [
    registered,
    quarantined,
    strikes,
  ] = agentState;

  if (
    registered !== true
    || quarantined !== false
    || strikes !== 0n
  ) {
    fail(
      "D initial agent state mismatch",
    );
  }

  const threshold =
    await read(
      fixture.D,
      artifacts.D.abi,
      "quarantineThreshold",
    );

  if (threshold !== 3n) {
    fail(
      `wrong quarantine threshold: ${threshold}`,
    );
  }

  for (
    const [label, address, abi]
    of [
      [
        "A",
        fixture.A,
        artifacts.A.abi,
      ],
      [
        "B",
        fixture.B,
        artifacts.B.abi,
      ],
      [
        "C",
        fixture.C,
        artifacts.C.abi,
      ],
      [
        "D",
        fixture.D,
        artifacts.D.abi,
      ],
    ]
  ) {
    for (
      const nonce
      of PILOT_NONCES
    ) {
      const used =
        await read(
          address,
          abi,
          "usedNonces",
          [nonce],
        );

      if (used !== false) {
        fail(
          `${label}: pilot nonce ${nonce} already used`,
        );
      }
    }
  }

  const routerUsdc =
    await read(
      fixture.USDC,
      artifacts.token.abi,
      "balanceOf",
      [fixture.ROUTER],
    );

  const routerWeth =
    await read(
      fixture.WETH,
      artifacts.token.abi,
      "balanceOf",
      [fixture.ROUTER],
    );

  if (
    routerUsdc !== 0n
    || routerWeth !== 0n
  ) {
    fail(
      "router initial reserves mismatch",
    );
  }

  console.log(
    "D agent:",
    {
      registered,
      quarantined,
      strikes: strikes.toString(),
    },
  );

  console.log(
    `quarantine_threshold: ${threshold}`,
  );

  console.log(
    "pilot_nonces_unused: true",
  );

  console.log(
    `router_reserves: ${routerUsdc} ${routerWeth}`,
  );

  console.log(
    "FIXTURE_STATE_PASS",
  );
}

function normalizedAddresses(
  fixture,
) {
  return Object.fromEntries(
    Object.entries(fixture).map(
      ([key, address]) => [
        key,
        getAddress(address),
      ],
    ),
  );
}

export async function runFixturePreflight() {
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

    const walletClient =
      createWalletClient({
        account:
          accountRoles.owner,
        chain,
        transport: http(rpc),
      });

    const chainId =
      await publicClient
        .getChainId();

    if (chainId !== CHAIN_ID) {
      fail(
        `wrong chain id: ${chainId}`,
      );
    }

    const genesis =
      await publicClient.getBlock({
        blockNumber: 0n,
      });

    if (
      genesis.timestamp
      !== GENESIS_TIMESTAMP
    ) {
      fail(
        `wrong genesis timestamp: ${genesis.timestamp}`,
      );
    }

    console.log(
      `chain_id: ${chainId}`,
    );

    console.log(
      `genesis_timestamp: ${genesis.timestamp}`,
    );

    const blankSnapshot =
      await rawRpc(
        rpc,
        "evm_snapshot",
      );

    console.log(
      `blank_snapshot: ${blankSnapshot}`,
    );

    console.log(
      "=== DEPLOY FIXTURE #1 ===",
    );

    const fixture1 =
      await deployFixture({
        walletClient,
        publicClient,
        artifacts,
        accountRoles,
      });

    await verifyFixture({
      publicClient,
      artifacts,
      fixture: fixture1,
      accountRoles,
    });

    const fixtureSnapshot =
      await rawRpc(
        rpc,
        "evm_snapshot",
      );

    console.log(
      `fixture_snapshot: ${fixtureSnapshot}`,
    );

    const reverted =
      await rawRpc(
        rpc,
        "evm_revert",
        [blankSnapshot],
      );

    if (reverted !== true) {
      fail(
        "blank snapshot revert failed",
      );
    }

    console.log(
      "blank_revert: true",
    );

    const replacementBlank =
      await rawRpc(
        rpc,
        "evm_snapshot",
      );

    console.log(
      `replacement_blank_snapshot: ${replacementBlank}`,
    );

    console.log(
      "=== DEPLOY FIXTURE #2 ===",
    );

    const fixture2 =
      await deployFixture({
        walletClient,
        publicClient,
        artifacts,
        accountRoles,
      });

    await verifyFixture({
      publicClient,
      artifacts,
      fixture: fixture2,
      accountRoles,
    });

    const first =
      normalizedAddresses(
        fixture1,
      );

    const second =
      normalizedAddresses(
        fixture2,
      );

    console.log(
      "=== ADDRESS COMPARISON ===",
    );

    for (
      const key
      of Object.keys(first)
    ) {
      console.log(
        `${key} ${first[key]} ${second[key]}`,
      );

      if (
        first[key].toLowerCase()
        !== second[key].toLowerCase()
      ) {
        fail(
          `${key}: nondeterministic deployment address`,
        );
      }
    }

    console.log(
      "REDEPLOY_ADDRESSES_MATCH: true",
    );

    console.log(
      "PILOT_SCENARIOS_EXECUTED: 0",
    );

    console.log(
      "FIXTURE_DEPLOYMENT_PREFLIGHT_PASS",
    );
  } finally {
    await stopAnvil(
      anvil.child,
    );
  }
}
