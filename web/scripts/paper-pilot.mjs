import {
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import {
  dirname,
  join,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { runFixturePreflight } from "./paper-fixture-preflight.mjs";
import { runSigningPreflight } from "./paper-signing-preflight.mjs";
import { runScenarioPlanPreflight } from "./paper-scenario-plan.mjs";
import { runObservationPreflight } from "./paper-observation.mjs";
import { runEvidencePreflight } from "./paper-evidence.mjs";
import { runTraceProvenancePreflight } from "./paper-trace-provenance.mjs";
import { runLiveTracePreflight } from "./paper-live-trace-preflight.mjs";
import { runExecutionEnginePlanPreflight } from "./paper-execution-engine.mjs";
import { runSimpleBuilderPreflight } from "./paper-transaction-builders.mjs";
import { runAdvancedBuilderPreflight } from "./paper-advanced-transaction-builders.mjs";
import { runPrerequisitePreflight } from "./paper-prerequisite-preflight.mjs";
import { runPostconditionTracePreflight } from "./paper-postcondition-trace-preflight.mjs";
import {
  runMeasuredMatrixPreflight,
  runMeasuredSendPreflight,
} from "./paper-measured-transaction-executor.mjs";
import { runRevertEvidencePreflight } from "./paper-revert-evidence-preflight.mjs";
import { runObservationIntegrationPreflight } from "./paper-observation-integration-preflight.mjs";
import { runExecutionRowMaterializationPreflight } from "./paper-execution-row-materialization-preflight.mjs";
import { runOutputPreflight } from "./paper-output-preflight.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../..");

const PILOT_SPEC_PATH = join(
  REPO_ROOT,
  "paper-artifacts/reproducibility/pilot-scenarios.json",
);

const EXECUTION_SCHEMA_PATH = join(
  REPO_ROOT,
  "paper-artifacts/system/execution-row.schema.json",
);

/*
 * Reserved for later execution phases.
 * Phase 1 must not load, deploy, or execute these artifacts.
 */
const ARTIFACT_PATHS = Object.freeze({
  A: join(
    REPO_ROOT,
    "contracts/out/SignatureOnlyAccount.sol/SignatureOnlyAccount.json",
  ),
  B: join(
    REPO_ROOT,
    "contracts/out/SpendLimitGuardAccount.sol/SpendLimitGuardAccount.json",
  ),
  C: join(
    REPO_ROOT,
    "contracts/out/PathAndSpendGuardAccount.sol/PathAndSpendGuardAccount.json",
  ),
  D: join(
    REPO_ROOT,
    "contracts/out/CresnexIntentLockAccountV2.sol/CresnexIntentLockAccountV2.json",
  ),
  mockErc20: join(
    REPO_ROOT,
    "contracts/out/MockERC20.sol/MockERC20.json",
  ),
  mockDexRouter: join(
    REPO_ROOT,
    "contracts/out/MockDexRouter.sol/MockDexRouter.json",
  ),
});

const NOT_APPLICABLE_NULL_FIELDS = Object.freeze([
  "gas_used",
  "execution_time_ns",
  "execution_time_ms",
  "transaction_hash",
  "block_number",
]);

const MEASURED_OBSERVATION_SOURCE =
  "MEASURED_PILOT_EXECUTION";

const NOT_APPLICABLE_OBSERVATION_SOURCE =
  "PREREGISTERED_NOT_APPLICABLE";

const GIT_COMMIT_PATTERN =
  /^[0-9a-f]{40}$/;

const TRANSACTION_HASH_PATTERN =
  /^0x[0-9a-fA-F]{64}$/;

function usage() {
  return [
    "Usage:",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --help",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --fixture-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --signing-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --scenario-plan-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --observation-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --evidence-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --trace-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --live-trace-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --engine-plan-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --builder-simple-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --builder-advanced-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --prerequisite-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --postcondition-trace-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --measured-send-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --measured-matrix-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --revert-evidence-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --observation-integration-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --execution-row-materialization-preflight",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --output-preflight <new-directory>",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --output <new-directory>",
    "  node --experimental-strip-types web/scripts/paper-pilot.mjs --validate <existing-directory>",
  ].join("\n");
}

function fail(message) {
  throw new Error(message);
}

function readJson(path, label) {
  if (!existsSync(path)) {
    fail(`${label} does not exist: ${path}`);
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(
      `${label} is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "number";
  return typeof value;
}

function typeMatches(value, expectedType) {
  switch (expectedType) {
    case "null":
      return value === null;

    case "string":
      return typeof value === "string";

    case "boolean":
      return typeof value === "boolean";

    case "integer":
      return Number.isInteger(value);

    case "number":
      return typeof value === "number" && Number.isFinite(value);

    case "array":
      return Array.isArray(value);

    case "object":
      return (
        value !== null
        && typeof value === "object"
        && !Array.isArray(value)
      );

    default:
      fail(`Unsupported schema type: ${expectedType}`);
  }
}

function validateSchemaValue(field, value, definition, rowNumber) {
  const declaredTypes = Array.isArray(definition.type)
    ? definition.type
    : [definition.type];

  if (
    declaredTypes.length > 0
    && !declaredTypes.some((type) => typeMatches(value, type))
  ) {
    fail(
      `row ${rowNumber}: ${field} has type ${actualType(value)}; `
      + `expected ${declaredTypes.join(" or ")}`,
    );
  }

  if (
    definition.minimum !== undefined
    && value !== null
    && typeof value === "number"
    && value < definition.minimum
  ) {
    fail(
      `row ${rowNumber}: ${field}=${value} is below minimum `
      + `${definition.minimum}`,
    );
  }

  if (
    definition.pattern !== undefined
    && value !== null
    && typeof value === "string"
  ) {
    const pattern = new RegExp(definition.pattern);
    if (!pattern.test(value)) {
      fail(
        `row ${rowNumber}: ${field} does not match pattern `
        + `${definition.pattern}`,
      );
    }
  }
}

function validateRowAgainstSchema(row, schema, rowNumber) {
  if (
    row === null
    || typeof row !== "object"
    || Array.isArray(row)
  ) {
    fail(`row ${rowNumber}: execution row must be a JSON object`);
  }

  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) {
      fail(`row ${rowNumber}: missing required field ${field}`);
    }
  }

  if (schema.additionalProperties === false) {
    for (const field of Object.keys(row)) {
      if (!Object.prototype.hasOwnProperty.call(properties, field)) {
        fail(`row ${rowNumber}: unexpected field ${field}`);
      }
    }
  }

  for (const [field, value] of Object.entries(row)) {
    const definition = properties[field];

    if (!definition) {
      continue;
    }

    validateSchemaValue(field, value, definition, rowNumber);
  }
}

function validatePilotSpecification(pilot) {
  if (pilot.status !== "PREREGISTERED_UNEXECUTED_PILOT_DEFINITIONS") {
    fail(`unexpected pilot status: ${pilot.status}`);
  }

  if (pilot.dataset_role !== "PILOT_ONLY") {
    fail(`unexpected pilot dataset_role: ${pilot.dataset_role}`);
  }

  if (!Array.isArray(pilot.baseline_ids)) {
    fail("pilot baseline_ids must be an array");
  }

  const expectedBaselines = ["A", "B", "C", "D"];

  if (
    pilot.baseline_ids.length !== expectedBaselines.length
    || pilot.baseline_ids.some(
      (baseline, index) => baseline !== expectedBaselines[index],
    )
  ) {
    fail("pilot baseline_ids must be exactly A/B/C/D");
  }

  if (pilot.repetitions !== 1) {
    fail(`pilot repetitions must be 1, got ${pilot.repetitions}`);
  }

  if (!Array.isArray(pilot.scenario_definitions)) {
    fail("pilot scenario_definitions must be an array");
  }

  if (
    pilot.scenario_definitions.length
    !== pilot.scenario_concept_count
  ) {
    fail(
      "pilot scenario_concept_count does not match "
      + "scenario_definitions length",
    );
  }

  const calculatedRows =
    pilot.scenario_definitions.length
    * pilot.baseline_ids.length
    * pilot.repetitions;

  if (calculatedRows !== pilot.expected_row_count) {
    fail(
      `pilot expected_row_count=${pilot.expected_row_count}; `
      + `calculated=${calculatedRows}`,
    );
  }

  let attempted = 0;
  let notApplicable = 0;

  for (const scenario of pilot.scenario_definitions) {
    if (!scenario.baselines) {
      fail(`${scenario.pilot_id}: baselines object is missing`);
    }

    for (const baseline of pilot.baseline_ids) {
      const definition = scenario.baselines[baseline];

      if (!definition) {
        fail(`${scenario.pilot_id}: baseline ${baseline} is missing`);
      }

      if (definition.applicable === true) {
        attempted += 1;
      } else if (definition.applicable === false) {
        notApplicable += 1;
      } else {
        fail(
          `${scenario.pilot_id}/${baseline}: applicable must be boolean`,
        );
      }
    }
  }

  if (attempted !== pilot.expected_attempted_execution_count) {
    fail(
      `pilot applicable count=${attempted}; expected `
      + `${pilot.expected_attempted_execution_count}`,
    );
  }

  if (notApplicable !== pilot.expected_not_applicable_count) {
    fail(
      `pilot NOT_APPLICABLE count=${notApplicable}; expected `
      + `${pilot.expected_not_applicable_count}`,
    );
  }
}

function buildExpectedMatrix(pilot) {
  const matrix = new Map();

  for (const scenario of pilot.scenario_definitions) {
    for (const baseline of pilot.baseline_ids) {
      const baselineDefinition = scenario.baselines[baseline];

      for (
        let repetition = 1;
        repetition <= pilot.repetitions;
        repetition += 1
      ) {
        const key = [
          scenario.pilot_id,
          baseline,
          repetition,
        ].join("|");

        if (matrix.has(key)) {
          fail(`duplicate frozen pilot matrix key: ${key}`);
        }

        matrix.set(key, {
          scenario_id: scenario.pilot_id,
          baseline,
          repetition,
          workload: scenario.workload,
          mutation_class: scenario.mutation_class,
          legitimate_or_attack: scenario.legitimate_or_attack,
          expected_security_property:
            scenario.expected_security_property,
          expected_verdict:
            baselineDefinition.expected_verdict,
          applicability:
            baselineDefinition.applicable
              ? "APPLICABLE"
              : "NOT_APPLICABLE",
        });
      }
    }
  }

  return matrix;
}

function parseJsonl(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const rows = [];

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index].trim();

    if (text === "") {
      continue;
    }

    try {
      rows.push(JSON.parse(text));
    } catch (error) {
      fail(
        `executions.jsonl line ${index + 1} is invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return rows;
}

function assertFrozenField(row, expected, field, rowNumber) {
  if (row[field] !== expected[field]) {
    fail(
      `row ${rowNumber}: ${field}=${JSON.stringify(row[field])}; `
      + `expected ${JSON.stringify(expected[field])}`,
    );
  }
}

function validatePilotDirectory(directory) {
  if (!existsSync(directory)) {
    fail(`validation directory does not exist: ${directory}`);
  }

  if (!statSync(directory).isDirectory()) {
    fail(`validation path is not a directory: ${directory}`);
  }

  const executionsPath = join(directory, "executions.jsonl");

  if (!existsSync(executionsPath)) {
    fail(`missing pilot artifact: ${executionsPath}`);
  }

  const pilot = readJson(
    PILOT_SPEC_PATH,
    "frozen pilot specification",
  );

  const schema = readJson(
    EXECUTION_SCHEMA_PATH,
    "execution-row schema",
  );

  validatePilotSpecification(pilot);

  const expectedMatrix = buildExpectedMatrix(pilot);
  const rows = parseJsonl(executionsPath);

  if (rows.length !== pilot.expected_row_count) {
    fail(
      `pilot has ${rows.length} rows; expected `
      + `${pilot.expected_row_count}`,
    );
  }

  const seen = new Set();
  let applicableCount = 0;
  let notApplicableCount = 0;

  let commonRunId =
    null;

  let commonGitCommit =
    null;

  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 1;
    const row = rows[index];

    validateRowAgainstSchema(row, schema, rowNumber);

    if (row.dataset_role !== "PILOT_ONLY") {
      fail(
        `row ${rowNumber}: dataset_role must be PILOT_ONLY`,
      );
    }

    if (row.repetition !== 1) {
      fail(
        `row ${rowNumber}: repetition must be 1`,
      );
    }

    if (
      typeof row.run_id !== "string"
      || row.run_id.length === 0
    ) {
      fail(
        `row ${rowNumber}: run_id must be a non-empty string`,
      );
    }

    if (
      row.run_id
        === "DIAGNOSTIC_PREFLIGHT_NONPERSISTED"
    ) {
      fail(
        `row ${rowNumber}: diagnostic run_id cannot be persisted`,
      );
    }

    if (
      commonRunId === null
    ) {
      commonRunId =
        row.run_id;
    } else if (
      row.run_id !== commonRunId
    ) {
      fail(
        `row ${rowNumber}: run_id differs from the measured run`,
      );
    }

    if (
      typeof row.git_commit !== "string"
      || !GIT_COMMIT_PATTERN.test(
        row.git_commit,
      )
    ) {
      fail(
        `row ${rowNumber}: git_commit must be a 40-character lowercase SHA`,
      );
    }

    if (
      commonGitCommit === null
    ) {
      commonGitCommit =
        row.git_commit;
    } else if (
      row.git_commit
        !== commonGitCommit
    ) {
      fail(
        `row ${rowNumber}: git_commit differs from the measured run`,
      );
    }

    const key = [
      row.scenario_id,
      row.baseline,
      row.repetition,
    ].join("|");

    if (seen.has(key)) {
      fail(`row ${rowNumber}: duplicate pilot key ${key}`);
    }

    const expected = expectedMatrix.get(key);

    if (!expected) {
      fail(
        `row ${rowNumber}: row is not in frozen pilot matrix: ${key}`,
      );
    }

    assertFrozenField(
      row,
      expected,
      "scenario_id",
      rowNumber,
    );
    assertFrozenField(
      row,
      expected,
      "baseline",
      rowNumber,
    );
    assertFrozenField(
      row,
      expected,
      "workload",
      rowNumber,
    );
    assertFrozenField(
      row,
      expected,
      "mutation_class",
      rowNumber,
    );
    assertFrozenField(
      row,
      expected,
      "legitimate_or_attack",
      rowNumber,
    );
    assertFrozenField(
      row,
      expected,
      "expected_security_property",
      rowNumber,
    );
    assertFrozenField(
      row,
      expected,
      "expected_verdict",
      rowNumber,
    );
    assertFrozenField(
      row,
      expected,
      "applicability",
      rowNumber,
    );

    if (row.applicability === "APPLICABLE") {
      applicableCount += 1;

      if (
        row.observation_source
          !== MEASURED_OBSERVATION_SOURCE
      ) {
        fail(
          `row ${rowNumber}: applicable observation_source must be `
          + `${MEASURED_OBSERVATION_SOURCE}`,
        );
      }

      if (
        !TRANSACTION_HASH_PATTERN.test(
          row.transaction_hash ?? "",
        )
      ) {
        fail(
          `row ${rowNumber}: measured transaction_hash is missing or malformed`,
        );
      }

      if (
        !Number.isInteger(
          row.gas_used,
        )
        || row.gas_used <= 0
      ) {
        fail(
          `row ${rowNumber}: measured gas_used must be positive`,
        );
      }

      if (
        typeof row.execution_time_ns
          !== "string"
        || !/^(0|[1-9][0-9]*)$/.test(
          row.execution_time_ns,
        )
        || BigInt(
          row.execution_time_ns,
        ) <= 0n
      ) {
        fail(
          `row ${rowNumber}: measured execution_time_ns must be positive`,
        );
      }

      if (
        typeof row.execution_time_ms
          !== "number"
        || !Number.isFinite(
          row.execution_time_ms,
        )
        || row.execution_time_ms <= 0
      ) {
        fail(
          `row ${rowNumber}: measured execution_time_ms must be positive`,
        );
      }

      if (
        !Number.isInteger(
          row.block_number,
        )
        || row.block_number <= 0
      ) {
        fail(
          `row ${rowNumber}: measured block_number must be positive`,
        );
      }

      if (
        row.outer_receipt_status !== 0
        && row.outer_receipt_status !== 1
      ) {
        fail(
          `row ${rowNumber}: measured outer_receipt_status must be 0 or 1`,
        );
      }
    } else if (row.applicability === "NOT_APPLICABLE") {
      notApplicableCount += 1;

      if (
        row.observation_source
          !== NOT_APPLICABLE_OBSERVATION_SOURCE
      ) {
        fail(
          `row ${rowNumber}: NOT_APPLICABLE observation_source must remain `
          + `${NOT_APPLICABLE_OBSERVATION_SOURCE}`,
        );
      }

      for (const field of NOT_APPLICABLE_NULL_FIELDS) {
        if (row[field] !== null) {
          fail(
            `row ${rowNumber}: NOT_APPLICABLE field `
            + `${field} must be null`,
          );
        }
      }
    } else {
      fail(
        `row ${rowNumber}: invalid applicability `
        + `${JSON.stringify(row.applicability)}`,
      );
    }

    seen.add(key);
  }

  if (seen.size !== expectedMatrix.size) {
    const missing = [...expectedMatrix.keys()]
      .filter((key) => !seen.has(key));

    fail(
      `pilot matrix incomplete: ${missing.length} missing row(s): `
      + `${missing.slice(0, 5).join(", ")}`,
    );
  }

  if (
    applicableCount
    !== pilot.expected_attempted_execution_count
  ) {
    fail(
      `applicable rows=${applicableCount}; expected `
      + `${pilot.expected_attempted_execution_count}`,
    );
  }

  if (
    notApplicableCount
    !== pilot.expected_not_applicable_count
  ) {
    fail(
      `NOT_APPLICABLE rows=${notApplicableCount}; expected `
      + `${pilot.expected_not_applicable_count}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        dataset_role: "PILOT_ONLY",
        concepts: pilot.scenario_concept_count,
        rows: rows.length,
        applicable: applicableCount,
        not_applicable: notApplicableCount,
        run_id: commonRunId,
        git_commit: commonGitCommit,
        observation_source:
          MEASURED_OBSERVATION_SOURCE,
      },
      null,
      2,
    ),
  );
}

function validateNewOutputPath(path) {
  if (existsSync(path)) {
    fail(`refusing to overwrite existing pilot output: ${path}`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (
    args.length === 1
    && (args[0] === "--help" || args[0] === "-h")
  ) {
    console.log(usage());
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--fixture-preflight"
  ) {
    await runFixturePreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--signing-preflight"
  ) {
    await runSigningPreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--scenario-plan-preflight"
  ) {
    runScenarioPlanPreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--observation-preflight"
  ) {
    runObservationPreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--evidence-preflight"
  ) {
    await runEvidencePreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--trace-preflight"
  ) {
    runTraceProvenancePreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--live-trace-preflight"
  ) {
    await runLiveTracePreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--engine-plan-preflight"
  ) {
    runExecutionEnginePlanPreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--builder-simple-preflight"
  ) {
    await runSimpleBuilderPreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--builder-advanced-preflight"
  ) {
    await runAdvancedBuilderPreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--prerequisite-preflight"
  ) {
    await runPrerequisitePreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--postcondition-trace-preflight"
  ) {
    await runPostconditionTracePreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--measured-send-preflight"
  ) {
    await runMeasuredSendPreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--measured-matrix-preflight"
  ) {
    await runMeasuredMatrixPreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--revert-evidence-preflight"
  ) {
    await runRevertEvidencePreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--observation-integration-preflight"
  ) {
    await runObservationIntegrationPreflight();
    return 0;
  }

  if (
    args.length === 1
    && args[0] === "--execution-row-materialization-preflight"
  ) {
    await runExecutionRowMaterializationPreflight();
    return 0;
  }

  if (
    args.length === 2
    && args[0] === "--output-preflight"
  ) {
    const outputPath =
      resolve(
        process.cwd(),
        args[1],
      );

    await runOutputPreflight({
      outputPath,
    });

    return 0;
  }

  if (
    args.length !== 2
    || !["--output", "--validate"].includes(args[0])
  ) {
    console.error(usage());
    return 2;
  }

  const [command, rawPath] = args;
  const path = resolve(process.cwd(), rawPath);

  /*
   * Keep this reference explicit so later phases cannot silently change
   * the frozen artifact set without editing this source.
   */
  void ARTIFACT_PATHS;

  if (command === "--validate") {
    validatePilotDirectory(path);
    return 0;
  }

  validateNewOutputPath(path);

  console.error(
    "Pilot execution engine not implemented beyond fixture preflight; "
    + "no observations created.",
  );

  return 2;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(
    `pilot error: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}
