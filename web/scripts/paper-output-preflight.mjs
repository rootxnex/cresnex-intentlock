import {
  existsSync,
} from "node:fs";

import {
  execFileSync,
} from "node:child_process";

import {
  resolve,
} from "node:path";

import {
  runExecutionRowMaterializationPreflight,
} from "./paper-execution-row-materialization-preflight.mjs";

const EXPECTED_BRANCH =
  "paper-experiments-2026";

function fail(
  message,
) {
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

function git(
  ...args
) {
  try {
    return execFileSync(
      "git",
      args,
      {
        encoding:
          "utf8",

        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    ).trim();
  } catch (error) {
    const stderr =
      error
        ?.stderr
        ?.toString()
        ?.trim();

    fail(
      [
        `git ${args.join(" ")} failed`,
        stderr || null,
      ]
        .filter(Boolean)
        .join(": "),
    );
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

function assertJsonSafe(
  value,
  path = "root",
) {
  if (
    value === undefined
  ) {
    fail(
      `${path}: undefined value cannot be serialized`,
    );
  }

  if (
    typeof value
      === "bigint"
  ) {
    fail(
      `${path}: BigInt value cannot be serialized directly`,
    );
  }

  if (
    Array.isArray(
      value,
    )
  ) {
    value.forEach(
      (
        item,
        index,
      ) =>
        assertJsonSafe(
          item,
          `${path}[${index}]`,
        ),
    );

    return;
  }

  if (
    value !== null
    && typeof value
      === "object"
  ) {
    for (
      const [
        key,
        item,
      ]
      of Object.entries(
        value,
      )
    ) {
      assertJsonSafe(
        item,
        `${path}.${key}`,
      );
    }
  }
}

function serializeJsonl(
  rows,
) {
  for (
    let index = 0;
    index < rows.length;
    index += 1
  ) {
    assertJsonSafe(
      rows[index],
      `row[${index}]`,
    );
  }

  try {
    return (
      rows
        .map(
          (row) =>
            JSON.stringify(
              row,
            ),
        )
        .join("\n")
      + "\n"
    );
  } catch (error) {
    fail(
      `JSONL serialization failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`,
    );
  }
}

function parseJsonlInMemory(
  jsonl,
) {
  const lines =
    jsonl
      .split(/\r?\n/)
      .filter(
        (line) =>
          line.length > 0,
      );

  return lines.map(
    (
      line,
      index,
    ) => {
      try {
        return JSON.parse(
          line,
        );
      } catch (error) {
        fail(
          `round-trip row ${index + 1} parse failed: ${
            error instanceof Error
              ? error.message
              : String(error)
          }`,
        );
      }
    },
  );
}

export async function runOutputPreflight({
  outputPath,
}) {
  const resolvedOutputPath =
    resolve(
      outputPath,
    );

  const branch =
    git(
      "branch",
      "--show-current",
    );

  assert(
    branch === EXPECTED_BRANCH,
    `branch=${branch}, expected ${EXPECTED_BRANCH}`,
  );

  const initialStatus =
    git(
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    );

  assert(
    initialStatus === "",
    "output preflight requires a clean worktree",
  );

  const head =
    git(
      "rev-parse",
      "HEAD",
    );

  const remoteHead =
    git(
      "rev-parse",
      `origin/${EXPECTED_BRANCH}`,
    );

  assert(
    head === remoteHead,
    `HEAD=${head} does not match origin/${EXPECTED_BRANCH}=${remoteHead}`,
  );

  assert(
    !existsSync(
      resolvedOutputPath,
    ),
    `refusing existing output path: ${resolvedOutputPath}`,
  );

  /*
   * This intentionally executes only the already-approved reversible
   * diagnostic pipeline.
   *
   * Returned rows must remain tagged as diagnostic and are NOT eligible
   * to be persisted as measured pilot observations.
   */
  const rows =
    await runExecutionRowMaterializationPreflight();

  assert(
    Array.isArray(
      rows,
    ),
    "materialization preflight did not return an array",
  );

  assert(
    rows.length === 40,
    `returned row count=${rows.length}, expected 40`,
  );

  let applicable =
    0;

  let notApplicable =
    0;

  for (
    let index = 0;
    index < rows.length;
    index += 1
  ) {
    const row =
      rows[index];

    const key =
      rowKey(
        row,
      );

    assert(
      Object.keys(
        row,
      ).length === 70,
      `${key}: field count must remain 70`,
    );

    assertJsonSafe(
      row,
      `row[${index}]`,
    );

    if (
      row.applicability
        === "APPLICABLE"
    ) {
      applicable += 1;

      assert(
        row.run_id
          === "DIAGNOSTIC_PREFLIGHT_NONPERSISTED",
        `${key}: diagnostic run_id protection lost`,
      );

      assert(
        row.observation_source
          === "DIAGNOSTIC_PREFLIGHT_NONPERSISTED",
        `${key}: diagnostic observation_source protection lost`,
      );

      continue;
    }

    if (
      row.applicability
        === "NOT_APPLICABLE"
    ) {
      notApplicable += 1;

      assert(
        row.observation_source
          === "PREREGISTERED_NOT_APPLICABLE",
        `${key}: N/A observation source changed`,
      );

      continue;
    }

    fail(
      `${key}: unknown applicability ${row.applicability}`,
    );
  }

  assert(
    applicable === 27,
    `applicable rows=${applicable}, expected 27`,
  );

  assert(
    notApplicable === 13,
    `N/A rows=${notApplicable}, expected 13`,
  );

  const originalKeys =
    rows.map(
      rowKey,
    );

  const jsonl =
    serializeJsonl(
      rows,
    );

  assert(
    typeof jsonl
      === "string"
    && jsonl.length > 0,
    "JSONL serialization produced empty output",
  );

  const roundTripRows =
    parseJsonlInMemory(
      jsonl,
    );

  assert(
    roundTripRows.length
      === 40,
    `round-trip row count=${roundTripRows.length}, expected 40`,
  );

  const roundTripKeys =
    roundTripRows.map(
      rowKey,
    );

  assert(
    originalKeys.length
      === roundTripKeys.length
    && originalKeys.every(
      (
        key,
        index,
      ) =>
        key
          === roundTripKeys[
            index
          ],
    ),
    "JSONL round-trip changed frozen row ordering",
  );

  for (
    let index = 0;
    index < rows.length;
    index += 1
  ) {
    assert(
      JSON.stringify(
        rows[index],
      )
        === JSON.stringify(
          roundTripRows[index],
        ),
      `round-trip row ${index + 1} changed`,
    );
  }

  assert(
    !existsSync(
      resolvedOutputPath,
    ),
    "output path was created during output preflight",
  );

  const finalHead =
    git(
      "rev-parse",
      "HEAD",
    );

  const finalRemoteHead =
    git(
      "rev-parse",
      `origin/${EXPECTED_BRANCH}`,
    );

  const finalStatus =
    git(
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    );

  assert(
    finalHead === head,
    "HEAD changed during output preflight",
  );

  assert(
    finalRemoteHead
      === remoteHead,
    "remote-tracking commit changed during output preflight",
  );

  assert(
    finalStatus === "",
    "worktree changed during output preflight",
  );

  console.log(
    `OUTPUT_PREFLIGHT_BRANCH: ${branch}`,
  );

  console.log(
    `OUTPUT_PREFLIGHT_GIT_COMMIT: ${head}`,
  );

  console.log(
    "OUTPUT_PREFLIGHT_HEAD_REMOTE_ALIGNMENT: PASS",
  );

  console.log(
    "OUTPUT_PREFLIGHT_CLEAN_WORKTREE: PASS",
  );

  console.log(
    "OUTPUT_PREFLIGHT_DESTINATION_NONEXISTENT: PASS",
  );

  console.log(
    "OUTPUT_PREFLIGHT_ROWS: 40",
  );

  console.log(
    "OUTPUT_PREFLIGHT_APPLICABLE: 27",
  );

  console.log(
    "OUTPUT_PREFLIGHT_NOT_APPLICABLE: 13",
  );

  console.log(
    "OUTPUT_PREFLIGHT_SCHEMA_FIELDS: 70",
  );

  console.log(
    "OUTPUT_PREFLIGHT_JSON_SAFE: PASS",
  );

  console.log(
    "OUTPUT_PREFLIGHT_JSONL_ROUND_TRIP: PASS",
  );

  console.log(
    "OUTPUT_PREFLIGHT_ROW_ORDER_PRESERVED: PASS",
  );

  console.log(
    "DIAGNOSTIC_ROWS_NOT_ELIGIBLE_FOR_PERSISTENCE: PASS",
  );

  console.log(
    "OUTPUT_PREFLIGHT_NO_FILES_WRITTEN: PASS",
  );

  console.log(
    "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 0",
  );

  console.log(
    "PILOT_OBSERVATIONS_CREATED: 0",
  );

  console.log(
    "OUTPUT_PREFLIGHT_PASS",
  );
}
