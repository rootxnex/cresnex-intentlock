import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, writeFile, open } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, createWalletClient, defineChain, hashTypedData, http, keccak256 } from "viem";
import { hashCallsV2, hashPolicyV2, intentTypesV2 } from "../lib/intentV2.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.argv[2];
if (!output) throw new Error("Usage: node --experimental-strip-types web/scripts/paper-hash-check.mjs NEW_OUTPUT_DIRECTORY");
await mkdir(resolve(output), { recursive: false });
const serialize = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
const options = ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--hardfork", "cancun", "--timestamp", "1700000000", "--silent"];
const anvil = spawn("anvil", options, { stdio: "ignore" });
let launchError;
anvil.on("error", (error) => { launchError = error; });
const transport = http(`http://127.0.0.1:${port}`, { retryCount: 0, timeout: 2000 });
const chain = defineChain({ id: 31337, name: "Paper hash check (local only)", nativeCurrency: { name: "Local", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [`http://127.0.0.1:${port}`] } } });
const client = createPublicClient({ chain, transport, pollingInterval: 20 });
const environment = { timestamp: new Date().toISOString(), purpose: "CORRECTNESS_HASH_PARITY_ONLY", anvil_options: options, chain_id: 31337, vector_seed: 20260928, vector_count: 16, transaction_benchmark: false };
let observations;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (launchError) throw launchError;
    if (anvil.exitCode !== null) throw new Error(`Anvil exited with ${anvil.exitCode}`);
    try { assert.equal(await client.getChainId(), 31337); ready = true; break; } catch { await delay(100); }
  }
  assert.ok(ready, "Local Anvil did not become ready");
  const accounts = await client.request({ method: "eth_accounts" });
  const owner = accounts[0];
  const wallet = createWalletClient({ account: owner, chain, transport });
  const artifact = JSON.parse(await readFile(resolve(root, "contracts/out/CresnexIntentLockAccountV2.sol/CresnexIntentLockAccountV2.json"), "utf8"));
  const deploymentHash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [owner], gas: 14000000n });
  const receipt = await client.waitForTransactionReceipt({ hash: deploymentHash });
  assert.equal(receipt.status, "success");
  const account = receipt.contractAddress;
  const read = (functionName, args = []) => client.readContract({ address: account, abi: artifact.abi, functionName, args });
  const domain = await read("eip712Domain");
  assert.equal(domain[1], "Cresnex IntentLock");
  assert.equal(domain[2], "2");
  assert.equal(domain[3], 31337n);
  assert.equal(domain[4].toLowerCase(), account.toLowerCase());
  Object.assign(environment, { account, owner, deployment_transaction_hash: deploymentHash, runtime_bytecode_keccak256: keccak256(await client.getCode({ address: account })), compiler: artifact.metadata.compiler });
  await writeFile(resolve(output, "environment.json"), serialize(environment) + "\n", { flag: "wx" });
  const address = (value) => `0x${BigInt(value).toString(16).padStart(40, "0")}`;
  const vectors = Array.from({ length: 16 }, (_, index) => {
    const lengths = [0, 1, 2, 16];
    const calls = Array.from({ length: lengths[index % 4] }, (_, position) => ({ target: address(256 + position), value: BigInt(index * 31 + position), data: `0x${"ab".repeat(index + position)}`, operation: 0 }));
    const policy = {
      module: index % 12,
      assets: Array.from({ length: [0, 1, 2, 8][Math.floor(index / 4)] }, (_, position) => ({ token: address(512 + position), maxSpend: index === 15 ? 2n ** 256n - 1n : BigInt(1000 + index + position), recipient: address(1024 + position), minReceive: BigInt(position), minFinalBalance: BigInt(index) })),
      allowances: Array.from({ length: [0, 1, 2, 8][index % 4] }, (_, position) => ({ token: address(512 + position), spender: address(2048 + position), maxFinalAllowance: BigInt(position * index) })),
      nativeConstraint: { maxSpend: BigInt(index), minFinalBalance: BigInt(index * 2) },
      moduleData: `0x${"cafe".repeat(index)}`,
    };
    const manifest = { version: 2, account, owner, agent: accounts[1], chainId: 31337n, callsHash: hashCallsV2(calls), policyHash: hashPolicyV2(policy), nonce: BigInt(20260928 + index), validAfter: 1700000000 + index, validUntil: 1700003600 + index, allowBatch: calls.length > 1, evidenceMode: 1 };
    return { vector_id: `hash-${String(index).padStart(2, "0")}`, seed: 20260928, calls, policy, manifest, note: "Hash-function input only; not a structurally valid executable policy claim." };
  });
  await writeFile(resolve(output, "vectors.json"), serialize(vectors) + "\n", { flag: "wx" });
  observations = await open(resolve(output, "observations.jsonl"), "wx");
  let comparisons = 0;
  for (const vector of vectors) {
    const expected = [vector.manifest.callsHash, vector.manifest.policyHash, hashTypedData({ domain: { name: domain[1], version: domain[2], chainId: domain[3], verifyingContract: account }, types: intentTypesV2, primaryType: "IntentManifest", message: vector.manifest })];
    const actual = [await read("hashCalls", [vector.calls]), await read("hashPolicy", [vector.policy]), await read("hashIntent", [vector.manifest])];
    for (const [position, functionName] of ["hashCalls", "hashPolicy", "hashIntent"].entries()) {
      const row = { vector_id: vector.vector_id, function: functionName, typescript_hash: expected[position], solidity_hash: actual[position], match: expected[position] === actual[position] };
      await observations.write(JSON.stringify(row) + "\n");
      assert.ok(row.match, `${vector.vector_id}: ${functionName} differs`);
      comparisons++;
    }
  }
  await writeFile(resolve(output, "result.json"), serialize({ status: "PASS", vectors: vectors.length, comparisons, mismatches: 0, source: "observations.jsonl", limitation: "Finite deterministic hashing vectors; not signature authorization tests or an execution benchmark." }) + "\n", { flag: "wx" });
  console.log(`${vectors.length} shared vectors; ${comparisons} Solidity/TypeScript comparisons passed.`);
} catch (error) {
  await writeFile(resolve(output, "failure.json"), serialize({ status: "FAIL", message: error.message, environment }) + "\n", { flag: "wx" });
  throw error;
} finally {
  if (observations) await observations.close();
  if (anvil.exitCode === null && !launchError) {
    anvil.kill("SIGTERM");
    await once(anvil, "exit");
  }
}
