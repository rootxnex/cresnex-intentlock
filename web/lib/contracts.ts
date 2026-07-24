import { type Abi, type Address, isAddress, parseAbi } from "viem";

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
