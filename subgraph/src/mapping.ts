import { BigInt } from "@graphprotocol/graph-ts";
import { IntentViolation } from "../generated/CresnexIntentLockAccountV2/CresnexIntentLockAccountV2";
import { Agent, Violation } from "../generated/schema";

export function handleIntentViolation(event: IntentViolation): void {
  let agent = Agent.load(event.params.agent);
  if (agent == null) {
    agent = new Agent(event.params.agent);
    agent.lifetimeViolationCount = BigInt.zero();
  }

  agent.lifetimeViolationCount = agent.lifetimeViolationCount.plus(BigInt.fromI32(1));
  agent.lastViolationBlock = event.block.number;
  agent.lastViolationTimestamp = event.block.timestamp;
  agent.save();

  const violationId = event.transaction.hash.concatI32(event.logIndex.toI32());
  const violation = new Violation(violationId);
  violation.agent = agent.id;
  violation.account = event.address;
  violation.intentDigest = event.params.intentDigest;
  violation.evidenceHash = event.params.evidenceHash;
  violation.code = event.params.code;
  violation.module = event.params.module;
  violation.strikeCount = event.params.strikeCount;
  violation.quarantined = event.params.quarantined;
  violation.blockNumber = event.block.number;
  violation.blockHash = event.block.hash;
  violation.timestamp = event.block.timestamp;
  violation.transactionHash = event.transaction.hash;
  violation.logIndex = event.logIndex;
  violation.save();
}
