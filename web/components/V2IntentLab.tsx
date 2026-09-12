"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { useAccount, useChainId, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { accountV2Abi, accountV2Address } from "@/lib/contracts";
import {
  hashCallsV2,
  hashPolicyV2,
  intentTypesV2,
  parsePackageV2,
  PolicyModule,
  policyModuleNames,
  stringifyPackageV2,
  type AssetConstraint,
  type PolicyV2,
  type SignedIntentPackageV2,
} from "@/lib/intentV2";
import { canUseSignedPackage, signedPackageSnapshot } from "@/lib/v2SignedPackageState";

const zero = "0x0000000000000000000000000000000000000000" as Address;
const asAddress = (value: string) => isAddress(value) ? value : zero;
const asHex = (value: string) => /^0x([0-9a-fA-F]{2})*$/.test(value) ? value as Hex : "0x";
const asBytes4 = (value: string) => /^0x[0-9a-fA-F]{8}$/.test(value) ? value as Hex : "0x00000000";
const number = (value: string) => {
  try {
    const parsed = value === "" ? 0n : BigInt(value);
    return parsed < 0n ? 0n : parsed;
  } catch {
    return 0n;
  }
};
const id = (label: string, nonce: bigint) => keccak256(stringToHex(`${label}:${nonce}`));

const violationNames = [
  "None", "Maximum spend exceeded", "Minimum output not met", "Wrong recipient",
  "Allowance exceeded", "Unauthorized call", "Call order mismatch", "Protected asset loss",
  "NFT not received", "Payment period violation", "Administration value out of range",
  "Policy module failure", "Native spend exceeded",
];

function explainError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const known = [
    ["UnauthorizedAgent", "The connected wallet is not the signed, registered agent."],
    ["AgentQuarantined", "The signed agent is quarantined."],
    ["WrongChain", "The package is signed for a different chain."],
    ["NonceAlreadyUsed", "This nonce has already been consumed or cancelled."],
    ["IntentExpired", "The signed validity window has expired."],
    ["CallsHashMismatch", "The calls no longer match the owner-signed package."],
    ["PolicyHashMismatch", "The policy no longer matches the owner-signed package."],
    ["InvalidOwnerSignature", "The signature is not from the current account owner."],
    ["InvalidPolicy", "The policy shape is malformed or internally inconsistent."],
  ] as const;
  return known.find(([needle]) => message.includes(needle))?.[1] ?? message.split("\n")[0];
}

export function V2IntentLab() {
  const { address: wallet } = useAccount();
  const chainId = useChainId();
  const client = usePublicClient();
  const signer = useSignTypedData();
  const writer = useWriteContract();
  const fileRef = useRef<HTMLInputElement>(null);
  const [module, setModule] = useState<PolicyModule>(PolicyModule.Transfer);
  const [agent, setAgent] = useState("");
  const [callTarget, setCallTarget] = useState("");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [auxiliary, setAuxiliary] = useState("");
  const [recipient, setRecipient] = useState("");
  const [calldata, setCalldata] = useState("0x");
  const [secondTarget, setSecondTarget] = useState("");
  const [secondCalldata, setSecondCalldata] = useState("0x");
  const [maximum, setMaximum] = useState("0");
  const [minimum, setMinimum] = useState("0");
  const [tokenId, setTokenId] = useState("0");
  const [nftStandard, setNftStandard] = useState<1 | 2>(1);
  const [selector, setSelector] = useState("0x00000000");
  const [packageValue, setPackageValue] = useState<SignedIntentPackageV2 | null>(null);
  const [signatureStale, setSignatureStale] = useState(false);
  const [status, setStatus] = useState("");
  const [nonce, setNonce] = useState(() => BigInt(Date.now()));

  const draft = useMemo(() => {
    const account = accountV2Address ?? zero;
    const receiver = asAddress(recipient);
    const target = asAddress(callTarget);
    const token = asAddress(primary);
    const other = asAddress(secondary);
    const aux = asAddress(auxiliary);
    const max = number(maximum);
    const min = number(minimum);
    const asset = (
      assetToken: Address,
      maxSpend: bigint,
      assetRecipient: Address,
      minReceive: bigint,
    ): AssetConstraint => ({ token: assetToken, maxSpend, recipient: assetRecipient, minReceive, minFinalBalance: 0n });
    let assets: AssetConstraint[] = [];
    let allowances: PolicyV2["allowances"] = [];
    let moduleData: Hex = "0x";

    if (module === PolicyModule.Transfer) {
      assets = [asset(token, max, receiver, 0n)];
      moduleData = encodeAbiParameters(
        parseAbiParameters("address,address,uint256,bool,address,bytes4"),
        [token, receiver, max, false, token, "0xa9059cbb"],
      );
    } else if (module === PolicyModule.Swap) {
      assets = [asset(token, max, account, 0n), asset(other, 0n, receiver, min)];
      allowances = [{ token, spender: target, maxFinalAllowance: 0n }];
      moduleData = encodeAbiParameters(parseAbiParameters("address,address,address,address"), [target, token, other, receiver]);
    } else if (module === PolicyModule.Approval) {
      allowances = [{ token, spender: other, maxFinalAllowance: min }];
      moduleData = encodeAbiParameters(parseAbiParameters("address,address,uint256,bool"), [token, other, max, false]);
    } else if (module === PolicyModule.DeFiDeposit) {
      assets = [asset(token, max, account, 0n), asset(target, 0n, receiver, min)];
      allowances = [{ token, spender: target, maxFinalAllowance: 0n }];
      moduleData = encodeAbiParameters(
        parseAbiParameters("address,address,address,uint256,uint256,uint256"),
        [target, token, receiver, max, min, 0n],
      );
    } else if (module === PolicyModule.DeFiWithdrawal) {
      assets = [asset(target, max, account, 0n), asset(token, 0n, receiver, min)];
      moduleData = encodeAbiParameters(
        parseAbiParameters("address,address,address,uint256,uint256"),
        [target, token, receiver, max, min],
      );
    } else if (module === PolicyModule.YieldRebalance) {
      const vaults = [target, aux];
      assets = [asset(token, max, account, 0n), asset(target, max, account, 0n), asset(aux, max, account, 0n)];
      moduleData = encodeAbiParameters(
        parseAbiParameters("address,address,bytes32,uint256,uint256"),
        [
          token,
          other,
          keccak256(encodeAbiParameters(parseAbiParameters("uint256,address[]"), [2n, vaults])),
          max,
          min,
        ],
      );
    } else if (module === PolicyModule.TreasuryPayment) {
      assets = [asset(token, max, receiver, 0n)];
      moduleData = encodeAbiParameters(
        parseAbiParameters("address,address,uint256,bytes32,bytes32,uint48,uint256"),
        [token, receiver, max, id("treasury", nonce), id("budget", nonce), 86400, max],
      );
    } else if (module === PolicyModule.Payroll) {
      assets = [asset(token, max, receiver, 0n)];
      const now = Math.floor(Date.now() / 1000);
      moduleData = encodeAbiParameters(
        parseAbiParameters("address,address,uint256,bytes32,uint256,uint48,uint48"),
        [token, receiver, max, id("payroll", nonce), nonce, now, now + 3600],
      );
    } else if (module === PolicyModule.Subscription) {
      assets = [asset(token, max, receiver, 0n)];
      const now = Math.floor(Date.now() / 1000);
      moduleData = encodeAbiParameters(
        parseAbiParameters("bytes32,address,address,uint256,uint48,uint48,uint48,uint32"),
        [id("subscription", nonce), token, receiver, max, 3600, now, now + 86400, 24],
      );
    } else if (module === PolicyModule.NftPurchase) {
      assets = [asset(other, max, account, 0n)];
      allowances = [{ token: other, spender: target, maxFinalAllowance: 0n }];
      const nftId = number(tokenId);
      moduleData = encodeAbiParameters(
        parseAbiParameters("address,address,uint256,bytes32,address,uint256,address,uint256,uint8,address,uint256,bool"),
        [target, token, nftId, keccak256(encodeAbiParameters(parseAbiParameters("uint256"), [nftId])), other, max, receiver, min || 1n, nftStandard, target, 0n, true],
      );
    } else if (module === PolicyModule.Administration) {
      moduleData = encodeAbiParameters(
        parseAbiParameters("address,bytes4,uint256,uint256,address,bytes32,uint48"),
        [target, asBytes4(selector), min, max, other, id("role", nonce), 0],
      );
    } else if (token !== zero) {
      assets = [asset(token, max, receiver, min)];
    }

    const calls = [{
      target,
      value: 0n,
      data: asHex(calldata),
      operation: 0 as const,
    }];
    if (module === PolicyModule.Batch && isAddress(secondTarget)) {
      calls.push({ target: secondTarget, value: 0n, data: asHex(secondCalldata), operation: 0 });
    }
    const policy: PolicyV2 = {
      module,
      assets,
      allowances,
      nativeConstraint: { maxSpend: 0n, minFinalBalance: 0n },
      moduleData,
    };
    return { calls, policy };
  }, [
    module, callTarget, primary, secondary, auxiliary, recipient, calldata, secondTarget,
    secondCalldata, maximum, minimum, tokenId, nftStandard, selector, nonce,
  ]);

  const invalidateSignedPackage = useCallback(() => {
    if (!packageValue) return;
    setPackageValue(null);
    setSignatureStale(true);
    setStatus("SIGNATURE STALE — RE-SIGN REQUIRED");
  }, [packageValue]);

  // Owner, chain, and configured account are signed manifest fields even though
  // they are provided by the wallet/configuration rather than a text input.
  useEffect(() => {
    if (!packageValue) return;
    if (
      !wallet || !accountV2Address
      || packageValue.manifest.owner.toLowerCase() !== wallet.toLowerCase()
      || packageValue.manifest.account.toLowerCase() !== accountV2Address.toLowerCase()
      || packageValue.manifest.chainId !== BigInt(chainId)
    ) {
      setPackageValue(null);
      setSignatureStale(true);
      setStatus("SIGNATURE STALE — RE-SIGN REQUIRED");
    }
  }, [chainId, packageValue, wallet]);

  const packageUsable = canUseSignedPackage(packageValue, signatureStale);
  const signedSnapshot = packageValue ? signedPackageSnapshot(packageValue) : null;

  async function sign() {
    if (!wallet || !accountV2Address || !isAddress(agent)) return;
    const now = Math.floor(Date.now() / 1000);
    const manifest = {
      version: 2 as const,
      account: accountV2Address,
      owner: wallet,
      agent,
      chainId: BigInt(chainId),
      callsHash: hashCallsV2(draft.calls),
      policyHash: hashPolicyV2(draft.policy),
      nonce,
      validAfter: now,
      validUntil: now + 3600,
      allowBatch: draft.calls.length > 1,
      evidenceMode: 1 as const,
    };
    try {
      const ownerSignature = await signer.signTypedDataAsync({
        domain: { name: "Cresnex IntentLock", version: "2", chainId, verifyingContract: accountV2Address },
        types: intentTypesV2,
        primaryType: "IntentManifest",
        message: manifest,
      });
      const result: SignedIntentPackageV2 = {
        schemaVersion: 2,
        moduleName: policyModuleNames[module],
        manifest,
        calls: draft.calls,
        policy: draft.policy,
        ownerSignature,
      };
      setPackageValue(result);
      setSignatureStale(false);
      setStatus("Owner signature created. Simulate before submission.");
    } catch (error) {
      setStatus(explainError(error));
    }
  }

  async function simulate() {
    if (!packageValue || !packageUsable || !client || !accountV2Address) {
      setStatus("SIGNATURE STALE — RE-SIGN REQUIRED");
      return;
    }
    try {
      const [onchainCallsHash, onchainPolicyHash] = await Promise.all([
        client.readContract({
          address: accountV2Address,
          abi: accountV2Abi,
          functionName: "hashCalls",
          args: [packageValue.calls],
        }),
        client.readContract({
          address: accountV2Address,
          abi: accountV2Abi,
          functionName: "hashPolicy",
          args: [packageValue.policy],
        }),
      ]);
      if (onchainCallsHash !== packageValue.manifest.callsHash || onchainPolicyHash !== packageValue.manifest.policyHash) {
        throw new Error("Local SDK hashes disagree with the configured contract");
      }
      const result = await client.simulateContract({
        account: packageValue.manifest.agent,
        address: accountV2Address,
        abi: accountV2Abi,
        functionName: "executeIntent",
        args: [packageValue.manifest, packageValue.calls, packageValue.policy, packageValue.ownerSignature],
      });
      const predicted = result.result as readonly [boolean, Hex];
      setStatus(predicted[0]
        ? "Contract hashes match the SDK. Simulation predicts a committed execution."
        : `Contract hashes match the SDK. Simulation predicts containment or target failure: ${predicted[1]}`);
    } catch (error) {
      setStatus(`Simulation blocked: ${explainError(error)}`);
    }
  }

  function execute() {
    if (!packageValue || !packageUsable || !accountV2Address) {
      setStatus("SIGNATURE STALE — RE-SIGN REQUIRED");
      return;
    }
    writer.writeContract({
      address: accountV2Address,
      abi: accountV2Abi,
      functionName: "executeIntent",
      args: [packageValue.manifest, packageValue.calls, packageValue.policy, packageValue.ownerSignature],
    });
  }

  function download() {
    if (!packageValue) return;
    const blob = new Blob([stringifyPackageV2(packageValue)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `cresnex-intent-v2-${packageValue.manifest.nonce}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      setPackageValue(parsePackageV2(await file.text()));
      setSignatureStale(false);
      setStatus("Package imported and hashes verified locally.");
    } catch (error) {
      setStatus(`Import rejected: ${explainError(error)}`);
    }
  }

  const configured = Boolean(accountV2Address);
  const canSign = configured && wallet && isAddress(agent) && isAddress(callTarget) && calldata.startsWith("0x");
  const canExecute = Boolean(
    packageUsable && packageValue && wallet?.toLowerCase() === packageValue.manifest.agent.toLowerCase(),
  );

  return (
    <section className="panel builder" id="v2-builder">
      <div className="panel-number">V2 / POLICY SDK</div>
      <div className="eyebrow">Phase 5 research lab</div>
      <h2>Build, verify, and simulate v2</h2>
      <p className="muted">Every package binds complete calls and policy bytes. Imported JSON is rejected if either canonical hash differs.</p>
      {!configured && <p className="error-note">Connect a verified V2 deployment before signing or submitting packages. See the deployment setup panel above for the required public configuration.</p>}
      <div className="form-grid">
        <label>Policy module<select value={module} onChange={(event) => { invalidateSignedPackage(); setModule(Number(event.target.value) as PolicyModule); }}>
          {policyModuleNames.map((name, index) => <option key={name} value={index}>{index} · {name}</option>)}
        </select></label>
        <label>Signed agent<input value={agent} onChange={(event) => { invalidateSignedPackage(); setAgent(event.target.value); }} placeholder="0x…" /></label>
        <label>Exact call target<input value={callTarget} onChange={(event) => { invalidateSignedPackage(); setCallTarget(event.target.value); }} placeholder="router, vault, marketplace, admin…" /></label>
        <label>Primary asset / collection<input value={primary} onChange={(event) => { invalidateSignedPackage(); setPrimary(event.target.value); }} placeholder="0x…" /></label>
        <label>Secondary asset / oracle / approved address<input value={secondary} onChange={(event) => { invalidateSignedPackage(); setSecondary(event.target.value); }} placeholder="0x…" /></label>
        <label>Auxiliary vault / spender<input value={auxiliary} onChange={(event) => { invalidateSignedPackage(); setAuxiliary(event.target.value); }} placeholder="0x…" /></label>
        <label>Recipient / beneficiary<input value={recipient} onChange={(event) => { invalidateSignedPackage(); setRecipient(event.target.value); }} placeholder="0x…" /></label>
        <label>Maximum<input value={maximum} onChange={(event) => { invalidateSignedPackage(); setMaximum(event.target.value); }} inputMode="numeric" /></label>
        <label>Minimum / exact boolean<input value={minimum} onChange={(event) => { invalidateSignedPackage(); setMinimum(event.target.value); }} inputMode="numeric" /></label>
        {module === PolicyModule.NftPurchase && <>
          <label>Token ID<input value={tokenId} onChange={(event) => { invalidateSignedPackage(); setTokenId(event.target.value); }} /></label>
          <label>NFT standard<select value={nftStandard} onChange={(event) => { invalidateSignedPackage(); setNftStandard(Number(event.target.value) as 1 | 2); }}>
            <option value={1}>ERC-721</option><option value={2}>ERC-1155</option>
          </select></label>
        </>}
        {module === PolicyModule.Administration && <label>Admin selector<input value={selector} onChange={(event) => { invalidateSignedPackage(); setSelector(event.target.value); }} placeholder="0x…" /></label>}
        <label className="wide">Complete calldata<input value={calldata} onChange={(event) => { invalidateSignedPackage(); setCalldata(event.target.value); }} /></label>
        {module === PolicyModule.Batch && <>
          <label>Second target<input value={secondTarget} onChange={(event) => { invalidateSignedPackage(); setSecondTarget(event.target.value); }} /></label>
          <label>Second calldata<input value={secondCalldata} onChange={(event) => { invalidateSignedPackage(); setSecondCalldata(event.target.value); }} /></label>
        </>}
      </div>
      <div className="policy">
        <span>{signedSnapshot ? "Signed calls hash" : "Draft calls hash"} <strong>{(signedSnapshot?.callsHash ?? hashCallsV2(draft.calls)).slice(0, 12)}…</strong></span>
        <span>{signedSnapshot ? "Signed policy hash" : "Draft policy hash"} <strong>{(signedSnapshot?.policyHash ?? hashPolicyV2(draft.policy)).slice(0, 12)}…</strong></span>
        <span>{signedSnapshot ? "Signed module" : "Draft module"} <strong>{signedSnapshot?.moduleName ?? policyModuleNames[module]}</strong></span>
      </div>
      <div className="control-row">
        <button onClick={() => { const wasSigned = Boolean(packageValue); invalidateSignedPackage(); setNonce(BigInt(Date.now())); setStatus(wasSigned ? "SIGNATURE STALE — RE-SIGN REQUIRED. Fresh draft nonce created." : "Fresh draft nonce created."); }}>New draft nonce</button>
        <button className="primary" disabled={!canSign || signer.isPending} onClick={sign}>Sign v2 package</button>
        <button disabled={!packageUsable} onClick={simulate}>Simulate</button>
        <button disabled={!canExecute || writer.isPending} onClick={execute}>Submit as agent</button>
        <button disabled={!packageValue} onClick={download}>Export JSON</button>
        <button onClick={() => fileRef.current?.click()}>Import JSON</button>
        <input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => importFile(event.target.files?.[0])} />
      </div>
      {signatureStale && <p className="error-note">SIGNATURE STALE — RE-SIGN REQUIRED</p>}
      {signedSnapshot && <div className="hash success"><span>SIGNED PACKAGE READY · {signedSnapshot.moduleName}</span><code>Agent {signedSnapshot.agent} · Nonce {signedSnapshot.nonce.toString()} · Calls {signedSnapshot.callsHash} · Policy {signedSnapshot.policyHash} · Target {signedSnapshot.callTarget} · Value {signedSnapshot.callValue.toString()} · Calldata {signedSnapshot.calldata} · Recipient {signedSnapshot.recipient ?? "not applicable"} · Valid {signedSnapshot.validAfter}–{signedSnapshot.validUntil}</code></div>}
      {(status || writer.error) && <p className={status.includes("blocked") || status.includes("rejected") || status.includes("containment") || status.includes("STALE") || writer.error ? "error-note" : "success-note"}>
        {writer.error ? explainError(writer.error) : status}
      </p>}
      <p className="demo-note">Violation codes are decoded as: {violationNames.slice(1).join(" · ")}. Simulation cannot predict state changes between simulation and mining.</p>
    </section>
  );
}
