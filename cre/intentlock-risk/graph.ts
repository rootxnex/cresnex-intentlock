import { bytesToBase64, text, type HTTPSendRequester } from "@chainlink/cre-sdk";

export const AGENT_RECENT_VIOLATIONS_QUERY = `query AgentRecentViolations($agent: Bytes!, $windowStart: BigInt!) {
  violations(first: 3, where: { agent: $agent, timestamp_gte: $windowStart }, orderBy: timestamp, orderDirection: desc) {
    id account intentDigest evidenceHash code module strikeCount quarantined
    blockNumber blockHash timestamp transactionHash logIndex
  }
  agent(id: $agent) { id lifetimeViolationCount lastViolationBlock lastViolationTimestamp }
  _meta { block { number hash } hasIndexingErrors }
}`;

export type GraphRequestArguments = { endpoint: string; agent: string; windowStart: string };

export function fetchGraphEvidence(requester: HTTPSendRequester, args: GraphRequestArguments): string {
  const body = JSON.stringify({
    query: AGENT_RECENT_VIOLATIONS_QUERY,
    variables: { agent: args.agent, windowStart: args.windowStart },
  });
  const response = requester.sendRequest({
    url: args.endpoint,
    method: "POST",
    multiHeaders: {
      "Content-Type": { values: ["application/json"] },
      Accept: { values: ["application/json"] },
    },
    body: bytesToBase64(new TextEncoder().encode(body)),
    timeout: "10s",
  }).result();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Graph HTTP status ${response.statusCode}`);
  }
  return text(response);
}

export function parseGraphEvidence(raw: string): unknown {
  if (typeof raw !== "string" || raw.length === 0) throw new Error("empty Graph response");
  return JSON.parse(raw) as unknown;
}

export function transactionHashes(response: unknown): string[] {
  if (typeof response !== "object" || response === null || Array.isArray(response)) return [];
  const data = (response as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const violations = (data as Record<string, unknown>).violations;
  if (!Array.isArray(violations)) return [];
  return violations.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const hash = (entry as Record<string, unknown>).transactionHash;
    return typeof hash === "string" ? [hash] : [];
  });
}
