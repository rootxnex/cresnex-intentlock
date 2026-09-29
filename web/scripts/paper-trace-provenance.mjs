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

const CONTRACTS_ROOT =
  join(
    REPO_ROOT,
    "contracts",
  );

const SOURCE_PATH =
  "src/CresnexIntentLockAccountV2.sol";

const CONTRACT_NAME =
  "CresnexIntentLockAccountV2";

const ARTIFACT_PATH =
  join(
    CONTRACTS_ROOT,
    "out",
    "CresnexIntentLockAccountV2.sol",
    "CresnexIntentLockAccountV2.json",
  );

const CACHE_PATH =
  join(
    CONTRACTS_ROOT,
    "cache",
    "solidity-files-cache.json",
  );

const BUILD_INFO_DIR =
  join(
    CONTRACTS_ROOT,
    "out",
    "build-info",
  );

const SOURCE_FILE_PATH =
  join(
    CONTRACTS_ROOT,
    SOURCE_PATH,
  );

const FUNCTION_NAME =
  "_validateOutcomes";

const INNER_D_DEPTH =
  2;

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(
    readFileSync(
      path,
      "utf8",
    ),
  );
}

function resolveBuildId(
  cache,
) {
  const source =
    cache.files?.[
      SOURCE_PATH
    ];

  if (
    !source
    || typeof source
      !== "object"
  ) {
    fail(
      "target source missing from Foundry cache",
    );
  }

  const contract =
    source.artifacts?.[
      CONTRACT_NAME
    ];

  if (
    !contract
    || typeof contract
      !== "object"
  ) {
    fail(
      "target contract missing from Foundry cache",
    );
  }

  const candidates = [];

  for (
    const compilerValue
    of Object.values(
      contract,
    )
  ) {
    if (
      !compilerValue
      || typeof compilerValue
        !== "object"
    ) {
      continue;
    }

    for (
      const profileValue
      of Object.values(
        compilerValue,
      )
    ) {
      if (
        profileValue
        && typeof profileValue
          === "object"
        && typeof profileValue.build_id
          === "string"
      ) {
        candidates.push(
          profileValue.build_id,
        );
      }
    }
  }

  const unique =
    [...new Set(candidates)];

  if (
    unique.length !== 1
  ) {
    fail(
      `expected exactly one build_id; got ${JSON.stringify(unique)}`,
    );
  }

  return unique[0];
}

function findFunctionRange(
  sourceBuffer,
  functionName,
) {
  const needle =
    Buffer.from(
      `function ${functionName}(`,
      "utf8",
    );

  const start =
    sourceBuffer.indexOf(
      needle,
    );

  if (start < 0) {
    fail(
      `${functionName} not found`,
    );
  }

  const openBrace =
    sourceBuffer.indexOf(
      Buffer.from("{"),
      start,
    );

  if (openBrace < 0) {
    fail(
      `${functionName} opening brace not found`,
    );
  }

  let depth = 0;
  let state = "CODE";

  for (
    let i = openBrace;
    i < sourceBuffer.length;
    i += 1
  ) {
    const byte =
      sourceBuffer[i];

    const next =
      i + 1 < sourceBuffer.length
        ? sourceBuffer[i + 1]
        : null;

    if (
      state === "CODE"
    ) {
      if (
        byte === 0x2f
        && next === 0x2f
      ) {
        state =
          "LINE_COMMENT";

        i += 1;
        continue;
      }

      if (
        byte === 0x2f
        && next === 0x2a
      ) {
        state =
          "BLOCK_COMMENT";

        i += 1;
        continue;
      }

      if (
        byte === 0x22
      ) {
        state =
          "DOUBLE_STRING";

        continue;
      }

      if (
        byte === 0x27
      ) {
        state =
          "SINGLE_STRING";

        continue;
      }

      if (
        byte === 0x7b
      ) {
        depth += 1;
        continue;
      }

      if (
        byte === 0x7d
      ) {
        depth -= 1;

        if (
          depth === 0
        ) {
          return {
            start,
            endExclusive:
              i + 1,

            length:
              i + 1 - start,
          };
        }
      }

      continue;
    }

    if (
      state === "LINE_COMMENT"
    ) {
      if (
        byte === 0x0a
      ) {
        state =
          "CODE";
      }

      continue;
    }

    if (
      state === "BLOCK_COMMENT"
    ) {
      if (
        byte === 0x2a
        && next === 0x2f
      ) {
        state =
          "CODE";

        i += 1;
      }

      continue;
    }

    if (
      state === "DOUBLE_STRING"
    ) {
      if (
        byte === 0x5c
      ) {
        i += 1;
        continue;
      }

      if (
        byte === 0x22
      ) {
        state =
          "CODE";
      }

      continue;
    }

    if (
      state === "SINGLE_STRING"
    ) {
      if (
        byte === 0x5c
      ) {
        i += 1;
        continue;
      }

      if (
        byte === 0x27
      ) {
        state =
          "CODE";
      }
    }
  }

  fail(
    `${functionName} closing brace not found`,
  );
}

export function parseSoliditySourceMap(
  sourceMap,
) {
  const previous = [
    null,
    null,
    null,
    null,
    null,
  ];

  return sourceMap
    .split(";")
    .map(
      (
        raw,
        instructionIndex,
      ) => {
        const parts =
          raw.split(":");

        for (
          let index = 0;
          index < parts.length;
          index += 1
        ) {
          if (
            parts[index] !== ""
          ) {
            previous[index] =
              parts[index];
          }
        }

        return {
          instructionIndex,

          start:
            previous[0] === null
              ? null
              : Number(
                  previous[0],
                ),

          length:
            previous[1] === null
              ? null
              : Number(
                  previous[1],
                ),

          fileId:
            previous[2] === null
              ? null
              : Number(
                  previous[2],
                ),

          jump:
            previous[3]
            ?? null,

          modifierDepth:
            previous[4] === null
              ? null
              : Number(
                  previous[4],
                ),
        };
      },
    );
}

export function disassembleProgramCounters(
  bytecode,
) {
  if (
    typeof bytecode !== "string"
    || !bytecode.startsWith("0x")
  ) {
    fail(
      "runtime bytecode must be 0x-prefixed hex",
    );
  }

  const hex =
    bytecode.slice(2);

  if (
    hex.length % 2 !== 0
  ) {
    fail(
      "runtime bytecode has odd hex length",
    );
  }

  const byteLength =
    hex.length / 2;

  const pcs = [];

  let pc = 0;

  while (
    pc < byteLength
  ) {
    const opcode =
      Number.parseInt(
        hex.slice(
          pc * 2,
          pc * 2 + 2,
        ),
        16,
      );

    if (
      Number.isNaN(opcode)
    ) {
      fail(
        `invalid opcode at pc ${pc}`,
      );
    }

    pcs.push(pc);

    const pushBytes =
      opcode >= 0x60
      && opcode <= 0x7f
        ? opcode - 0x5f
        : 0;

    pc +=
      1 + pushBytes;
  }

  return pcs;
}

export function buildPcSourceTable({
  bytecode,
  sourceMap,
}) {
  const pcs =
    disassembleProgramCounters(
      bytecode,
    );

  const mappings =
    parseSoliditySourceMap(
      sourceMap,
    );

  if (
    mappings.length
    > pcs.length
  ) {
    fail(
      `source map has ${mappings.length} entries `
      + `but runtime has only ${pcs.length} instructions`,
    );
  }

  return mappings.map(
    (
      mapping,
      index,
    ) => ({
      pc:
        pcs[index],

      ...mapping,
    }),
  );
}

export function loadTraceProvenanceContext() {
  const artifact =
    readJson(
      ARTIFACT_PATH,
    );

  const cache =
    readJson(
      CACHE_PATH,
    );

  const buildId =
    resolveBuildId(
      cache,
    );

  const buildInfo =
    readJson(
      join(
        BUILD_INFO_DIR,
        `${buildId}.json`,
      ),
    );

  const artifactSourceId =
    Number(
      artifact.id,
    );

  if (
    !Number.isInteger(
      artifactSourceId,
    )
  ) {
    fail(
      "artifact source id missing",
    );
  }

  const mappedPath =
    buildInfo
      .source_id_to_path?.[
        String(
          artifactSourceId,
        )
      ];

  if (
    mappedPath !== SOURCE_PATH
  ) {
    fail(
      `build-info source mismatch: `
      + `${artifactSourceId} -> ${JSON.stringify(mappedPath)}`,
    );
  }

  const deployed =
    artifact.deployedBytecode;

  if (
    !deployed
    || typeof deployed.object
      !== "string"
    || typeof deployed.sourceMap
      !== "string"
    || deployed.object.length <= 2
    || deployed.sourceMap.length === 0
  ) {
    fail(
      "deployed bytecode/source map missing",
    );
  }

  const functionRange =
    findFunctionRange(
      readFileSync(
        SOURCE_FILE_PATH,
      ),
      FUNCTION_NAME,
    );

  const pcSourceTable =
    buildPcSourceTable({
      bytecode:
        deployed.object,

      sourceMap:
        deployed.sourceMap,
    });

  const pcMap =
    new Map(
      pcSourceTable.map(
        (entry) => [
          entry.pc,
          entry,
        ],
      ),
    );

  return {
    buildId,
    artifactSourceId,
    mappedPath,
    functionName:
      FUNCTION_NAME,
    functionRange,
    pcSourceTable,
    pcMap,
  };
}

export function sourceEntryInValidateOutcomes(
  entry,
  context,
) {
  if (!entry) {
    return false;
  }

  return (
    entry.fileId
      === context.artifactSourceId
    && Number.isInteger(
      entry.start,
    )
    && entry.start
      >= context.functionRange.start
    && entry.start
      < context.functionRange.endExclusive
  );
}

export function resolveTraceStage({
  structLogs,
  context,
  expectedDepth =
    INNER_D_DEPTH,
}) {
  if (
    !Array.isArray(
      structLogs,
    )
  ) {
    fail(
      "trace structLogs must be an array",
    );
  }

  const matches = [];

  for (
    const log
    of structLogs
  ) {
    if (
      Number(log.depth)
      !== expectedDepth
    ) {
      continue;
    }

    const pc =
      Number(log.pc);

    if (
      !Number.isInteger(pc)
    ) {
      continue;
    }

    const sourceEntry =
      context.pcMap.get(
        pc,
      );

    if (
      sourceEntryInValidateOutcomes(
        sourceEntry,
        context,
      )
    ) {
      matches.push({
        pc,

        depth:
          Number(log.depth),

        op:
          log.op
          ?? null,

        sourceStart:
          sourceEntry.start,

        sourceLength:
          sourceEntry.length,

        sourceFileId:
          sourceEntry.fileId,

        instructionIndex:
          sourceEntry
            .instructionIndex,
      });
    }
  }

  if (
    matches.length === 0
  ) {
    return {
      traceStage:
        null,

      provenance:
        "NO_VALIDATE_OUTCOMES_SOURCE_MATCH",

      matches: [],
    };
  }

  return {
    traceStage:
      "_validateOutcomes",

    provenance:
      "PC_SOURCE_MAP_VALIDATE_OUTCOMES",

    matches,
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

export function runTraceProvenancePreflight() {
  const context =
    loadTraceProvenanceContext();

  console.log(
    "TRACE_BUILD_ID:",
    context.buildId,
  );

  console.log(
    "TRACE_SOURCE_ID:",
    context.artifactSourceId,
  );

  console.log(
    "TRACE_SOURCE_PATH:",
    context.mappedPath,
  );

  console.log(
    "VALIDATE_OUTCOMES_RANGE:",
    `${context.functionRange.start}:`
    + `${context.functionRange.endExclusive}`,
  );

  assert(
    context.buildId
      === "3d5f892cd6000cf9",
    "unexpected frozen build id",
  );

  assert(
    context.artifactSourceId
      === 58,
    "unexpected frozen source id",
  );

  assert(
    context.functionRange.start
      === 38672,
    "unexpected _validateOutcomes start",
  );

  assert(
    context.functionRange
      .endExclusive
      === 41277,
    "unexpected _validateOutcomes end",
  );

  console.log(
    "TRACE_FROZEN_COMPILER_MAPPING: PASS",
  );

  const inside =
    context.pcSourceTable
      .find(
        (entry) =>
          sourceEntryInValidateOutcomes(
            entry,
            context,
          ),
      );

  assert(
    inside !== undefined,
    "no runtime PC maps into _validateOutcomes",
  );

  const outside =
    context.pcSourceTable
      .find(
        (entry) =>
          entry.fileId
            === context.artifactSourceId
          && Number.isInteger(
            entry.start,
          )
          && !sourceEntryInValidateOutcomes(
            entry,
            context,
          ),
      );

  assert(
    outside !== undefined,
    "no same-source outside-function PC found",
  );

  console.log(
    "TRACE_PC_INSIDE_VALIDATE_OUTCOMES:",
    inside.pc,
  );

  console.log(
    "TRACE_PC_OUTSIDE_VALIDATE_OUTCOMES:",
    outside.pc,
  );

  const positive =
    resolveTraceStage({
      context,

      structLogs: [
        {
          pc:
            outside.pc,

          depth:
            INNER_D_DEPTH,

          op:
            "JUMPDEST",
        },
        {
          pc:
            inside.pc,

          depth:
            INNER_D_DEPTH,

          op:
            "JUMPDEST",
        },
      ],
    });

  assert(
    positive.traceStage
      === "_validateOutcomes",
    "positive trace attribution failed",
  );

  assert(
    positive.matches.length
      >= 1,
    "positive trace produced no provenance match",
  );

  console.log(
    "TRACE_POSITIVE_POSTCONDITION_ATTRIBUTION: PASS",
  );

  const outsideOnly =
    resolveTraceStage({
      context,

      structLogs: [
        {
          pc:
            outside.pc,

          depth:
            INNER_D_DEPTH,

          op:
            "JUMPDEST",
        },
      ],
    });

  assert(
    outsideOnly.traceStage
      === null,
    "outside-function trace produced false positive",
  );

  console.log(
    "TRACE_NEGATIVE_OUTSIDE_FUNCTION: PASS",
  );

  const wrongDepth =
    resolveTraceStage({
      context,

      structLogs: [
        {
          pc:
            inside.pc,

          depth:
            INNER_D_DEPTH + 1,

          op:
            "JUMPDEST",
        },
      ],
    });

  assert(
    wrongDepth.traceStage
      === null,
    "wrong-depth trace produced false positive",
  );

  console.log(
    "TRACE_NEGATIVE_WRONG_DEPTH: PASS",
  );

  const unknownPc =
    resolveTraceStage({
      context,

      structLogs: [
        {
          pc:
            999999999,

          depth:
            INNER_D_DEPTH,

          op:
            "INVALID",
        },
      ],
    });

  assert(
    unknownPc.traceStage
      === null,
    "unknown PC produced false positive",
  );

  console.log(
    "TRACE_NEGATIVE_UNKNOWN_PC: PASS",
  );

  console.log(
    "PILOT_TRANSACTIONS_EXECUTED: 0",
  );

  console.log(
    "PILOT_OBSERVATIONS_CREATED: 0",
  );

  console.log(
    "TRACE_PROVENANCE_PREFLIGHT_PASS",
  );
}
