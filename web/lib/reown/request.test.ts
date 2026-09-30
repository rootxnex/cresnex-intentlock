import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeFunctionData,
  type Address,
} from "viem";

import {
  buildExactWalletConnectPolicy,
  classifyWalletConnectCall,
  erc20WalletKitAbi,
  normalizeWalletConnectRequest,
} from "./request.ts";

import { PolicyModule } from "../intentV2.ts";

const account =
  "0x0000000000000000000000000000000000000001" as Address;

const token =
  "0x0000000000000000000000000000000000000002" as Address;

const recipient =
  "0x0000000000000000000000000000000000000003" as Address;

const spender =
  "0x0000000000000000000000000000000000000004" as Address;

test("WalletConnect transfer becomes exact IntentLock transfer policy", () => {
  const data = encodeFunctionData({
    abi: erc20WalletKitAbi,
    functionName: "transfer",
    args: [recipient, 77n],
  });

  const call = normalizeWalletConnectRequest(
    {
      chainId: "eip155:84532",
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: token,
          value: "0x0",
          data,
        },
      ],
    },
    account,
  );

  const classified = classifyWalletConnectCall(call);
  const policy = buildExactWalletConnectPolicy(classified);

  assert.equal(classified.kind, "transfer");
  assert.equal(policy.module, PolicyModule.Transfer);
  assert.equal(policy.assets.length, 1);
  assert.equal(policy.assets[0].token, token);
  assert.equal(policy.assets[0].recipient, recipient);
  assert.equal(policy.assets[0].maxSpend, 77n);
  assert.equal(policy.assets[0].minReceive, 77n);
});

test("WalletConnect approval becomes bounded allowance policy", () => {
  const data = encodeFunctionData({
    abi: erc20WalletKitAbi,
    functionName: "approve",
    args: [spender, 25n],
  });

  const call = normalizeWalletConnectRequest(
    {
      chainId: "eip155:84532",
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: token,
          value: "0x0",
          data,
        },
      ],
    },
    account,
  );

  const classified = classifyWalletConnectCall(call);
  const policy = buildExactWalletConnectPolicy(classified);

  assert.equal(classified.kind, "approval");
  assert.equal(policy.module, PolicyModule.Approval);
  assert.equal(policy.allowances.length, 1);
  assert.equal(policy.allowances[0].token, token);
  assert.equal(policy.allowances[0].spender, spender);
  assert.equal(policy.allowances[0].maxFinalAllowance, 25n);
});

test("request from another account is rejected", () => {
  assert.throws(
    () =>
      normalizeWalletConnectRequest(
        {
          chainId: "eip155:84532",
          method: "eth_sendTransaction",
          params: [
            {
              from: recipient,
              to: token,
              data: "0x",
            },
          ],
        },
        account,
      ),
    /does not originate from the configured IntentLock account/,
  );
});

test("unsupported chain is rejected", () => {
  assert.throws(
    () =>
      normalizeWalletConnectRequest(
        {
          chainId: "eip155:1",
          method: "eth_sendTransaction",
          params: [
            {
              from: account,
              to: token,
              data: "0x",
            },
          ],
        },
        account,
      ),
    /Base Sepolia only/,
  );
});

test("arbitrary calldata is rejected", () => {
  const call = normalizeWalletConnectRequest(
    {
      chainId: "eip155:84532",
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: token,
          data: "0x12345678",
        },
      ],
    },
    account,
  );

  assert.throws(
    () => classifyWalletConnectCall(call),
    /transfer\(\) and approve\(\) only/,
  );
});

test("native-value requests are rejected", () => {
  const data = encodeFunctionData({
    abi: erc20WalletKitAbi,
    functionName: "transfer",
    args: [recipient, 1n],
  });

  const call = normalizeWalletConnectRequest(
    {
      chainId: "eip155:84532",
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: token,
          value: "0x1",
          data,
        },
      ],
    },
    account,
  );

  assert.throws(
    () => classifyWalletConnectCall(call),
    /Native-value/,
  );
});
