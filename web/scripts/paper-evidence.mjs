import {
  decodeErrorResult,
  decodeEventLog,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  keccak256,
  parseAbi,
} from "viem";

import {
  loadArtifacts,
} from "./paper-fixture-preflight.mjs";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000";

const ZERO_HASH =
  `0x${"00".repeat(32)}`;

const COMMON_ERROR_ABI =
  parseAbi([
    "error ECDSAInvalidSignature()",
    "error ECDSAInvalidSignatureLength(uint256 length)",
    "error ECDSAInvalidSignatureS(bytes32 s)",
    "error ReentrancyGuardReentrantCall()",
    "error OwnableUnauthorizedAccount(address account)",
    "error EnforcedPause()",
  ]);

function fail(message) {
  throw new Error(message);
}

function lower(value) {
  return typeof value === "string"
    ? value.toLowerCase()
    : value;
}

function addressEqual(
  left,
  right,
) {
  return (
    typeof left === "string"
    && typeof right === "string"
    && lower(left) === lower(right)
  );
}

function hashEqual(
  left,
  right,
) {
  return (
    typeof left === "string"
    && typeof right === "string"
    && lower(left) === lower(right)
  );
}

function safeNumber(
  value,
  label,
) {
  if (
    value === null
    || value === undefined
  ) {
    return null;
  }

  const numeric =
    typeof value === "bigint"
      ? value
      : BigInt(value);

  if (
    numeric
    > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail(
      `${label} exceeds JS safe integer range`,
    );
  }

  return Number(numeric);
}

export function normalizeReceiptStatus(
  status,
) {
  if (
    status === "success"
    || status === 1
    || status === 1n
    || status === "0x1"
  ) {
    return 1;
  }

  if (
    status === "reverted"
    || status === 0
    || status === 0n
    || status === "0x0"
  ) {
    return 0;
  }

  return null;
}

export function extractReceiptMetadata(
  receipt,
) {
  return {
    outerReceiptStatus:
      normalizeReceiptStatus(
        receipt.status,
      ),

    gasUsed:
      safeNumber(
        receipt.gasUsed,
        "gasUsed",
      ),

    blockNumber:
      safeNumber(
        receipt.blockNumber,
        "blockNumber",
      ),

    transactionHash:
      receipt.transactionHash
      ?? null,
  };
}

function emptyDSignals() {
  return {
    intentExecuted:
      false,

    intentViolation:
      false,

    executionFailed:
      false,

    intentExecutedEvent:
      null,

    intentViolationEvent:
      null,

    executionFailedEvent:
      null,
  };
}

export function extractDReceiptSignals({
  receipt,
  account,
  abi,
}) {
  const result =
    emptyDSignals();

  for (
    const log
    of receipt.logs ?? []
  ) {
    if (
      typeof log.address === "string"
      && !addressEqual(
        log.address,
        account,
      )
    ) {
      continue;
    }

    let decoded;

    try {
      decoded =
        decodeEventLog({
          abi,
          data:
            log.data ?? "0x",
          topics:
            log.topics ?? [],
          strict: false,
        });
    } catch {
      continue;
    }

    switch (
      decoded.eventName
    ) {
      case "IntentExecuted":
        result.intentExecuted =
          true;

        result.intentExecutedEvent =
          decoded.args;

        break;

      case "IntentViolation":
        result.intentViolation =
          true;

        result.intentViolationEvent =
          decoded.args;

        break;

      case "ExecutionFailed":
        result.executionFailed =
          true;

        result.executionFailedEvent =
          decoded.args;

        break;

      default:
        break;
    }
  }

  return result;
}

function baselineAbi(
  baseline,
  artifacts,
) {
  switch (baseline) {
    case "A":
      return artifacts.A.abi;

    case "B":
      return artifacts.B.abi;

    case "C":
      return artifacts.C.abi;

    case "D":
      return artifacts.D.abi;

    default:
      fail(
        `unknown baseline ${baseline}`,
      );
  }
}

export function decodeObservedError({
  baseline,
  data,
  artifacts,
}) {
  if (
    typeof data !== "string"
    || !data.startsWith("0x")
    || data.length < 10
  ) {
    return {
      errorName:
        null,

      errorArgs:
        null,

      errorSelector:
        null,

      revertHash:
        null,
    };
  }

  const abi = [
    ...baselineAbi(
      baseline,
      artifacts,
    ),
    ...COMMON_ERROR_ABI,
  ];

  try {
    const decoded =
      decodeErrorResult({
        abi,
        data,
      });

    return {
      errorName:
        decoded.errorName,

      errorArgs:
        decoded.args
        ?? [],

      errorSelector:
        data.slice(0, 10),

      revertHash:
        keccak256(data),
    };
  } catch {
    return {
      errorName:
        null,

      errorArgs:
        null,

      errorSelector:
        data.slice(0, 10),

      revertHash:
        keccak256(data),
    };
  }
}

export function normalizeViolationRecord(
  raw,
) {
  if (
    Array.isArray(raw)
  ) {
    if (raw.length < 10) {
      fail(
        "violation getter returned fewer than 10 fields",
      );
    }

    return {
      intentDigest:
        raw[0],

      agent:
        raw[1],

      code:
        Number(raw[2]),

      module:
        Number(raw[3]),

      callsHash:
        raw[4],

      innerEvidenceHash:
        raw[5],

      strikeCount:
        BigInt(raw[6]),

      quarantined:
        raw[7],

      blockNumber:
        BigInt(raw[8]),

      timestamp:
        BigInt(raw[9]),
    };
  }

  if (
    raw
    && typeof raw === "object"
  ) {
    return {
      intentDigest:
        raw.intentDigest,

      agent:
        raw.agent,

      code:
        Number(raw.code),

      module:
        Number(raw.module),

      callsHash:
        raw.callsHash,

      innerEvidenceHash:
        raw.evidenceHash,

      strikeCount:
        BigInt(raw.strikeCount),

      quarantined:
        raw.quarantined,

      blockNumber:
        BigInt(raw.blockNumber),

      timestamp:
        BigInt(raw.timestamp),
    };
  }

  fail(
    "unsupported violation getter result",
  );
}

export function violationRecordPresent(
  record,
) {
  return (
    record.intentDigest
      !== ZERO_HASH
    && lower(record.agent)
      !== ZERO_ADDRESS
    && record.blockNumber
      > 0n
    && record.timestamp
      > 0n
  );
}

export async function verifyStoredViolation({
  publicClient,
  account,
  abi,
  event,
}) {
  if (
    !event
    || typeof event.evidenceHash
      !== "string"
  ) {
    return {
      storedViolation:
        false,

      violationRecord:
        null,

      storedViolationMatchesEvent:
        false,
    };
  }

  const raw =
    await publicClient.readContract({
      address:
        account,

      abi,

      functionName:
        "violations",

      args: [
        event.evidenceHash,
      ],
    });

  const record =
    normalizeViolationRecord(
      raw,
    );

  const present =
    violationRecordPresent(
      record,
    );

  const matches =
    present
    && hashEqual(
      record.intentDigest,
      event.intentDigest,
    )
    && addressEqual(
      record.agent,
      event.agent,
    )
    && record.code
      === Number(event.code)
    && record.module
      === Number(event.module)
    && record.strikeCount
      === BigInt(
        event.strikeCount,
      )
    && record.quarantined
      === event.quarantined;

  return {
    storedViolation:
      matches,

    violationRecord:
      record,

    storedViolationMatchesEvent:
      matches,
  };
}

function syntheticLog({
  address,
  abi,
  eventName,
  args,
  dataTypes,
  dataValues,
}) {
  return {
    address,

    topics:
      encodeEventTopics({
        abi,
        eventName,
        args,
      }),

    data:
      dataTypes.length === 0
        ? "0x"
        : encodeAbiParameters(
            dataTypes.map(
              (type) => ({
                type,
              }),
            ),
            dataValues,
          ),
  };
}

function assert(
  condition,
  message,
) {
  if (!condition) {
    fail(message);
  }
}

export async function runEvidencePreflight() {
  const artifacts =
    loadArtifacts();

  const account =
    "0x1111111111111111111111111111111111111111";

  const agent =
    "0x2222222222222222222222222222222222222222";

  const intentDigest =
    `0x${"11".repeat(32)}`;

  const callsHash =
    `0x${"22".repeat(32)}`;

  const outerEvidenceHash =
    `0x${"33".repeat(32)}`;

  const innerEvidenceHash =
    `0x${"44".repeat(32)}`;

  const failureHash =
    `0x${"55".repeat(32)}`;

  /*
   * IntentExecuted
   */

  const executedLog =
    syntheticLog({
      address:
        account,

      abi:
        artifacts.D.abi,

      eventName:
        "IntentExecuted",

      args: {
        intentDigest,
        agent,
        callsHash,
      },

      dataTypes:
        [],

      dataValues:
        [],
    });

  const executedReceipt = {
    status:
      "success",

    gasUsed:
      123456n,

    blockNumber:
      77n,

    transactionHash:
      `0x${"66".repeat(32)}`,

    logs: [
      executedLog,
    ],
  };

  const executedSignals =
    extractDReceiptSignals({
      receipt:
        executedReceipt,

      account,

      abi:
        artifacts.D.abi,
    });

  assert(
    executedSignals.intentExecuted
      === true,
    "IntentExecuted event not decoded",
  );

  assert(
    hashEqual(
      executedSignals
        .intentExecutedEvent
        .intentDigest,
      intentDigest,
    ),
    "IntentExecuted digest mismatch",
  );

  console.log(
    "D_EVENT_DECODE_INTENT_EXECUTED: PASS",
  );

  /*
   * IntentViolation
   */

  const violationLog =
    syntheticLog({
      address:
        account,

      abi:
        artifacts.D.abi,

      eventName:
        "IntentViolation",

      args: {
        intentDigest,
        agent,
        code: 2,
        module: 1,
        evidenceHash:
          outerEvidenceHash,
        strikeCount: 2n,
        quarantined: false,
      },

      dataTypes: [
        "uint8",
        "uint8",
        "bytes32",
        "uint256",
        "bool",
      ],

      dataValues: [
        2,
        1,
        outerEvidenceHash,
        2n,
        false,
      ],
    });

  const violationReceipt = {
    status:
      "success",

    gasUsed:
      150000n,

    blockNumber:
      88n,

    transactionHash:
      `0x${"77".repeat(32)}`,

    logs: [
      violationLog,
    ],
  };

  const violationSignals =
    extractDReceiptSignals({
      receipt:
        violationReceipt,

      account,

      abi:
        artifacts.D.abi,
    });

  assert(
    violationSignals.intentViolation
      === true,
    "IntentViolation event not decoded",
  );

  assert(
    hashEqual(
      violationSignals
        .intentViolationEvent
        .evidenceHash,
      outerEvidenceHash,
    ),
    "IntentViolation evidence hash mismatch",
  );

  console.log(
    "D_EVENT_DECODE_INTENT_VIOLATION: PASS",
  );

  /*
   * Stored ViolationRecord verification.
   * Mock readContract only; no RPC and no chain.
   */

  const mockPublicClient = {
    async readContract() {
      return [
        intentDigest,
        agent,
        2,
        1,
        callsHash,
        innerEvidenceHash,
        2n,
        false,
        88n,
        1700001000n,
      ];
    },
  };

  const stored =
    await verifyStoredViolation({
      publicClient:
        mockPublicClient,

      account,

      abi:
        artifacts.D.abi,

      event:
        violationSignals
          .intentViolationEvent,
    });

  assert(
    stored.storedViolation
      === true,
    "stored ViolationRecord did not match IntentViolation",
  );

  assert(
    stored
      .storedViolationMatchesEvent
      === true,
    "stored ViolationRecord event match failed",
  );

  console.log(
    "D_STORED_VIOLATION_MATCH: PASS",
  );

  /*
   * ExecutionFailed
   */

  const failedLog =
    syntheticLog({
      address:
        account,

      abi:
        artifacts.D.abi,

      eventName:
        "ExecutionFailed",

      args: {
        intentDigest,
        agent,
        callsHash,
        failureHash,
      },

      dataTypes: [
        "bytes32",
      ],

      dataValues: [
        failureHash,
      ],
    });

  const failedSignals =
    extractDReceiptSignals({
      receipt: {
        status:
          "success",

        logs: [
          failedLog,
        ],
      },

      account,

      abi:
        artifacts.D.abi,
    });

  assert(
    failedSignals.executionFailed
      === true,
    "ExecutionFailed event not decoded",
  );

  console.log(
    "D_EVENT_DECODE_EXECUTION_FAILED: PASS",
  );

  /*
   * Receipt normalization
   */

  const receiptMeta =
    extractReceiptMetadata(
      executedReceipt,
    );

  assert(
    receiptMeta.outerReceiptStatus
      === 1
    && receiptMeta.gasUsed
      === 123456
    && receiptMeta.blockNumber
      === 77,
    "receipt metadata normalization failed",
  );

  assert(
    normalizeReceiptStatus(
      "reverted",
    ) === 0,
    "reverted receipt normalization failed",
  );

  console.log(
    "RECEIPT_METADATA_NORMALIZATION: PASS",
  );

  /*
   * Revert decoding.
   */

  const nonceError =
    encodeErrorResult({
      abi:
        artifacts.D.abi,

      errorName:
        "NonceAlreadyUsed",
    });

  const decodedNonce =
    decodeObservedError({
      baseline:
        "D",

      data:
        nonceError,

      artifacts,
    });

  assert(
    decodedNonce.errorName
      === "NonceAlreadyUsed",
    "D NonceAlreadyUsed decode failed",
  );

  console.log(
    "D_ERROR_DECODE_NONCE_REPLAY: PASS",
  );

  const authError =
    encodeErrorResult({
      abi:
        artifacts.A.abi,

      errorName:
        "InvalidAuthorization",
    });

  const decodedAuth =
    decodeObservedError({
      baseline:
        "A",

      data:
        authError,

      artifacts,
    });

  assert(
    decodedAuth.errorName
      === "InvalidAuthorization",
    "A InvalidAuthorization decode failed",
  );

  console.log(
    "A_ERROR_DECODE_AUTHORIZATION: PASS",
  );

  const spendError =
    encodeErrorResult({
      abi:
        artifacts.B.abi,

      errorName:
        "SpendExceeded",
    });

  const decodedSpend =
    decodeObservedError({
      baseline:
        "B",

      data:
        spendError,

      artifacts,
    });

  assert(
    decodedSpend.errorName
      === "SpendExceeded",
    "B SpendExceeded decode failed",
  );

  console.log(
    "B_ERROR_DECODE_SPEND: PASS",
  );

  console.log(
    "PILOT_TRANSACTIONS_EXECUTED: 0",
  );

  console.log(
    "PILOT_OBSERVATIONS_CREATED: 0",
  );

  console.log(
    "EVIDENCE_EXTRACTION_PREFLIGHT_PASS",
  );
}
