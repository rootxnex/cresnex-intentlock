"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  decodeEventLog,
  isAddress,
  type Address,
  type Hex,
} from "viem";

import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignTypedData,
  useWriteContract,
} from "wagmi";

import {
  buildApprovedNamespaces,
} from "@walletconnect/utils";

import type {
  IWalletKit,
  WalletKitTypes,
} from "@reown/walletkit";

import {
  accountV2Abi,
  accountV2Address,
} from "@/lib/contracts";

import {
  hashCallsV2,
  hashPolicyV2,
  intentTypesV2,
  policyModuleNames,
  type SignedIntentPackageV2,
} from "@/lib/intentV2";

import {
  BASE_SEPOLIA_CAIP2,
  INTENTLOCK_WALLETKIT_EVENTS,
  INTENTLOCK_WALLETKIT_METHODS,
  buildExactWalletConnectPolicy,
  classifyWalletConnectCall,
  normalizeWalletConnectRequest,
} from "@/lib/reown/request";

import {
  getIntentLockWalletKit,
} from "@/lib/reown/walletkit";

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function short(address?: string): string {
  if (!address) return "—";
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function ReownWalletKitGateway() {
  const { address: connectedWallet } = useAccount();
  const chainId = useChainId();
  const client = usePublicClient();

  const signer = useSignTypedData();
  const executor = useWriteContract();

  const [walletKit, setWalletKit] =
    useState<IWalletKit | null>(null);

  const [uri, setUri] = useState("");

  const [proposal, setProposal] =
    useState<WalletKitTypes.SessionProposal | null>(null);

  const [pendingRequest, setPendingRequest] =
    useState<WalletKitTypes.SessionRequest | null>(null);

  const [agent, setAgent] = useState("");

  const [packageValue, setPackageValue] =
    useState<SignedIntentPackageV2 | null>(null);

  const [boundRequestId, setBoundRequestId] =
    useState<number | null>(null);

  const [sessionCount, setSessionCount] =
    useState(0);

  const [status, setStatus] = useState(
    "WalletKit is initializing.",
  );

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    let activeKit: IWalletKit | null = null;

    const onProposal = (
      value: WalletKitTypes.SessionProposal,
    ) => {
      setProposal(value);

      const app =
        value.params.proposer.metadata.name ||
        value.params.proposer.metadata.url ||
        "Unknown dApp";

      setStatus(
        `${app} requested an IntentLock session.`,
      );
    };

    const onRequest = (
      value: WalletKitTypes.SessionRequest,
    ) => {
      if (!accountV2Address) {
        void activeKit?.respondSessionRequest({
          topic: value.topic,
          response: {
            id: value.id,
            jsonrpc: "2.0",
            error: {
              code: 5000,
              message:
                "IntentLock V2 account is not configured",
            },
          },
        });

        return;
      }

      try {
        const call = normalizeWalletConnectRequest(
          {
            chainId: value.params.chainId,
            method: value.params.request.method,
            params: value.params.request.params,
          },
          accountV2Address,
        );

        classifyWalletConnectCall(call);

        setPendingRequest(value);
        setPackageValue(null);
        setBoundRequestId(null);

        setStatus(
          "Supported WalletConnect transaction received. Review and bind an exact policy.",
        );
      } catch (error) {
        void activeKit?.respondSessionRequest({
          topic: value.topic,
          response: {
            id: value.id,
            jsonrpc: "2.0",
            error: {
              code: 5000,
              message: message(error),
            },
          },
        });
      }
    };

    const onDelete = () => {
      setSessionCount(
        activeKit
          ? Object.keys(
              activeKit.getActiveSessions(),
            ).length
          : 0,
      );
    };

    const onExpire = (
      value: WalletKitTypes.SessionRequestExpire,
    ) => {
      setPendingRequest((current) =>
        current?.id === value.id
          ? null
          : current,
      );

      setPackageValue(null);
      setBoundRequestId(null);
    };

    getIntentLockWalletKit()
      .then((kit) => {
        if (disposed) return;

        activeKit = kit;
        setWalletKit(kit);

        setSessionCount(
          Object.keys(
            kit.getActiveSessions(),
          ).length,
        );

        kit.on(
          "session_proposal",
          onProposal,
        );

        kit.on(
          "session_request",
          onRequest,
        );

        kit.on(
          "session_delete",
          onDelete,
        );

        kit.on(
          "session_request_expire",
          onExpire,
        );

        setStatus(
          "WalletKit ready. Paste a WalletConnect wc: URI to pair a dApp.",
        );
      })
      .catch((error) => {
        setStatus(
          `WalletKit unavailable: ${message(error)}`,
        );
      });

    return () => {
      disposed = true;

      if (!activeKit) return;

      activeKit.off(
        "session_proposal",
        onProposal,
      );

      activeKit.off(
        "session_request",
        onRequest,
      );

      activeKit.off(
        "session_delete",
        onDelete,
      );

      activeKit.off(
        "session_request_expire",
        onExpire,
      );
    };
  }, []);

  const requestDetails = useMemo(() => {
    if (
      !pendingRequest ||
      !accountV2Address
    ) {
      return null;
    }

    try {
      const call =
        normalizeWalletConnectRequest(
          {
            chainId:
              pendingRequest.params.chainId,

            method:
              pendingRequest.params.request.method,

            params:
              pendingRequest.params.request.params,
          },
          accountV2Address,
        );

      const classification =
        classifyWalletConnectCall(call);

      const policy =
        buildExactWalletConnectPolicy(
          classification,
        );

      return {
        call,
        classification,
        policy,
      };
    } catch {
      return null;
    }
  }, [pendingRequest]);

  async function pairDapp() {
    if (!walletKit) {
      setStatus(
        "WalletKit has not initialized yet.",
      );
      return;
    }

    const pairingUri = uri.trim();

    if (!pairingUri.startsWith("wc:")) {
      setStatus(
        "Paste a valid WalletConnect wc: URI.",
      );
      return;
    }

    setBusy(true);

    try {
      await walletKit.pair({
        uri: pairingUri,
      });

      setStatus(
        "Pairing started. Waiting for the dApp session proposal.",
      );
    } catch (error) {
      setStatus(
        `Pairing failed: ${message(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function approveProposal() {
    if (
      !walletKit ||
      !proposal ||
      !accountV2Address
    ) {
      return;
    }

    setBusy(true);

    try {
      const namespaces =
        buildApprovedNamespaces({
          proposal: proposal.params,

          supportedNamespaces: {
            eip155: {
              chains: [
                BASE_SEPOLIA_CAIP2,
              ],

              methods: [
                ...INTENTLOCK_WALLETKIT_METHODS,
              ],

              events: [
                ...INTENTLOCK_WALLETKIT_EVENTS,
              ],

              accounts: [
                `${BASE_SEPOLIA_CAIP2}:${accountV2Address}`,
              ],
            },
          },
        });

      await walletKit.approveSession({
        id: proposal.id,
        namespaces,
      });

      setProposal(null);

      setSessionCount(
        Object.keys(
          walletKit.getActiveSessions(),
        ).length,
      );

      setStatus(
        "WalletConnect session approved with the IntentLock V2 account.",
      );
    } catch (error) {
      setStatus(
        `Session approval blocked: ${message(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function rejectProposal() {
    if (!walletKit || !proposal) return;

    setBusy(true);

    try {
      await walletKit.rejectSession({
        id: proposal.id,
        reason: {
          code: 5000,
          message:
            "IntentLock user rejected the session",
        },
      });

      setProposal(null);

      setStatus(
        "WalletConnect session proposal rejected.",
      );
    } catch (error) {
      setStatus(
        `Could not reject proposal: ${message(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function rejectPendingRequest(
    reason =
      "IntentLock user rejected the request",
  ) {
    if (
      !walletKit ||
      !pendingRequest
    ) {
      return;
    }

    setBusy(true);

    try {
      await walletKit.respondSessionRequest({
        topic: pendingRequest.topic,

        response: {
          id: pendingRequest.id,
          jsonrpc: "2.0",

          error: {
            code: 5000,
            message: reason,
          },
        },
      });

      setPendingRequest(null);
      setPackageValue(null);
      setBoundRequestId(null);

      setStatus(
        "WalletConnect request rejected.",
      );
    } catch (error) {
      setStatus(
        `Request rejection failed: ${message(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function bindExactPolicy() {
    if (
      !pendingRequest ||
      !requestDetails ||
      !connectedWallet ||
      !client ||
      !accountV2Address
    ) {
      setStatus(
        "Connect the IntentLock owner wallet before signing.",
      );
      return;
    }

    if (chainId !== 84532) {
      setStatus(
        "Switch the connected owner wallet to Base Sepolia.",
      );
      return;
    }

    if (!isAddress(agent)) {
      setStatus(
        "Enter a valid registered IntentLock agent address.",
      );
      return;
    }

    setBusy(true);

    try {
      const onchainOwner =
        (await client.readContract({
          address: accountV2Address,
          abi: accountV2Abi,
          functionName: "owner",
        })) as Address;

      if (
        connectedWallet.toLowerCase() !==
        onchainOwner.toLowerCase()
      ) {
        throw new Error(
          `Connected wallet ${short(
            connectedWallet,
          )} is not the IntentLock owner ${short(
            onchainOwner,
          )}`,
        );
      }

      const agentState =
        (await client.readContract({
          address: accountV2Address,
          abi: accountV2Abi,
          functionName: "agents",
          args: [agent],
        })) as readonly [
          boolean,
          boolean,
          bigint,
        ];

      const [
        registered,
        quarantined,
      ] = agentState;

      if (!registered) {
        throw new Error(
          "The requested execution agent is not registered in IntentLock",
        );
      }

      if (quarantined) {
        throw new Error(
          "The requested execution agent is quarantined",
        );
      }

      const now =
        Math.floor(Date.now() / 1000);

      const random =
        crypto.getRandomValues(
          new Uint32Array(1),
        )[0];

      const nonce =
        (BigInt(Date.now()) << 32n) |
        BigInt(random);

      const calls = [
        requestDetails.call,
      ];

      const policy =
        requestDetails.policy;

      const manifest = {
        version: 2 as const,

        account:
          accountV2Address,

        owner:
          onchainOwner,

        agent:
          agent as Address,

        chainId:
          84532n,

        callsHash:
          hashCallsV2(calls),

        policyHash:
          hashPolicyV2(policy),

        nonce,

        validAfter:
          now,

        validUntil:
          now + 600,

        allowBatch:
          false,

        evidenceMode:
          1 as const,
      };

      const ownerSignature =
        await signer.signTypedDataAsync({
          domain: {
            name:
              "Cresnex IntentLock",

            version:
              "2",

            chainId:
              84532,

            verifyingContract:
              accountV2Address,
          },

          types:
            intentTypesV2,

          primaryType:
            "IntentManifest",

          message:
            manifest,
        });

      const value:
        SignedIntentPackageV2 = {
          schemaVersion: 2,

          moduleName:
            policyModuleNames[
              policy.module
            ],

          manifest,
          calls,
          policy,
          ownerSignature,
        };

      setPackageValue(value);

      setBoundRequestId(
        pendingRequest.id,
      );

      setStatus(
        "Exact WalletConnect request is now bound to an owner-signed IntentLock V2 policy. Switch to the registered agent wallet to execute.",
      );
    } catch (error) {
      setStatus(
        `Policy binding blocked: ${message(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function executeAndRespond() {
    if (
      !walletKit ||
      !pendingRequest ||
      !packageValue ||
      !client ||
      !connectedWallet ||
      !accountV2Address
    ) {
      return;
    }

    if (
      boundRequestId !==
      pendingRequest.id
    ) {
      setStatus(
        "The signed package does not belong to the current WalletConnect request.",
      );
      return;
    }

    if (
      connectedWallet.toLowerCase() !==
      packageValue.manifest.agent.toLowerCase()
    ) {
      setStatus(
        `Connect the registered agent wallet ${short(
          packageValue.manifest.agent,
        )} before execution.`,
      );
      return;
    }

    if (chainId !== 84532) {
      setStatus(
        "Switch the agent wallet to Base Sepolia.",
      );
      return;
    }

    setBusy(true);

    try {
      const simulation =
        await client.simulateContract({
          account:
            connectedWallet,

          address:
            accountV2Address,

          abi:
            accountV2Abi,

          functionName:
            "executeIntent",

          args: [
            packageValue.manifest,
            packageValue.calls,
            packageValue.policy,
            packageValue.ownerSignature,
          ],
        });

      const predicted =
        simulation.result as readonly [
          boolean,
          Hex,
        ];

      setStatus(
        predicted[0]
          ? "Simulation predicts commit. Submitting IntentLock execution."
          : "Simulation predicts containment/target failure. Submitting through IntentLock so the unsafe effects remain rolled back and evidence can be recorded.",
      );

      const transactionHash =
        await executor.writeContractAsync({
          address:
            accountV2Address,

          abi:
            accountV2Abi,

          functionName:
            "executeIntent",

          args: [
            packageValue.manifest,
            packageValue.calls,
            packageValue.policy,
            packageValue.ownerSignature,
          ],
        });

      const receipt =
        await client.waitForTransactionReceipt({
          hash:
            transactionHash,
        });

      if (receipt.status !== "success") {
        throw new Error(
          `IntentLock execution reverted: ${transactionHash}`,
        );
      }

      let committed = false;
      let containedReason =
        "IntentLock did not emit IntentExecuted";

      for (const log of receipt.logs) {
        if (
          log.address.toLowerCase() !==
          accountV2Address.toLowerCase()
        ) {
          continue;
        }

        try {
          const decoded =
            decodeEventLog({
              abi:
                accountV2Abi,

              data:
                log.data,

              topics:
                log.topics,
            });

          if (
            decoded.eventName ===
            "IntentExecuted"
          ) {
            committed = true;
          }

          if (
            decoded.eventName ===
            "IntentViolation"
          ) {
            containedReason =
              "IntentLock contained a policy violation";
          }

          if (
            decoded.eventName ===
            "ExecutionFailed"
          ) {
            containedReason =
              "IntentLock contained a target execution failure";
          }
        } catch {
          // Ignore unrelated account logs.
        }
      }

      if (committed) {
        await walletKit.respondSessionRequest({
          topic:
            pendingRequest.topic,

          response: {
            id:
              pendingRequest.id,

            jsonrpc:
              "2.0",

            result:
              transactionHash,
          },
        });

        setStatus(
          `IntentLock committed the request and returned ${transactionHash} to the dApp.`,
        );
      } else {
        await walletKit.respondSessionRequest({
          topic:
            pendingRequest.topic,

          response: {
            id:
              pendingRequest.id,

            jsonrpc:
              "2.0",

            error: {
              code:
                5000,

              message:
                `${containedReason}. Evidence transaction: ${transactionHash}`,
            },
          },
        });

        setStatus(
          `${containedReason}. Unsafe effects were not reported as committed. Evidence transaction: ${transactionHash}`,
        );
      }

      setPendingRequest(null);
      setPackageValue(null);
      setBoundRequestId(null);
    } catch (error) {
      setStatus(
        `Execution blocked: ${message(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const canExecute =
    Boolean(
      packageValue &&
      connectedWallet &&
      connectedWallet.toLowerCase() ===
        packageValue.manifest.agent.toLowerCase(),
    );

  return (
    <section
      className="panel builder"
      id="walletconnect-gateway"
    >
      <div className="panel-number">
        REOWN / WALLETKIT
      </div>

      <div className="eyebrow">
        WalletConnect policy gateway
      </div>

      <h2>
        Connect dApps through IntentLock
      </h2>

      <p className="muted">
        WalletConnect is only the transport.
        Every supported transaction is decoded,
        converted into an exact IntentLock V2
        policy, owner-signed, executed by a
        registered agent, and verified from the
        resulting IntentLock event.
      </p>

      {!accountV2Address && (
        <p className="error-note">
          NEXT_PUBLIC_ACCOUNT_V2_ADDRESS is not
          configured.
        </p>
      )}

      <div className="form-grid">
        <label className="wide">
          WalletConnect URI

          <input
            value={uri}
            onChange={(event) =>
              setUri(event.target.value)
            }
            placeholder="wc:..."
            spellCheck={false}
          />
        </label>

        <label>
          Registered execution agent

          <input
            value={agent}
            onChange={(event) =>
              setAgent(event.target.value)
            }
            placeholder="0x..."
            spellCheck={false}
          />
        </label>

        <label>
          Active WalletKit sessions

          <input
            value={String(sessionCount)}
            readOnly
          />
        </label>
      </div>

      <div className="control-row">
        <button
          className="primary"
          disabled={
            busy ||
            !walletKit ||
            !uri.trim()
          }
          onClick={pairDapp}
        >
          Pair dApp
        </button>
      </div>

      {proposal && (
        <div className="policy">
          <span>
            dApp{" "}
            <strong>
              {proposal.params.proposer.metadata
                .name || "Unknown"}
            </strong>
          </span>

          <span>
            Origin{" "}
            <strong>
              {proposal.params.proposer.metadata
                .url || "Unknown"}
            </strong>
          </span>

          <div className="control-row">
            <button
              className="primary"
              disabled={busy}
              onClick={approveProposal}
            >
              Approve restricted session
            </button>

            <button
              disabled={busy}
              onClick={rejectProposal}
            >
              Reject session
            </button>
          </div>
        </div>
      )}

      {pendingRequest &&
        requestDetails && (
          <div className="policy">
            <span>
              Method{" "}
              <strong>
                {
                  pendingRequest.params.request
                    .method
                }
              </strong>
            </span>

            <span>
              Chain{" "}
              <strong>
                {
                  pendingRequest.params
                    .chainId
                }
              </strong>
            </span>

            <span>
              Action{" "}
              <strong>
                {
                  requestDetails
                    .classification.kind
                }
              </strong>
            </span>

            <span>
              Token{" "}
              <strong>
                {short(
                  requestDetails
                    .classification.token,
                )}
              </strong>
            </span>

            {requestDetails.classification
              .kind === "transfer" ? (
              <span>
                Recipient{" "}
                <strong>
                  {short(
                    requestDetails
                      .classification
                      .recipient,
                  )}
                </strong>
              </span>
            ) : (
              <span>
                Spender{" "}
                <strong>
                  {short(
                    requestDetails
                      .classification
                      .spender,
                  )}
                </strong>
              </span>
            )}

            <span>
              Exact amount{" "}
              <strong>
                {requestDetails.classification.amount.toString()}
              </strong>
            </span>

            <div className="control-row">
              <button
                className="primary"
                disabled={
                  busy ||
                  !connectedWallet ||
                  !isAddress(agent)
                }
                onClick={bindExactPolicy}
              >
                Bind exact policy + owner sign
              </button>

              <button
                disabled={busy}
                onClick={() =>
                  rejectPendingRequest()
                }
              >
                Reject request
              </button>
            </div>
          </div>
        )}

      {packageValue && (
        <div className="hash success">
          <span>
            Owner-authorized WalletConnect package
            · {packageValue.moduleName}
          </span>

          <code>
            callsHash{" "}
            {packageValue.manifest.callsHash}
          </code>

          <code>
            policyHash{" "}
            {packageValue.manifest.policyHash}
          </code>

          <code>
            agent{" "}
            {packageValue.manifest.agent}
          </code>

          <div className="control-row">
            <button
              className="primary"
              disabled={
                busy ||
                !canExecute
              }
              onClick={executeAndRespond}
            >
              Execute as agent + respond
            </button>
          </div>

          {!canExecute && (
            <span>
              Switch the connected wallet to{" "}
              {short(
                packageValue.manifest.agent,
              )}
              .
            </span>
          )}
        </div>
      )}

      <p
        className={
          status.includes("blocked") ||
          status.includes("failed") ||
          status.includes("unavailable")
            ? "error-note"
            : "success-note"
        }
      >
        {status}
      </p>

      <p className="demo-note">
        Current security boundary: Base Sepolia,
        eth_sendTransaction, ERC-20 transfer(),
        and ERC-20 approve() only. Arbitrary
        signing and unknown calldata are rejected.
      </p>
    </section>
  );
}
