import {
  buildPilotPlan,
  validatePilotPlan,
} from "./paper-scenario-plan.mjs";

import {
  classifyObservation,
  makeEmptyExecutionRow,
} from "./paper-observation.mjs";

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

function optionalDecimal(
  value,
) {
  if (
    value === undefined
    || value === null
  ) {
    return null;
  }

  return String(value);
}

function optionalInteger(
  value,
) {
  if (
    value === undefined
    || value === null
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isSafeInteger(number)
  ) {
    fail(
      `expected safe integer, got ${value}`,
    );
  }

  return number;
}

function planParameterFields(
  planRow,
) {
  const parameters =
    planRow.parameters
    ?? {};

  return {
    amount:
      optionalDecimal(
        parameters.amount,
      ),

    max_spend:
      optionalDecimal(
        parameters.max_spend,
      ),

    msg_value:
      optionalDecimal(
        parameters.msg_value,
      ),

    allowance_requested:
      optionalDecimal(
        parameters
          .allowance_requested,
      ),

    allowance_limit:
      optionalDecimal(
        parameters
          .allowance_limit,
      ),

    min_out:
      optionalDecimal(
        parameters.min_out,
      ),

    actual_out:
      optionalDecimal(
        parameters.actual_out,
      ),

    nonce:
      optionalDecimal(
        planRow.nonce,
      ),

    valid_after:
      optionalInteger(
        parameters.valid_after,
      ),

    valid_until:
      optionalInteger(
        parameters.valid_until,
      ),

    chain_id:
      optionalInteger(
        planRow.chain_id,
      ),

    batch_size:
      optionalInteger(
        parameters
          .executed_batch_size,
      ),
  };
}

export function materializePlanRow(
  planRow,
) {
  const row =
    makeEmptyExecutionRow();

  Object.assign(
    row,
    {
      scenario_id:
        planRow.scenario_id,

      baseline:
        planRow.baseline,

      workload:
        planRow.workload,

      mutation_class:
        planRow.mutation_class,

      legitimate_or_attack:
        planRow
          .legitimate_or_attack,

      expected_security_property:
        planRow
          .expected_security_property,

      expected_verdict:
        planRow.expected_verdict,

      applicability:
        planRow.applicability,

      dataset_role:
        planRow.dataset_role,

      repetition:
        planRow.repetition,

      ...planParameterFields(
        planRow,
      ),
    },
  );

  /*
   * No fixture addresses, receipt data, state measurements,
   * gas, timing, hashes or classifications are invented here.
   *
   * Those remain null until the corresponding execution phase.
   */
  if (
    planRow.applicability
    === "NOT_APPLICABLE"
  ) {
    const classification =
      classifyObservation({
        applicability:
          "NOT_APPLICABLE",

        baseline:
          planRow.baseline,
      });

    Object.assign(
      row,
      classification,
      {
        observation_source:
          "PREREGISTERED_NOT_APPLICABLE",
      },
    );
  }

  return row;
}

export function buildPilotExecutionRows() {
  const plan =
    buildPilotPlan();

  validatePilotPlan(
    plan,
  );

  return plan.map(
    materializePlanRow,
  );
}

function assertExplicitSchemaShape(
  row,
  expectedFieldCount,
  label,
) {
  const keys =
    Object.keys(row);

  assert(
    keys.length
      === expectedFieldCount,
    `${label}: expected ${expectedFieldCount} fields, got ${keys.length}`,
  );

  assert(
    Object.values(row)
      .every(
        (value) =>
          value !== undefined,
      ),
    `${label}: undefined field present`,
  );
}

export function runExecutionEnginePlanPreflight() {
  const blank =
    makeEmptyExecutionRow();

  const requiredFields =
    Object.keys(
      blank,
    );

  assert(
    requiredFields.length === 70,
    `schema field count is ${requiredFields.length}, expected 70`,
  );

  const rows =
    buildPilotExecutionRows();

  assert(
    rows.length === 40,
    `execution row count=${rows.length}, expected 40`,
  );

  let applicable = 0;
  let notApplicable = 0;

  for (
    const row
    of rows
  ) {
    const label =
      `${row.scenario_id}/${row.baseline}`;

    assertExplicitSchemaShape(
      row,
      70,
      label,
    );

    if (
      row.applicability
      === "APPLICABLE"
    ) {
      applicable += 1;

      /*
       * Critical pre-execution guard:
       * executable rows are plans, not observations.
       */
      assert(
        row.actual_verdict
          === null,
        `${label}: applicable row has fabricated verdict`,
      );

      assert(
        row.failure_class
          === null,
        `${label}: applicable row has fabricated failure class`,
      );

      assert(
        row.reason_code
          === null,
        `${label}: applicable row has fabricated reason code`,
      );

      assert(
        row.gas_used
          === null,
        `${label}: applicable row has fabricated gas`,
      );

      assert(
        row.execution_time_ns
          === null,
        `${label}: applicable row has fabricated latency`,
      );

      assert(
        row.transaction_hash
          === null,
        `${label}: applicable row has fabricated transaction hash`,
      );

      assert(
        row.observation_source
          === null,
        `${label}: applicable row has fabricated observation source`,
      );

      continue;
    }

    if (
      row.applicability
      === "NOT_APPLICABLE"
    ) {
      notApplicable += 1;

      assert(
        row.actual_verdict
          === "NOT_APPLICABLE",
        `${label}: NOT_APPLICABLE verdict mismatch`,
      );

      assert(
        row.failure_class
          === "NOT_APPLICABLE",
        `${label}: NOT_APPLICABLE failure class mismatch`,
      );

      assert(
        row.failure_provenance
          === "PREREGISTERED_NOT_APPLICABLE",
        `${label}: NOT_APPLICABLE provenance mismatch`,
      );

      assert(
        row.observation_source
          === "PREREGISTERED_NOT_APPLICABLE",
        `${label}: NOT_APPLICABLE observation source mismatch`,
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
          `${label}: ${field} must remain null`,
        );
      }

      continue;
    }

    fail(
      `${label}: unknown applicability ${row.applicability}`,
    );
  }

  assert(
    applicable === 27,
    `applicable rows=${applicable}, expected 27`,
  );

  assert(
    notApplicable === 13,
    `NOT_APPLICABLE rows=${notApplicable}, expected 13`,
  );

  const p01 =
    rows.find(
      (row) =>
        row.scenario_id
          === "PILOT-01"
        && row.baseline
          === "D",
    );

  assert(
    p01
    && p01.amount
      === "1000000"
    && p01.max_spend
      === "1000000"
    && p01.nonce
      === "700001"
    && p01.valid_after
      === 1699999940
    && p01.valid_until
      === 1700003600,
    "PILOT-01/D parameter binding failed",
  );

  const p05 =
    rows.find(
      (row) =>
        row.scenario_id
          === "PILOT-05"
        && row.baseline
          === "D",
    );

  assert(
    p05
    && p05.amount
      === "1000000"
    && p05.max_spend
      === "1000000"
    && p05.min_out
      === "2000000"
    && p05.actual_out
      === "1999999",
    "PILOT-05/D parameter binding failed",
  );

  const p06 =
    rows.find(
      (row) =>
        row.scenario_id
          === "PILOT-06"
        && row.baseline
          === "D",
    );

  assert(
    p06
    && p06.batch_size
      === 2,
    "PILOT-06/D batch binding failed",
  );

  console.log(
    "EXECUTION_ENGINE_ROWS: 40",
  );

  console.log(
    "EXECUTION_ENGINE_APPLICABLE_ROWS: 27",
  );

  console.log(
    "EXECUTION_ENGINE_NOT_APPLICABLE_ROWS: 13",
  );

  console.log(
    "EXECUTION_ENGINE_SCHEMA_FIELDS: 70",
  );

  console.log(
    "EXECUTION_ENGINE_NO_FABRICATED_OBSERVATIONS: PASS",
  );

  console.log(
    "EXECUTION_ENGINE_PARAMETER_BINDING: PASS",
  );

  console.log(
    "PILOT_TRANSACTIONS_EXECUTED: 0",
  );

  console.log(
    "PILOT_OBSERVATIONS_CREATED: 0",
  );

  console.log(
    "EXECUTION_ENGINE_PLAN_PREFLIGHT_PASS",
  );
}
