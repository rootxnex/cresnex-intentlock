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

const PILOT_SPEC_PATH =
  join(
    REPO_ROOT,
    "paper-artifacts/reproducibility/pilot-scenarios.json",
  );

const BASELINES =
  Object.freeze(["A", "B", "C", "D"]);

const EXPECTED = Object.freeze({
  concepts: 10,
  rows: 40,
  applicable: 27,
  notApplicable: 13,
});

const EXPECTED_NONCES =
  Object.freeze({
    "PILOT-01": "700001",
    "PILOT-02": "700002",
    "PILOT-03": "700003",
    "PILOT-04": "700004",
    "PILOT-05": "700005",
    "PILOT-06": "700006",
    "PILOT-07": "700007",
    "PILOT-08": "700008",
    "PILOT-09": "700009",
    "PILOT-10": "700010",
  });

const EXPECTED_APPLICABILITY =
  Object.freeze({
    "PILOT-01": "ABCD",
    "PILOT-02": "ABCD",
    "PILOT-03": "ABCD",
    "PILOT-04": "ACD",
    "PILOT-05": "AD",
    "PILOT-06": "D",
    "PILOT-07": "ABCD",
    "PILOT-08": "ACD",
    "PILOT-09": "D",
    "PILOT-10": "D",
  });

function fail(message) {
  throw new Error(message);
}

function loadPilot() {
  return JSON.parse(
    readFileSync(
      PILOT_SPEC_PATH,
      "utf8",
    ),
  );
}

function requireEqual(
  label,
  actual,
  expected,
) {
  if (actual !== expected) {
    fail(
      `${label}: ${JSON.stringify(actual)} `
      + `!= ${JSON.stringify(expected)}`,
    );
  }
}

function requireArrayExact(
  label,
  actual,
  expected,
) {
  if (
    !Array.isArray(actual)
    || actual.length !== expected.length
    || actual.some(
      (value, index) =>
        value !== expected[index],
    )
  ) {
    fail(
      `${label}: frozen array mismatch`,
    );
  }
}

function signingStrategy(
  scenarioId,
  baseline,
) {
  if (baseline === "A") {
    return "A_AUTHORIZATION_HASH";
  }

  if (baseline === "B") {
    return "B_AUTHORIZATION_HASH";
  }

  if (baseline === "C") {
    return "C_AUTHORIZATION_HASH";
  }

  if (baseline === "D") {
    if (scenarioId === "PILOT-06") {
      return "D_SIGN_ORIGINAL_CALLS_EXECUTE_REORDERED";
    }

    return "D_HASH_INTENT";
  }

  fail(
    `unknown baseline ${baseline}`,
  );
}

function executionKind(
  scenarioId,
  baseline,
) {
  if (baseline === "A") {
    return "SIGNATURE_ONLY_EXECUTE";
  }

  if (baseline === "B") {
    return "SPEND_LIMIT_TRANSFER";
  }

  if (baseline === "C") {
    return "PATH_AND_SPEND_EXECUTE";
  }

  if (baseline !== "D") {
    fail(
      `unknown baseline ${baseline}`,
    );
  }

  switch (scenarioId) {
    case "PILOT-01":
      return "D_TRANSFER_ALLOW";

    case "PILOT-02":
      return "D_TRANSFER_WRONG_RECIPIENT";

    case "PILOT-03":
      return "D_TRANSFER_OVERSPEND";

    case "PILOT-04":
      return "D_APPROVAL_WRONG_SPENDER";

    case "PILOT-05":
      return "D_SWAP_POSTCONDITION";

    case "PILOT-06":
      return "D_ORDERED_BATCH_REORDER";

    case "PILOT-07":
      return "D_NONCE_REPLAY";

    case "PILOT-08":
      return "D_RESIDUAL_ALLOWANCE";

    case "PILOT-09":
      return "D_THIRD_POLICY_VIOLATION";

    case "PILOT-10":
      return "D_POST_QUARANTINE_EXECUTION";

    default:
      fail(
        `unknown scenario ${scenarioId}`,
      );
  }
}

function prerequisiteKind(
  scenarioId,
  baseline,
) {
  if (
    scenarioId === "PILOT-05"
    && baseline === "A"
  ) {
    return "A_ROUTER_ALLOWANCE_SETUP";
  }

  if (scenarioId === "PILOT-07") {
    return "PRIOR_SUCCESSFUL_EXECUTION";
  }

  if (
    scenarioId === "PILOT-09"
    && baseline === "D"
  ) {
    return "TWO_PRIOR_D_POLICY_VIOLATIONS";
  }

  if (
    scenarioId === "PILOT-10"
    && baseline === "D"
  ) {
    return "THRESHOLD_ONE_AND_PRIOR_D_POLICY_VIOLATION";
  }

  return "NONE";
}

function prerequisiteParameters(
  scenarioId,
  baseline,
) {
  if (
    scenarioId === "PILOT-05"
    && baseline === "A"
  ) {
    return {
      timestamp: 1700000999,
      nonce: "790005",
      action: "USDC_APPROVE_ROUTER",
      amount: "1000000",
      measured: false,
    };
  }

  if (scenarioId === "PILOT-07") {
    return {
      timestamp: 1700000999,
      nonce: "700007",
      action: "PRIOR_IDENTICAL_SUCCESS",
      measured: false,
    };
  }

  if (
    scenarioId === "PILOT-09"
    && baseline === "D"
  ) {
    return {
      timestamps: [
        1700000998,
        1700000999,
      ],
      nonces: [
        "790091",
        "790092",
      ],
      action: "TWO_AUTHENTICATED_POLICY_VIOLATIONS",
      measured: false,
    };
  }

  if (
    scenarioId === "PILOT-10"
    && baseline === "D"
  ) {
    return {
      threshold: 1,
      timestamp: 1700000999,
      nonce: "790101",
      action: "ONE_AUTHENTICATED_POLICY_VIOLATION",
      measured: false,
    };
  }

  return null;
}

function validationProvenance(
  scenarioId,
  baseline,
) {
  if (
    baseline === "D"
    && (
      scenarioId === "PILOT-05"
      || scenarioId === "PILOT-08"
    )
  ) {
    return "TRACE_REQUIRED_FOR_POSTCONDITION";
  }

  if (
    baseline === "D"
    && (
      scenarioId === "PILOT-02"
      || scenarioId === "PILOT-03"
      || scenarioId === "PILOT-04"
      || scenarioId === "PILOT-09"
    )
  ) {
    return "INTENT_VIOLATION_PLUS_STORED_RECORD";
  }

  if (
    scenarioId === "PILOT-07"
  ) {
    return "KNOWN_USED_NONCE_PRESTATE";
  }

  if (
    scenarioId === "PILOT-10"
    && baseline === "D"
  ) {
    return "AGENT_QUARANTINED_PRESTATE";
  }

  return "FINAL_STATE_AND_RECEIPT";
}

export function buildPilotPlan() {
  const pilot =
    loadPilot();

  requireEqual(
    "status",
    pilot.status,
    "PREREGISTERED_UNEXECUTED_PILOT_DEFINITIONS",
  );

  requireEqual(
    "dataset_role",
    pilot.dataset_role,
    "PILOT_ONLY",
  );

  requireArrayExact(
    "baseline_ids",
    pilot.baseline_ids,
    BASELINES,
  );

  requireEqual(
    "repetitions",
    pilot.repetitions,
    1,
  );

  requireEqual(
    "scenario_concept_count",
    pilot.scenario_concept_count,
    EXPECTED.concepts,
  );

  requireEqual(
    "expected_row_count",
    pilot.expected_row_count,
    EXPECTED.rows,
  );

  requireEqual(
    "expected_attempted_execution_count",
    pilot.expected_attempted_execution_count,
    EXPECTED.applicable,
  );

  requireEqual(
    "expected_not_applicable_count",
    pilot.expected_not_applicable_count,
    EXPECTED.notApplicable,
  );

  const plan = [];

  for (
    const scenario
    of pilot.scenario_definitions
  ) {
    const {
      pilot_id: scenarioId,
      parameters,
    } = scenario;

    if (
      !Object.prototype.hasOwnProperty.call(
        EXPECTED_NONCES,
        scenarioId,
      )
    ) {
      fail(
        `unexpected scenario ${scenarioId}`,
      );
    }

    requireEqual(
      `${scenarioId}.nonce`,
      String(parameters.nonce),
      EXPECTED_NONCES[scenarioId],
    );

    requireEqual(
      `${scenarioId}.chain_id`,
      parameters.chain_id,
      31337,
    );

    requireEqual(
      `${scenarioId}.measured_timestamp`,
      parameters.measured_timestamp,
      1700001000,
    );

    requireEqual(
      `${scenarioId}.valid_after`,
      parameters.valid_after,
      1699999940,
    );

    requireEqual(
      `${scenarioId}.valid_until`,
      parameters.valid_until,
      1700003600,
    );

    const applicableString =
      BASELINES
        .filter(
          (baseline) =>
            scenario
              .baselines[baseline]
              .applicable,
        )
        .join("");

    requireEqual(
      `${scenarioId}.applicability`,
      applicableString,
      EXPECTED_APPLICABILITY[
        scenarioId
      ],
    );

    for (
      const baseline
      of BASELINES
    ) {
      const baselineDefinition =
        scenario.baselines[baseline];

      const applicable =
        baselineDefinition.applicable
          === true;

      plan.push({
        scenario_id:
          scenarioId,

        baseline,

        repetition: 1,

        dataset_role:
          "PILOT_ONLY",

        applicability:
          applicable
            ? "APPLICABLE"
            : "NOT_APPLICABLE",

        workload:
          scenario.workload,

        mutation_class:
          scenario.mutation_class,

        legitimate_or_attack:
          scenario
            .legitimate_or_attack,

        expected_security_property:
          scenario
            .expected_security_property,

        expected_verdict:
          baselineDefinition
            .expected_verdict,

        expected_reason_class:
          baselineDefinition
            .expected_reason_class,

        expected_reason_code:
          baselineDefinition
            .expected_reason_code,

        nonce:
          String(parameters.nonce),

        chain_id:
          parameters.chain_id,

        measured_timestamp:
          parameters.measured_timestamp,

        signing_strategy:
          applicable
            ? signingStrategy(
                scenarioId,
                baseline,
              )
            : null,

        execution_kind:
          applicable
            ? executionKind(
                scenarioId,
                baseline,
              )
            : null,

        prerequisite_kind:
          applicable
            ? prerequisiteKind(
                scenarioId,
                baseline,
              )
            : null,

        prerequisite_parameters:
          applicable
            ? prerequisiteParameters(
                scenarioId,
                baseline,
              )
            : null,

        validation_provenance:
          applicable
            ? validationProvenance(
                scenarioId,
                baseline,
              )
            : null,

        parameters:
          structuredClone(
            parameters,
          ),
      });
    }
  }

  return plan;
}

export function validatePilotPlan(
  plan,
) {
  requireEqual(
    "plan.length",
    plan.length,
    EXPECTED.rows,
  );

  const keys = new Set();

  let applicable = 0;
  let notApplicable = 0;

  for (
    const row
    of plan
  ) {
    const key =
      [
        row.scenario_id,
        row.baseline,
        row.repetition,
      ].join("|");

    if (keys.has(key)) {
      fail(
        `duplicate plan key ${key}`,
      );
    }

    keys.add(key);

    if (
      row.applicability
      === "APPLICABLE"
    ) {
      applicable += 1;

      if (
        row.signing_strategy
          === null
        || row.execution_kind
          === null
        || row.prerequisite_kind
          === null
        || row.validation_provenance
          === null
      ) {
        fail(
          `${key}: incomplete executable plan`,
        );
      }
    } else if (
      row.applicability
      === "NOT_APPLICABLE"
    ) {
      notApplicable += 1;

      if (
        row.signing_strategy
          !== null
        || row.execution_kind
          !== null
        || row.prerequisite_kind
          !== null
        || row.prerequisite_parameters
          !== null
        || row.validation_provenance
          !== null
      ) {
        fail(
          `${key}: NOT_APPLICABLE row has execution metadata`,
        );
      }
    } else {
      fail(
        `${key}: invalid applicability`,
      );
    }
  }

  requireEqual(
    "applicable count",
    applicable,
    EXPECTED.applicable,
  );

  requireEqual(
    "NOT_APPLICABLE count",
    notApplicable,
    EXPECTED.notApplicable,
  );

  return {
    concepts:
      EXPECTED.concepts,

    rows:
      plan.length,

    applicable,

    not_applicable:
      notApplicable,
  };
}

export function runScenarioPlanPreflight() {
  const plan =
    buildPilotPlan();

  const summary =
    validatePilotPlan(plan);

  console.log(
    JSON.stringify(
      summary,
      null,
      2,
    ),
  );

  for (
    const scenarioId
    of Object.keys(
      EXPECTED_APPLICABILITY,
    )
  ) {
    const rows =
      plan.filter(
        (row) =>
          row.scenario_id
          === scenarioId,
      );

    console.log(
      [
        scenarioId,
        `nonce=${rows[0].nonce}`,
        `applicable=${
          rows
            .filter(
              (row) =>
                row.applicability
                === "APPLICABLE",
            )
            .map(
              (row) =>
                row.baseline,
            )
            .join("")
        }`,
      ].join(" "),
    );
  }

  console.log(
    "PILOT_TRANSACTIONS_EXECUTED: 0",
  );

  console.log(
    "PILOT_OBSERVATIONS_CREATED: 0",
  );

  console.log(
    "SCENARIO_PLAN_PREFLIGHT_PASS",
  );
}
