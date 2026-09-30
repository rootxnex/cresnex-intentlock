import {
  dirname,
  join,
  resolve,
} from "node:path";

import {
  readFileSync,
} from "node:fs";

import {
  fileURLToPath,
} from "node:url";

const SCRIPT_DIR =
  dirname(fileURLToPath(import.meta.url));

const REPO_ROOT =
  resolve(SCRIPT_DIR, "../..");

const EXECUTION_SCHEMA_PATH =
  join(
    REPO_ROOT,
    "paper-artifacts/system/execution-row.schema.json",
  );

export const FAILURE_CLASS =
  Object.freeze({
    ALLOW_SUCCESS:
      "ALLOW_SUCCESS",

    SIGNATURE_FAILURE:
      "SIGNATURE_FAILURE",

    AGENT_AUTH_FAILURE:
      "AGENT_AUTH_FAILURE",

    ACCOUNT_BINDING_FAILURE:
      "ACCOUNT_BINDING_FAILURE",

    CHAIN_BINDING_FAILURE:
      "CHAIN_BINDING_FAILURE",

    NONCE_REPLAY:
      "NONCE_REPLAY",

    NOT_YET_VALID:
      "NOT_YET_VALID",

    EXPIRED_INTENT:
      "EXPIRED_INTENT",

    CALL_HASH_MISMATCH:
      "CALL_HASH_MISMATCH",

    POLICY_HASH_MISMATCH:
      "POLICY_HASH_MISMATCH",

    POLICY_VIOLATION:
      "POLICY_VIOLATION",

    POSTCONDITION_VIOLATION:
      "POSTCONDITION_VIOLATION",

    TARGET_REVERT:
      "TARGET_REVERT",

    REENTRANCY_REJECTED:
      "REENTRANCY_REJECTED",

    QUARANTINE_REJECTION:
      "QUARANTINE_REJECTION",

    STRUCTURAL_REJECTION:
      "STRUCTURAL_REJECTION",

    OWNER_AUTH_FAILURE:
      "OWNER_AUTH_FAILURE",

    PAUSE_REJECTION:
      "PAUSE_REJECTION",

    INFRASTRUCTURE_FAILURE:
      "INFRASTRUCTURE_FAILURE",

    UNKNOWN_FAILURE:
      "UNKNOWN_FAILURE",

    NOT_APPLICABLE:
      "NOT_APPLICABLE",
  });

const STRUCTURAL_ERRORS =
  new Set([
    "WrongVersion",
    "InvalidPolicy",
    "InvalidValidityWindow",
    "InvalidCallCount",
    "BatchNotAllowed",
    "InvalidCallTarget",
    "UnsupportedOperation",
  ]);

function fail(message) {
  throw new Error(message);
}

function loadSchema() {
  return JSON.parse(
    readFileSync(
      EXECUTION_SCHEMA_PATH,
      "utf8",
    ),
  );
}

export function makeEmptyExecutionRow() {
  const schema =
    loadSchema();

  if (
    !Array.isArray(schema.required)
  ) {
    fail(
      "execution schema required[] missing",
    );
  }

  return Object.fromEntries(
    schema.required.map(
      (field) => [
        field,
        null,
      ],
    ),
  );
}

function reject(
  failureClass,
  reasonCode,
  {
    authenticationPassed = null,
    validationStage = null,
    failureProvenance = null,
  } = {},
) {
  return {
    actual_verdict:
      "REJECT",

    failure_class:
      failureClass,

    reason_code:
      reasonCode,

    authentication_passed:
      authenticationPassed,

    validation_stage:
      validationStage,

    failure_provenance:
      failureProvenance,
  };
}

function allow(
  provenance,
) {
  return {
    actual_verdict:
      "ALLOW",

    failure_class:
      FAILURE_CLASS.ALLOW_SUCCESS,

    reason_code:
      null,

    authentication_passed:
      true,

    validation_stage:
      "EXECUTION_COMPLETE",

    failure_provenance:
      provenance,
  };
}

/*
 * Classification is evidence-driven.
 *
 * An outer receipt status alone is never sufficient to
 * classify IntentLock D policy enforcement.
 */
export function classifyObservation(
  observation,
) {
  if (
    observation.applicability
    === "NOT_APPLICABLE"
  ) {
    return {
      actual_verdict:
        "NOT_APPLICABLE",

      failure_class:
        FAILURE_CLASS.NOT_APPLICABLE,

      reason_code:
        null,

      authentication_passed:
        null,

      validation_stage:
        null,

      failure_provenance:
        "PREREGISTERED_NOT_APPLICABLE",
    };
  }

  if (
    observation.infrastructureFailure
    === true
  ) {
    return {
      actual_verdict:
        null,

      failure_class:
        FAILURE_CLASS
          .INFRASTRUCTURE_FAILURE,

      reason_code:
        observation.reasonCode
        ?? null,

      authentication_passed:
        null,

      validation_stage:
        null,

      failure_provenance:
        observation
          .failureProvenance
        ?? "HARNESS_OR_RPC_FAILURE",
    };
  }

  /*
   * IntentLock D successful execution requires
   * receipt + IntentExecuted + checked final state.
   */
  if (
    observation.baseline === "D"
    && observation.outerReceiptStatus === 1
    && observation.intentExecuted === true
    && observation.finalStateOk === true
  ) {
    return allow(
      "INTENT_EXECUTED_EVENT_AND_FINAL_STATE",
    );
  }

  /*
   * Baseline A/B/C success requires successful
   * receipt plus the expected checked final state.
   */
  if (
    ["A", "B", "C"].includes(
      observation.baseline,
    )
    && observation.outerReceiptStatus === 1
    && observation.finalStateOk === true
  ) {
    return allow(
      "RECEIPT_AND_FINAL_STATE",
    );
  }

  /*
   * Durable D policy violation:
   *
   * - outer transaction may succeed;
   * - IntentViolation must exist;
   * - violations[evidenceHash] must exist;
   * - rollback must be verified.
   *
   * POSTCONDITION_VIOLATION is only assigned when
   * independent trace provenance identifies
   * _validateOutcomes / post-state validation.
   */
  if (
    observation.baseline === "D"
    && observation.outerReceiptStatus === 1
    && observation.intentViolation === true
    && observation.storedViolation === true
    && observation.rollbackVerified === true
  ) {
    if (
      observation.traceStage
        === "_validateOutcomes"
      && observation.postconditionFailureTrace
        === true
    ) {
      return reject(
        FAILURE_CLASS
          .POSTCONDITION_VIOLATION,
        "PolicyViolation",
        {
          authenticationPassed:
            true,

          validationStage:
            "POSTCONDITION",

          failureProvenance:
            "TRACE_PLUS_INTENT_VIOLATION_PLUS_STORED_RECORD",
        },
      );
    }

    return reject(
      FAILURE_CLASS.POLICY_VIOLATION,
      "PolicyViolation",
      {
        authenticationPassed:
          true,

        validationStage:
          observation.traceStage
          ?? "POLICY",

        failureProvenance:
          "INTENT_VIOLATION_PLUS_STORED_RECORD",
      },
    );
  }

  /*
   * Generic D inner execution failure is not a
   * policy violation. Target provenance is required.
   */
  if (
    observation.baseline === "D"
    && observation.executionFailed === true
    && observation.targetFailureProvenance
      === true
  ) {
    return reject(
      FAILURE_CLASS.TARGET_REVERT,
      "TargetCallFailed",
      {
        authenticationPassed:
          true,

        validationStage:
          "TARGET_EXECUTION",

        failureProvenance:
          "TRACE_TARGET_CALL_FAILED",
      },
    );
  }

  const errorName =
    observation.errorName
    ?? null;

  /*
   * Baseline A/B/C collapse authorization failures
   * into InvalidAuthorization. Known pre-state is
   * therefore required to call one a nonce replay.
   */
  if (
    ["A", "B", "C"]
      .includes(
        observation.baseline,
      )
    && errorName
      === "InvalidAuthorization"
  ) {
    if (
      observation.nonceUsedBefore
      === true
    ) {
      return reject(
        FAILURE_CLASS.NONCE_REPLAY,
        "InvalidAuthorization",
        {
          authenticationPassed:
            false,

          validationStage:
            "AUTHENTICATION",

          failureProvenance:
            "KNOWN_USED_NONCE_PRESTATE",
        },
      );
    }

    return reject(
      FAILURE_CLASS
        .SIGNATURE_FAILURE,
      "InvalidAuthorization",
      {
        authenticationPassed:
          false,

        validationStage:
          "AUTHENTICATION",

        failureProvenance:
          "BASELINE_AUTHORIZATION_FAILURE",
      },
    );
  }

  switch (errorName) {
    case "WrongOwner":
    case "InvalidOwnerSignature":
    case "ECDSAInvalidSignature":
    case "ECDSAInvalidSignatureLength":
    case "ECDSAInvalidSignatureS":
      return reject(
        FAILURE_CLASS
          .SIGNATURE_FAILURE,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "AUTHENTICATION",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "UnauthorizedAgent":
      return reject(
        FAILURE_CLASS
          .AGENT_AUTH_FAILURE,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "AUTHENTICATION",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "WrongAccount":
      return reject(
        FAILURE_CLASS
          .ACCOUNT_BINDING_FAILURE,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "AUTHENTICATION",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "WrongChain":
      return reject(
        FAILURE_CLASS
          .CHAIN_BINDING_FAILURE,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "AUTHENTICATION",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "NonceAlreadyUsed":
      return reject(
        FAILURE_CLASS.NONCE_REPLAY,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "AUTHENTICATION",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "IntentNotYetValid":
      return reject(
        FAILURE_CLASS.NOT_YET_VALID,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "AUTHENTICATION",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "IntentExpired":
      return reject(
        FAILURE_CLASS.EXPIRED_INTENT,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "AUTHENTICATION",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "CallsHashMismatch":
      return reject(
        FAILURE_CLASS
          .CALL_HASH_MISMATCH,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "CALL_BINDING",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "PolicyHashMismatch":
      return reject(
        FAILURE_CLASS
          .POLICY_HASH_MISMATCH,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "POLICY_BINDING",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "AgentQuarantinedError":
      return reject(
        FAILURE_CLASS
          .QUARANTINE_REJECTION,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "AGENT_STATE",

          failureProvenance:
            "AGENT_QUARANTINED_PRESTATE",
        },
      );

    case "ReentrancyGuardReentrantCall":
      return reject(
        FAILURE_CLASS
          .REENTRANCY_REJECTED,
        errorName,
        {
          authenticationPassed:
            null,

          validationStage:
            "REENTRANCY_GUARD",

          failureProvenance:
            "DECODED_CUSTOM_ERROR_OR_TRACE",
        },
      );

    case "OwnableUnauthorizedAccount":
      return reject(
        FAILURE_CLASS
          .OWNER_AUTH_FAILURE,
        errorName,
        {
          authenticationPassed:
            false,

          validationStage:
            "OWNER_CONTROL",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "EnforcedPause":
      return reject(
        FAILURE_CLASS
          .PAUSE_REJECTION,
        errorName,
        {
          authenticationPassed:
            null,

          validationStage:
            "PAUSE_GUARD",

          failureProvenance:
            "DECODED_CUSTOM_ERROR",
        },
      );

    case "SpendExceeded":
    case "PathRejected":
      /*
       * Frozen pilot definitions deliberately retain
       * UNKNOWN_FAILURE for these baseline-specific
       * guard rejects.
       */
      return reject(
        FAILURE_CLASS
          .UNKNOWN_FAILURE,
        errorName,
        {
          authenticationPassed:
            true,

          validationStage:
            "BASELINE_GUARD",

          failureProvenance:
            "DECODED_BASELINE_GUARD_ERROR",
        },
      );

    case "ExecutionFailed":
      if (
        observation
          .targetFailureProvenance
        === true
      ) {
        return reject(
          FAILURE_CLASS.TARGET_REVERT,
          errorName,
          {
            authenticationPassed:
              true,

            validationStage:
              "TARGET_EXECUTION",

            failureProvenance:
              "TARGET_FAILURE_PROVEN",
          },
        );
      }

      break;

    default:
      break;
  }

  if (
    STRUCTURAL_ERRORS.has(
      errorName,
    )
  ) {
    return reject(
      FAILURE_CLASS
        .STRUCTURAL_REJECTION,
      errorName,
      {
        authenticationPassed:
          false,

        validationStage:
          "STRUCTURAL_VALIDATION",

        failureProvenance:
          "DECODED_CUSTOM_ERROR",
      },
    );
  }

  /*
   * PolicyViolation without durable evidence is not
   * sufficient to claim successful enforcement.
   */
  return {
    actual_verdict:
      null,

    failure_class:
      FAILURE_CLASS.UNKNOWN_FAILURE,

    reason_code:
      errorName,

    authentication_passed:
      observation.authenticationPassed
      ?? null,

    validation_stage:
      observation.validationStage
      ?? null,

    failure_provenance:
      observation.failureProvenance
      ?? "INSUFFICIENT_CLASSIFICATION_EVIDENCE",
  };
}

function assertClassification(
  label,
  observation,
  expected,
) {
  const actual =
    classifyObservation(
      observation,
    );

  for (
    const [
      field,
      expectedValue,
    ]
    of Object.entries(expected)
  ) {
    if (
      actual[field]
      !== expectedValue
    ) {
      fail(
        `${label}: ${field}=${JSON.stringify(actual[field])}; `
        + `expected=${JSON.stringify(expectedValue)}`,
      );
    }
  }

  console.log(
    `${label}: PASS`,
  );
}

export function runObservationPreflight() {
  const schema =
    loadSchema();

  if (
    schema.additionalProperties
    !== false
  ) {
    fail(
      "execution schema must forbid additional properties",
    );
  }

  if (
    !Array.isArray(schema.required)
  ) {
    fail(
      "execution schema required[] missing",
    );
  }

  const uniqueRequired =
    new Set(schema.required);

  if (
    schema.required.length !== 70
    || uniqueRequired.size !== 70
  ) {
    fail(
      `execution row field count mismatch: `
      + `${schema.required.length}/${uniqueRequired.size}`,
    );
  }

  const blank =
    makeEmptyExecutionRow();

  if (
    Object.keys(blank).length !== 70
  ) {
    fail(
      "empty execution row does not contain 70 fields",
    );
  }

  console.log(
    "EXECUTION_ROW_REQUIRED_FIELDS: 70",
  );

  console.log(
    "EXECUTION_ROW_EXPLICIT_NULL_SKELETON: PASS",
  );

  assertClassification(
    "CASE_D_ALLOW",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      outerReceiptStatus:
        1,

      intentExecuted:
        true,

      finalStateOk:
        true,
    },
    {
      actual_verdict:
        "ALLOW",

      failure_class:
        FAILURE_CLASS
          .ALLOW_SUCCESS,
    },
  );

  assertClassification(
    "CASE_D_POLICY_VIOLATION",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      outerReceiptStatus:
        1,

      intentViolation:
        true,

      storedViolation:
        true,

      rollbackVerified:
        true,

      traceStage:
        "PRE_POLICY",
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .POLICY_VIOLATION,
    },
  );

  assertClassification(
    "CASE_D_POSTCONDITION",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      outerReceiptStatus:
        1,

      intentViolation:
        true,

      storedViolation:
        true,

      rollbackVerified:
        true,

      traceStage:
        "_validateOutcomes",

      postconditionFailureTrace:
        true,
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .POSTCONDITION_VIOLATION,
    },
  );

  assertClassification(
    "CASE_D_POSTCONDITION_TRAVERSAL_ONLY",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      outerReceiptStatus:
        1,

      intentViolation:
        true,

      storedViolation:
        true,

      rollbackVerified:
        true,

      traceStage:
        "_validateOutcomes",

      postconditionFailureTrace:
        false,
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .POLICY_VIOLATION,
    },
  );

  assertClassification(
    "CASE_D_POLICY_WITHOUT_DURABLE_RECORD",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      errorName:
        "PolicyViolation",

      intentViolation:
        true,

      storedViolation:
        false,

      rollbackVerified:
        true,
    },
    {
      actual_verdict:
        null,

      failure_class:
        FAILURE_CLASS
          .UNKNOWN_FAILURE,
    },
  );

  assertClassification(
    "CASE_D_TARGET_REVERT",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      executionFailed:
        true,

      targetFailureProvenance:
        true,
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .TARGET_REVERT,
    },
  );

  assertClassification(
    "CASE_D_WRONG_OWNER",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      errorName:
        "WrongOwner",
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .SIGNATURE_FAILURE,
    },
  );

  assertClassification(
    "CASE_D_NONCE_REPLAY",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      errorName:
        "NonceAlreadyUsed",
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .NONCE_REPLAY,
    },
  );

  assertClassification(
    "CASE_A_NONCE_REPLAY",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "A",

      errorName:
        "InvalidAuthorization",

      nonceUsedBefore:
        true,
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .NONCE_REPLAY,
    },
  );

  assertClassification(
    "CASE_D_QUARANTINE",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      errorName:
        "AgentQuarantinedError",
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .QUARANTINE_REJECTION,
    },
  );

  assertClassification(
    "CASE_D_CALL_HASH",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "D",

      errorName:
        "CallsHashMismatch",
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .CALL_HASH_MISMATCH,
    },
  );

  assertClassification(
    "CASE_B_SPEND_GUARD",
    {
      applicability:
        "APPLICABLE",

      baseline:
        "B",

      errorName:
        "SpendExceeded",
    },
    {
      actual_verdict:
        "REJECT",

      failure_class:
        FAILURE_CLASS
          .UNKNOWN_FAILURE,
    },
  );

  assertClassification(
    "CASE_NOT_APPLICABLE",
    {
      applicability:
        "NOT_APPLICABLE",

      baseline:
        "B",
    },
    {
      actual_verdict:
        "NOT_APPLICABLE",

      failure_class:
        FAILURE_CLASS
          .NOT_APPLICABLE,
    },
  );

  console.log(
    "PILOT_TRANSACTIONS_EXECUTED: 0",
  );

  console.log(
    "PILOT_OBSERVATIONS_CREATED: 0",
  );

  console.log(
    "OBSERVATION_CLASSIFIER_PREFLIGHT_PASS",
  );
}
