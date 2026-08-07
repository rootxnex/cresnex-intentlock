import { type Abi, type Address, isAddress, parseAbi } from "viem";

const configuredChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "84532");
export const targetChainId = configuredChainId === 31337 ? 31337 : 84532;

export const accountAbi = parseAbi([
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function quarantineThreshold() view returns (uint256)",
  "function agents(address) view returns (bool registered, bool quarantined, uint256 strikes)",
  "function registerAgent(address agent)",
  "function removeAgent(address agent)",
  "function resetAgentStrikes(address agent)",
  "function unquarantineAgent(address agent)",
  "function setQuarantineThreshold(uint256 threshold)",
  "function pause()",
  "function unpause()",
  "function executeIntent((address account,address agent,uint256 chainId,bytes32 callsHash,address inputToken,uint256 maxInputAmount,address outputToken,uint256 minOutputAmount,address recipient,address approvalToken,address approvalSpender,uint256 maxFinalAllowance,uint256 nonce,uint48 validAfter,uint48 validUntil,bool allowBatch) manifest,(address target,uint256 value,bytes data)[] calls,bytes ownerSignature) returns (bool success, bytes32 evidenceHash)",
  "event IntentExecuted(bytes32 indexed intentHash,address indexed agent)",
  "event IntentViolation(bytes32 indexed intentHash,address indexed agent,bytes32 evidenceHash,bytes4 reasonSelector,uint256 strikeCount)",
  "event AgentQuarantined(address indexed agent,uint256 strikeCount)",
  "event AgentRecovered(address indexed agent)",
]) as Abi;

export const accountAddress = (
  isAddress(process.env.NEXT_PUBLIC_ACCOUNT_ADDRESS ?? "")
    ? process.env.NEXT_PUBLIC_ACCOUNT_ADDRESS
    : undefined
) as Address | undefined;

export const deploymentBlock = BigInt(process.env.NEXT_PUBLIC_DEPLOYMENT_BLOCK || "0");

export const accountV2Abi = parseAbi([
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function quarantineThreshold() view returns (uint256)",
  "function agents(address) view returns (bool registered, bool quarantined, uint64 strikes)",
  "function registerAgent(address agent)",
  "function removeAgent(address agent)",
  "function emergencyRevokeAgent(address agent)",
  "function resetAgentStrikes(address agent)",
  "function unquarantineAgent(address agent)",
  "function setQuarantineThreshold(uint256 threshold)",
  "function cancelNonce(uint256 nonce)",
  "function pause()",
  "function unpause()",
  "function hashCalls((address target,uint256 value,bytes data,uint8 operation)[] calls) pure returns (bytes32)",
  "function hashPolicy((uint8 module,(address token,uint256 maxSpend,address recipient,uint256 minReceive,uint256 minFinalBalance)[] assets,(address token,address spender,uint256 maxFinalAllowance)[] allowances,(uint256 maxSpend,uint256 minFinalBalance) nativeConstraint,bytes moduleData) policy) pure returns (bytes32)",
  "function executeIntent((uint16 version,address account,address owner,address agent,uint256 chainId,bytes32 callsHash,bytes32 policyHash,uint256 nonce,uint48 validAfter,uint48 validUntil,bool allowBatch,uint8 evidenceMode) manifest,(address target,uint256 value,bytes data,uint8 operation)[] calls,(uint8 module,(address token,uint256 maxSpend,address recipient,uint256 minReceive,uint256 minFinalBalance)[] assets,(address token,address spender,uint256 maxFinalAllowance)[] allowances,(uint256 maxSpend,uint256 minFinalBalance) nativeConstraint,bytes moduleData) policy,bytes ownerSignature) returns (bool success,bytes32 evidenceHash)",
  "event IntentExecuted(bytes32 indexed intentDigest,address indexed agent,bytes32 indexed callsHash)",
  "event IntentViolation(bytes32 indexed intentDigest,address indexed agent,uint8 code,uint8 module,bytes32 evidenceHash,uint256 strikeCount,bool quarantined)",
  "event ExecutionFailed(bytes32 indexed intentDigest,address indexed agent,bytes32 indexed callsHash,bytes32 failureHash)",
  "event AgentEmergencyRevoked(address indexed agent)",
  "event NonceCancelled(uint256 indexed nonce)",
]) as Abi;

export const accountV2Address = (
  isAddress(process.env.NEXT_PUBLIC_ACCOUNT_V2_ADDRESS ?? "")
    ? process.env.NEXT_PUBLIC_ACCOUNT_V2_ADDRESS
    : undefined
) as Address | undefined;

export const deploymentV2Block = BigInt(process.env.NEXT_PUBLIC_DEPLOYMENT_V2_BLOCK || "0");
