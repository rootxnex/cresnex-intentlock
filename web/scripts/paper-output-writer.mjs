import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  renameSync,
} from "node:fs";

import {
  execFileSync,
} from "node:child_process";

import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  collectMeasuredPilotObservationsForWriter,
  OBSERVATION_EXECUTION_ROLES,
} from "./paper-observation-integration-preflight.mjs";

import {
  materializeExecutionRowsFromObservationRecords,
} from "./paper-execution-row-materialization-preflight.mjs";

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

const RUNS_ROOT =
  join(
    REPO_ROOT,
    "paper-artifacts/runs",
  );

const EXPECTED_BRANCH =
  "paper-experiments-2026";

const MEASURED_OBSERVATION_SOURCE =
  "MEASURED_PILOT_EXECUTION";

function fail(
  message,
) {
  throw new Error(
    message,
  );
}

function assert(
  condition,
  message,
) {
  if (!condition) {
    fail(
      message,
    );
  }
}

function fsyncFile(
  path,
) {
  const fd =
    openSync(
      path,
      "r",
    );

  try {
    fsyncSync(
      fd,
    );
  } finally {
    closeSync(
      fd,
    );
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
        .filter(
          Boolean,
        )
        .join(
          ": ",
        ),
    );
  }
}

function assertJsonSafe(
  value,
  path = "root",
) {
  if (
    value === undefined
  ) {
    fail(
      `${path}: undefined cannot be serialized`,
    );
  }

  if (
    typeof value === "bigint"
  ) {
    fail(
      `${path}: BigInt cannot be serialized directly`,
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
    && typeof value === "object"
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

export function toJournalSafe(
  value,
  path = "root",
  seen = new WeakSet(),
) {
  if (
    value === undefined
  ) {
    fail(
      `${path}: undefined cannot be journaled`,
    );
  }

  if (
    typeof value === "bigint"
  ) {
    return value.toString();
  }

  if (
    typeof value === "function"
    || typeof value === "symbol"
  ) {
    fail(
      `${path}: unsupported journal value ${typeof value}`,
    );
  }

  if (
    value === null
    || typeof value !== "object"
  ) {
    if (
      typeof value === "number"
      && !Number.isFinite(
        value,
      )
    ) {
      fail(
        `${path}: non-finite number cannot be journaled`,
      );
    }

    return value;
  }

  if (
    seen.has(
      value,
    )
  ) {
    fail(
      `${path}: circular journal value`,
    );
  }

  seen.add(
    value,
  );

  try {
    if (
      Array.isArray(
        value,
      )
    ) {
      return value.map(
        (
          item,
          index,
        ) =>
          toJournalSafe(
            item,
            `${path}[${index}]`,
            seen,
          ),
      );
    }

    const output = {};

    for (
      const [
        key,
        item,
      ]
      of Object.entries(
        value,
      )
    ) {
      output[key] =
        toJournalSafe(
          item,
          `${path}.${key}`,
          seen,
        );
    }

    return output;
  } finally {
    seen.delete(
      value,
    );
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

  return (
    rows
      .map(
        (row) =>
          JSON.stringify(
            row,
          ),
      )
      .join(
        "\n",
      )
    + "\n"
  );
}

function assertOutputInsideRunsRoot(
  outputPath,
) {
  const rel =
    relative(
      RUNS_ROOT,
      outputPath,
    );

  assert(
    rel.length > 0,
    "measured output cannot be the runs root itself",
  );

  assert(
    rel !== ".."
    && !rel.startsWith(
      `..${process.platform === "win32" ? "\\" : "/"}`,
    )
    && !isAbsolute(
      rel,
    ),
    `measured output must remain under ${RUNS_ROOT}`,
  );
}

function createRunId({
  head,
  startedAt,
}) {
  const compact =
    startedAt.replace(
      /[-:.TZ]/g,
      "",
    );

  return (
    `intentlock-pilot-`
    + `${head.slice(0, 12)}-`
    + compact
  );
}

export async function runMeasuredOutputWriter({
  outputPath,
  validateDirectory,
}) {
  assert(
    typeof validateDirectory
      === "function",
    "measured writer requires validateDirectory callback",
  );

  const resolvedOutputPath =
    resolve(
      outputPath,
    );

  assertOutputInsideRunsRoot(
    resolvedOutputPath,
  );

  assert(
    existsSync(
      RUNS_ROOT,
    )
    && statSync(
      RUNS_ROOT,
    ).isDirectory(),
    `runs root missing: ${RUNS_ROOT}`,
  );

  const outputParent =
    dirname(
      resolvedOutputPath,
    );

  assert(
    existsSync(
      outputParent,
    )
    && statSync(
      outputParent,
    ).isDirectory(),
    `output parent must already exist: ${outputParent}`,
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
    "measured pilot requires a clean worktree",
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
    /^[0-9a-f]{40}$/.test(
      head,
    ),
    `invalid HEAD SHA ${head}`,
  );

  assert(
    head === remoteHead,
    `HEAD=${head} does not match origin/${EXPECTED_BRANCH}=${remoteHead}`,
  );

  const incompletePath =
    `${resolvedOutputPath}.incomplete`;

  const attemptSentinelPath =
    join(
      RUNS_ROOT,
      ".measured-pilot-attempt.json",
    );

  assert(
    !existsSync(
      resolvedOutputPath,
    ),
    `refusing existing final output: ${resolvedOutputPath}`,
  );

  assert(
    !existsSync(
      incompletePath,
    ),
    `refusing existing incomplete output: ${incompletePath}`,
  );

  assert(
    !existsSync(
      attemptSentinelPath,
    ),
    [
      "measured pilot attempt sentinel already exists",
      attemptSentinelPath,
      "NO RETRY is permitted",
    ].join(
      ": ",
    ),
  );

  const startedAt =
    new Date()
      .toISOString();

  const runId =
    createRunId({
      head,
      startedAt,
    });

  /*
   * This is the irreversible experiment arm point.
   *
   * The sentinel is written BEFORE the first measured transaction and
   * is deliberately never removed, even if the process later fails.
   * This prevents an accidental retry from being treated as a fresh run.
   */
  writeFileSync(
    attemptSentinelPath,
    JSON.stringify(
      {
        state:
          "MEASURED_PILOT_ATTEMPT_STARTED_NO_RETRY",

        run_id:
          runId,

        git_commit:
          head,

        branch,

        output_path:
          resolvedOutputPath,

        incomplete_path:
          incompletePath,

        started_at:
          startedAt,
      },
      null,
      2,
    ) + "\n",
    {
      encoding:
        "utf8",

      flag:
        "wx",
    },
  );

  /*
   * The permanent no-retry record must reach the filesystem
   * before the measured collector is allowed to start.
   */
  fsyncFile(
    attemptSentinelPath,
  );

  mkdirSync(
    incompletePath,
    {
      recursive:
        false,
    },
  );

  const journalPath =
    join(
      incompletePath,
      "observations.journal.jsonl",
    );

  writeFileSync(
    journalPath,
    "",
    {
      encoding:
        "utf8",

      flag:
        "wx",
    },
  );

  let journaledObservations =
    0;

  /*
   * EXACTLY ONE designated measured collection call.
   *
   * No retry loop exists here.
   */
  const measuredRecords =
    await collectMeasuredPilotObservationsForWriter({
      onObservation:
        (
          record,
        ) => {
          const entry =
            toJournalSafe({
              journal_version:
                1,

              sequence:
                journaledObservations
                + 1,

              run_id:
                runId,

              git_commit:
                head,

              observation_source:
                MEASURED_OBSERVATION_SOURCE,

              scenario_id:
                record.planRow
                  .scenario_id,

              baseline:
                record.planRow
                  .baseline,

              repetition:
                record.planRow
                  .repetition,

              observation:
                record,
            });

          appendFileSync(
            journalPath,
            JSON.stringify(
              entry,
            ) + "\n",
            {
              encoding:
                "utf8",
            },
          );

          /*
           * A completed measured observation must be durable
           * before execution continues to the next row.
           */
          fsyncFile(
            journalPath,
          );

          journaledObservations +=
            1;
        },
    });

  assert(
    Array.isArray(
      measuredRecords,
    )
    && measuredRecords.length
      === 27,
    `measured records=${measuredRecords?.length}, expected 27`,
  );

  assert(
    journaledObservations
      === 27,
    `journaled observations=${journaledObservations}, expected 27`,
  );

  const journalLines =
    readFileSync(
      journalPath,
      "utf8",
    )
      .split(
        /\r?\n/,
      )
      .filter(
        (line) =>
          line.length > 0,
      );

  assert(
    journalLines.length
      === 27,
    `journal line count=${journalLines.length}, expected 27`,
  );

  for (
    let index = 0;
    index < journalLines.length;
    index += 1
  ) {
    let entry;

    try {
      entry =
        JSON.parse(
          journalLines[index],
        );
    } catch (error) {
      fail(
        `journal line ${index + 1} is invalid JSON: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }

    assert(
      entry.sequence
        === index + 1,
      `journal sequence mismatch at line ${index + 1}`,
    );

    assert(
      entry.run_id
        === runId,
      `journal run_id mismatch at line ${index + 1}`,
    );

    assert(
      entry.git_commit
        === head,
      `journal git_commit mismatch at line ${index + 1}`,
    );

    assert(
      entry.observation_source
        === MEASURED_OBSERVATION_SOURCE,
      `journal provenance mismatch at line ${index + 1}`,
    );
  }

  const rows =
    materializeExecutionRowsFromObservationRecords({
      observationRecords:
        measuredRecords,

      runId,

      gitCommit:
        head,

      observationSource:
        MEASURED_OBSERVATION_SOURCE,

      expectedExecutionRole:
        OBSERVATION_EXECUTION_ROLES
          .MEASURED_PILOT,

      /*
       * Measured observations must never be rejected merely because
       * they differ from preregistered expected results.
       */
      requireExpectedMatch:
        false,
    });

  assert(
    Array.isArray(
      rows,
    )
    && rows.length === 40,
    `materialized measured rows=${rows?.length}, expected 40`,
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

    assert(
      Object.keys(
        row,
      ).length === 70,
      `row ${index + 1}: expected exactly 70 fields`,
    );

    assert(
      row.run_id === runId,
      `row ${index + 1}: run_id mismatch`,
    );

    assert(
      row.git_commit === head,
      `row ${index + 1}: git_commit mismatch`,
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
        row.observation_source
          === MEASURED_OBSERVATION_SOURCE,
        `row ${index + 1}: measured observation provenance missing`,
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
        `row ${index + 1}: N/A provenance changed`,
      );

      continue;
    }

    fail(
      `row ${index + 1}: unknown applicability ${row.applicability}`,
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

  const jsonl =
    serializeJsonl(
      rows,
    );

  const executionsPath =
    join(
      incompletePath,
      "executions.jsonl",
    );

  writeFileSync(
    executionsPath,
    jsonl,
    {
      encoding:
        "utf8",

      flag:
        "wx",
    },
  );

  fsyncFile(
    executionsPath,
  );

  /*
   * Validate the complete artifact while it is still unpublished.
   */
  validateDirectory(
    incompletePath,
  );

  const currentHead =
    git(
      "rev-parse",
      "HEAD",
    );

  assert(
    currentHead === head,
    "HEAD changed during measured pilot execution",
  );

  assert(
    !existsSync(
      resolvedOutputPath,
    ),
    "final output appeared before atomic publish",
  );

  /*
   * Sibling-directory rename is the single publish operation.
   */
  renameSync(
    incompletePath,
    resolvedOutputPath,
  );

  /*
   * Revalidate the published artifact.
   */
  validateDirectory(
    resolvedOutputPath,
  );

  console.log(
    `MEASURED_OUTPUT_RUN_ID: ${runId}`,
  );

  console.log(
    `MEASURED_OUTPUT_GIT_COMMIT: ${head}`,
  );

  console.log(
    `MEASURED_OUTPUT_ATTEMPT_SENTINEL: ${attemptSentinelPath}`,
  );

  console.log(
    "MEASURED_OUTPUT_ROWS: 40",
  );

  console.log(
    "MEASURED_OUTPUT_APPLICABLE: 27",
  );

  console.log(
    "MEASURED_OUTPUT_NOT_APPLICABLE: 13",
  );

  console.log(
    "MEASURED_OUTPUT_SCHEMA_FIELDS: 70",
  );

  console.log(
    "MEASURED_PILOT_TRANSACTIONS_EXECUTED: 27",
  );

  console.log(
    "PILOT_OBSERVATIONS_PERSISTED: 27",
  );

  console.log(
    "MEASURED_OBSERVATION_JOURNAL_ROWS: 27",
  );

  console.log(
    `MEASURED_OUTPUT_JOURNAL: ${
      join(
        resolvedOutputPath,
        "observations.journal.jsonl",
      )
    }`,
  );

  console.log(
    `MEASURED_OUTPUT_DIRECTORY: ${resolvedOutputPath}`,
  );

  console.log(
    "MEASURED_OUTPUT_ATOMIC_PUBLISH: PASS",
  );

  console.log(
    "MEASURED_OUTPUT_NO_RETRY_SENTINEL: PASS",
  );

  console.log(
    "MEASURED_OUTPUT_COMPLETE",
  );

  return {
    runId,
    gitCommit:
      head,
    outputPath:
      resolvedOutputPath,
    attemptSentinelPath,
    rows,
  };
}
