import {
  readFileSync,
} from "node:fs";

import {
  dirname,
  join,
  resolve,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  buildPilotExecutionRows,
} from "./paper-execution-engine.mjs";

import {
  runObservationIntegrationPreflight,
} from "./paper-observation-integration-preflight.mjs";

const SCRIPT_DIR =
  dirname(
    fileURLToPath(
      import.meta.url,
    ),
  );

const REPO_ROOT =
  resolve(
    SCRIPT_DIR,
    "../..",
  );

const EXECUTION_SCHEMA_PATH =
  join(
    REPO_ROOT,
    "paper-artifacts/system/execution-row.schema.json",
  );

function fail(message) {
  throw new Error(message);
}

function assert(
  condition,
  message,
) {
  if (!condition) {
    fail(message);
  }
}

function loadSchema() {
  return JSON.parse(
    readFileSync(
      EXECUTION_SCHEMA_PATH,
      "utf8",
    ),
  );
}

function actualType(
  value,
) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (Number.isInteger(value)) {
    return "integer";
  }

  return typeof value;
}

function typeMatches(
  value,
  expected,
) {
  switch (expected) {
    case "null":
      return value === null;

    case "string":
      return typeof value
        === "string";

    case "boolean":
      return typeof value
        === "boolean";

    case "integer":
      return Number.isInteger(
        value,
      );

    case "number":
      return (
        typeof value
          === "number"
        && Number.isFinite(
          value,
        )
      );

    case "array":
      return Array.isArray(
        value,
      );

    case "object":
      return (
        value !== null
        && typeof value
          === "object"
        && !Array.isArray(
          value,
        )
      );

    default:
      fail(
        `unsupported schema type ${expected}`,
      );
  }
}

function validateSchemaValue({
  field,
  value,
  definition,
  label,
}) {
  const declaredTypes =
    Array.isArray(
      definition.type,
    )
      ? definition.type
      : [
          definition.type,
        ];

  assert(
    declaredTypes.some(
      (type) =>
        typeMatches(
          value,
          type,
        ),
    ),
    `${label}: ${field} type=${actualType(value)}, expected ${declaredTypes.join(" or ")}`,
  );

  if (
    definition.minimum
      !== undefined
    && value !== null
    && typeof value
      === "number"
  ) {
    assert(
      value
        >= definition.minimum,
      `${label}: ${field} below minimum`,
    );
  }

  if (
    definition.pattern
      !== undefined
    && value !== null
    && typeof value
      === "string"
  ) {
    assert(
      new RegExp(
        definition.pattern,
      ).test(value),
      `${label}: ${field} pattern mismatch`,
    );
  }
}

function validateRow({
  row,
  schema,
  label,
}) {
  assert(
    row
    && typeof row
      === "object"
    && !Array.isArray(
      row,
    ),
    `${label}: row must be an object`,
  );

  const required =
    schema.required
    ?? [];

  const properties =
    schema.properties
    ?? {};

  assert(
    required.length === 70,
    `${label}: schema required field count=${required.length}, expected 70`,
  );

  assert(
    Object.keys(row).length
      === 70,
    `${label}: row field count=${Object.keys(row).length}, expected 70`,
  );

  for (
    const field
    of required
  ) {
    assert(
      Object.prototype
        .hasOwnProperty.call(
          row,
          field,
        ),
      `${label}: missing field ${field}`,
    );

    assert(
      row[field]
        !== undefined,
      `${label}: ${field} is undefined`,
    );
  }

  if (
    schema.additionalProperties
      === false
  ) {
    for (
      const field
      of Object.keys(row)
    ) {
      assert(
        Object.prototype
          .hasOwnProperty.call(
            properties,
            field,
          ),
        `${label}: unexpected field ${field}`,
      );
    }
  }

  for (
    const [
      field,
      value,
    ]
    of Object.entries(row)
  ) {
    validateSchemaValue({
      field,
      value,
      definition:
        properties[field],
      label,
    });
  }
}

function rowKey(
  row,
) {
  return [
    row.scenario_id,
    row.baseline,
    row.repetition,
  ].join("|");
}

function recordKey(
  record,
) {
  return [
    record.planRow
      .scenario_id,

    record.planRow
      .baseline,

    record.planRow
      .repetition,
  ].join("|");
}

function decimal(
  value,
) {
  if (
    value === null
    || value === undefined
  ) {
    return null;
  }

  return String(
    value,
  );
}

function measuredRecipient(
  record,
) {
  const scenario =
    record.planRow
      .scenario_id;

  switch (scenario) {
    case "PILOT-01":
    case "PILOT-03":
    case "PILOT-06":
    case "PILOT-07":
    case "PILOT-10":
      return {
        address:
          record.addresses
            .recipientAllowed,

        pre:
          record.pre
            .allowedUsdc,

        post:
          record.post
            .allowedUsdc,
      };

    case "PILOT-02":
    case "PILOT-09":
      return {
        address:
          record.addresses
            .thief,

        pre:
          record.pre
            .thiefUsdc,

        post:
          record.post
            .thiefUsdc,
      };

    case "PILOT-05":
      return {
        address:
          record.addresses
            .recipientAllowed,

        pre:
          record.pre
            .allowedWeth,

        post:
          record.post
            .allowedWeth,
      };

    case "PILOT-08":
      if (
        record.planRow
          .baseline === "D"
      ) {
        return {
          address:
            record.addresses
              .recipientAllowed,

          pre:
            record.pre
              .allowedWeth,

          post:
            record.post
              .allowedWeth,
        };
      }

      return {
        address:
          null,

        pre:
          null,

        post:
          null,
      };

    default:
      return {
        address:
          null,

        pre:
          null,

        post:
          null,
      };
  }
}

function measuredAllowance(
  record,
) {
  const scenario =
    record.planRow
      .scenario_id;

  if (
    scenario
      === "PILOT-04"
  ) {
    return {
      spender:
        record.addresses
          .spenderUnauthorized,

      pre:
        record.pre
          .unauthorizedSpenderAllowance,

      post:
        record.post
          .unauthorizedSpenderAllowance,
    };
  }

  if (
    scenario
      === "PILOT-05"
    || scenario
      === "PILOT-08"
  ) {
    return {
      spender:
        record.fixture.ROUTER,

      pre:
        record.pre
          .routerAllowance,

      post:
        record.post
          .routerAllowance,
    };
  }

  return {
    spender:
      null,

    pre:
      null,

    post:
      null,
  };
}

function transactionTarget(
  record,
) {
  const transaction =
    record.transaction;

  if (
    typeof transaction.target
      === "string"
  ) {
    return transaction.target;
  }

  const calls =
    transaction.executedCalls
    ?? transaction.calls
    ?? transaction.signedCalls
    ?? null;

  if (
    Array.isArray(calls)
    && calls.length === 1
    && typeof calls[0].target
      === "string"
  ) {
    return calls[0].target;
  }

  if (
    record.planRow
      .scenario_id
      === "PILOT-05"
  ) {
    return record.fixture.ROUTER;
  }

  if (
    record.planRow
      .scenario_id
      === "PILOT-06"
  ) {
    return record.fixture.USDC;
  }

  return null;
}

function harmfulStateSurvived(
  record,
) {
  if (
    record.planRow
      .legitimate_or_attack
      !== "ATTACK"
  ) {
    return false;
  }

  return record.finalStateOk
    === true;
}

function assertMaterializedSemantics({
  row,
  record,
  key,
}) {
  const recipientScenarios =
    new Set([
      "PILOT-01",
      "PILOT-02",
      "PILOT-03",
      "PILOT-05",
      "PILOT-06",
      "PILOT-07",
      "PILOT-09",
      "PILOT-10",
    ]);

  const requiresRecipient =
    recipientScenarios.has(
      row.scenario_id,
    )
    || (
      row.scenario_id
        === "PILOT-08"
      && row.baseline
        === "D"
    );

  if (
    requiresRecipient
  ) {
    assert(
      typeof row.recipient
        === "string"
      && row.recipient.length > 0,
      `${key}: recipient not materialized`,
    );

    assert(
      row.pre_recipient_balance
        !== null,
      `${key}: pre recipient balance not materialized`,
    );

    assert(
      row.post_recipient_balance
        !== null,
      `${key}: post recipient balance not materialized`,
    );
  }

  if (
    row.scenario_id
      === "PILOT-05"
  ) {
    assert(
      typeof row.target
        === "string"
      && row.target.toLowerCase()
        === record.fixture.ROUTER
          .toLowerCase(),
      `${key}: P05 swap target must be router`,
    );

    assert(
      row.recipient
        .toLowerCase()
        === record.addresses
          .recipientAllowed
          .toLowerCase(),
      `${key}: P05 recipient mismatch`,
    );
  }

  const allowanceScenarios =
    new Set([
      "PILOT-04",
      "PILOT-05",
      "PILOT-08",
    ]);

  if (
    allowanceScenarios.has(
      row.scenario_id,
    )
  ) {
    assert(
      typeof row.spender
        === "string"
      && row.spender.length > 0,
      `${key}: spender not materialized`,
    );

    assert(
      row.pre_allowance
        !== null,
      `${key}: pre allowance not materialized`,
    );

    assert(
      row.post_allowance
        !== null,
      `${key}: post allowance not materialized`,
    );
  }
}

function bindDiagnosticRecord({
  executionRow,
  record,
}) {
  const recipient =
    measuredRecipient(
      record,
    );

  const allowance =
    measuredAllowance(
      record,
    );

  const evidenceEvent =
    record.dSignals
      .intentViolationEvent
    ?? null;

  const dPre =
    record.pre
      .dAgent
    ?? null;

  const dPost =
    record.post
      .dAgent
    ?? null;

  Object.assign(
    executionRow,
    {
      run_id:
        "DIAGNOSTIC_PREFLIGHT_NONPERSISTED",

      timestamp:
        new Date(
          record.planRow
            .measured_timestamp
          * 1000,
        ).toISOString(),

      owner:
        record.addresses.owner,

      agent:
        record.addresses.agent,

      submitter:
        record.addresses
          .submitter,

      account:
        record.fixture[
          record.planRow
            .baseline
        ],

      chain_id:
        record.planRow
          .chain_id,

      target:
        transactionTarget(
          record,
        ),

      token:
        record.fixture.USDC,

      recipient:
        recipient.address,

      spender:
        allowance.spender,

      selector:
        record.transaction
          .selector
        ?? null,

      calls_hash:
        record.transaction
          .callsHash
        ?? null,

      policy_hash:
        record.transaction
          .policyHash
        ?? null,

      pre_owner_balance:
        null,

      post_owner_balance:
        null,

      pre_recipient_balance:
        decimal(
          recipient.pre,
        ),

      post_recipient_balance:
        decimal(
          recipient.post,
        ),

      pre_allowance:
        decimal(
          allowance.pre,
        ),

      post_allowance:
        decimal(
          allowance.post,
        ),

      harmful_state_survived:
        harmfulStateSurvived(
          record,
        ),

      rollback_success:
        record.dSignals
          .intentViolation
          ? record
              .rollbackVerified
          : null,

      evidence_created:
        record.dSignals
          .intentViolation,

      evidence_hash:
        evidenceEvent
          ?.evidenceHash
        ?? null,

      strike_before:
        dPre
          ? decimal(
              dPre.strikes,
            )
          : null,

      strike_after:
        dPost
          ? decimal(
              dPost.strikes,
            )
          : null,

      quarantined_before:
        dPre
          ? dPre.quarantined
          : null,

      quarantined_after:
        dPost
          ? dPost.quarantined
          : null,

      gas_used:
        record.receiptMeta
          .gasUsed,

      execution_time_ns:
        decimal(
          record.result
            .executionTimeNs,
        ),

      execution_time_ms:
        record.result
          .executionTimeMs,

      transaction_hash:
        record.result
          .transactionHash,

      block_number:
        record.receiptMeta
          .blockNumber,

      error_selector:
        record.decoded
          .errorSelector,

      revert_hash:
        record.decoded
          .revertHash,

      authentication_passed:
        record.classification
          .authentication_passed,

      validation_stage:
        record.classification
          .validation_stage,

      pre_account_balance:
        decimal(
          record.pre
            .accountUsdc,
        ),

      post_account_balance:
        decimal(
          record.post
            .accountUsdc,
        ),

      outer_receipt_status:
        record.receiptMeta
          .outerReceiptStatus,

      nonce_used_before:
        record.pre
          .nonceUsed,

      nonce_used_after:
        record.post
          .nonceUsed,

      failure_provenance:
        record.classification
          .failure_provenance,

      actual_verdict:
        record.classification
          .actual_verdict,

      reason_code:
        record.classification
          .reason_code,

      failure_class:
        record.classification
          .failure_class,

      observation_source:
        "DIAGNOSTIC_PREFLIGHT_NONPERSISTED",
    },
  );

  return executionRow;
}

export async function runExecutionRowMaterializationPreflight() {
  const schema =
    loadSchema();

  assert(
    Array.isArray(
      schema.required,
    )
    && schema.required.length
      === 70,
    "execution schema must contain exactly 70 required fields",
  );

  const executionRows =
    buildPilotExecutionRows();

  assert(
    executionRows.length
      === 40,
    `execution rows=${executionRows.length}, expected 40`,
  );

  const diagnosticRecords =
    await runObservationIntegrationPreflight();

  assert(
    Array.isArray(
      diagnosticRecords,
    )
    && diagnosticRecords.length
      === 27,
    `diagnostic records=${diagnosticRecords?.length}, expected 27`,
  );

  const recordMap =
    new Map();

  for (
    const record
    of diagnosticRecords
  ) {
    const key =
      recordKey(
        record,
      );

    assert(
      !recordMap.has(
        key,
      ),
      `duplicate diagnostic record ${key}`,
    );

    recordMap.set(
      key,
      record,
    );
  }

  let applicable =
    0;

  let notApplicable =
    0;

  let materialized =
    0;

  for (
    const row
    of executionRows
  ) {
    const key =
      rowKey(
        row,
      );

    if (
      row.applicability
        === "APPLICABLE"
    ) {
      applicable += 1;

      const record =
        recordMap.get(
          key,
        );

      assert(
        record,
        `${key}: diagnostic record missing`,
      );

      bindDiagnosticRecord({
        executionRow:
          row,

        record,
      });

      materialized += 1;

      assertMaterializedSemantics({
        row,
        record,
        key,
      });

      assert(
        row.transaction_hash
          !== null,
        `${key}: transaction hash not materialized`,
      );

      assert(
        row.gas_used
          !== null
        && row.gas_used > 0,
        `${key}: gas not materialized`,
      );

      assert(
        row.execution_time_ns
          !== null,
        `${key}: execution time not materialized`,
      );

      assert(
        row.outer_receipt_status
          === 0
        || row.outer_receipt_status
          === 1,
        `${key}: receipt status not materialized`,
      );

      assert(
        row.actual_verdict
          === record.planRow
            .expected_verdict,
        `${key}: materialized verdict mismatch`,
      );

      assert(
        row.failure_class
          === record.planRow
            .expected_reason_class,
        `${key}: materialized failure class mismatch`,
      );

      assert(
        row.reason_code
          === record.planRow
            .expected_reason_code,
        `${key}: materialized reason code mismatch`,
      );
    } else {
      notApplicable += 1;

      assert(
        row.actual_verdict
          === "NOT_APPLICABLE",
        `${key}: N/A verdict changed`,
      );

      assert(
        row.observation_source
          === "PREREGISTERED_NOT_APPLICABLE",
        `${key}: N/A observation source changed`,
      );

      for (
        const field
        of [
          "gas_used",
          "execution_time_ns",
          "execution_time_ms",
          "transaction_hash",
          "block_number",
        ]
      ) {
        assert(
          row[field] === null,
          `${key}: N/A ${field} must remain null`,
        );
      }
    }

    validateRow({
      row,
      schema,
      label:
        key,
    });
  }

  assert(
    applicable === 27,
    `applicable rows=${applicable}, expected 27`,
  );

  assert(
    notApplicable === 13,
    `N/A rows=${notApplicable}, expected 13`,
  );

  assert(
    materialized === 27,
    `materialized rows=${materialized}, expected 27`,
  );

  assert(
    recordMap.size === 27,
    `record map size=${recordMap.size}, expected 27`,
  );

  console.log(
    "EXECUTION_ROW_MATERIALIZATION_ROWS: 40",
  );

  console.log(
    "EXECUTION_ROW_MATERIALIZATION_APPLICABLE: 27",
  );

  console.log(
    "EXECUTION_ROW_MATERIALIZATION_NOT_APPLICABLE: 13",
  );

  console.log(
    "EXECUTION_ROW_SCHEMA_FIELDS: 70",
  );

  console.log(
    "EXECUTION_ROW_SCHEMA_VALIDATION: PASS",
  );

  console.log(
    "DIAGNOSTIC_EXECUTION_ROWS_MATERIALIZED_IN_MEMORY: 27",
  );

  console.log(
    "NOT_APPLICABLE_ROWS_PRESERVED: PASS",
  );

  console.log(
    "NO_OUTPUT_FILES_WRITTEN: PASS",
  );

  console.log(
    "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 0",
  );

  console.log(
    "PILOT_OBSERVATIONS_CREATED: 0",
  );

  console.log(
    "EXECUTION_ROW_MATERIALIZATION_PREFLIGHT_PASS",
  );

  return executionRows;
}
