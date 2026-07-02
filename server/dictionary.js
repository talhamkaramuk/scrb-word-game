import fs from "node:fs";
import { isPlayableLetter, normalizeLetter } from "../src/shared/game-core.js";

export const DICTIONARY_FLAGS = Object.freeze(["allowed", "proper_noun", "abbreviation", "archaic", "slang"]);

export const DEFAULT_DICTIONARY_POLICY = Object.freeze({
  allowProperNouns: false,
  allowAbbreviations: false,
  allowArchaic: false,
  allowSlang: false,
  minWordLength: 2
});

const FLAG_SET = new Set(DICTIONARY_FLAGS);
const DEFAULT_SOURCE = "local-user";
const DEFAULT_LICENSE = "user-provided";
const DIACRITIC_FOLD = new Map([
  ["â", "a"],
  ["Â", "A"],
  ["î", "i"],
  ["Î", "İ"],
  ["û", "u"],
  ["Û", "U"],
  ["ô", "o"],
  ["Ô", "O"],
  ["ê", "e"],
  ["Ê", "E"]
]);

export function loadDictionaryFile(filePath, options = {}) {
  try {
    return loadDictionaryText(fs.readFileSync(filePath, "utf8"), options);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Dictionary could not be loaded: ${error.message}`);
    }
    return emptyDictionary(options.policy);
  }
}

export function loadDictionaryText(contents, options = {}) {
  const policy = normalizePolicy(options.policy);
  const words = new Set();
  const warnings = [];
  const stats = {
    lines: 0,
    entries: 0,
    accepted: 0,
    duplicate: 0,
    rejected: 0,
    invalid: 0,
    properNoun: 0,
    abbreviation: 0,
    archaic: 0,
    slang: 0,
    tooShort: 0
  };

  for (const [index, rawLine] of String(contents || "").split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const line = stripComment(rawLine).trim();
    if (!line || isHeaderLine(line)) {
      continue;
    }

    stats.lines += 1;
    const parsed = parseDictionaryLine(line, lineNumber);
    if (!parsed.ok) {
      stats.invalid += 1;
      warnings.push(parsed.warning);
      continue;
    }

    stats.entries += 1;
    const entry = parsed.entry;
    countFlags(stats, entry.flags);
    const decision = dictionaryEntryDecision(entry, policy);
    if (!decision.allowed) {
      stats.rejected += 1;
      if (decision.reason === "tooShort") {
        stats.tooShort += 1;
      }
      continue;
    }

    if (words.has(entry.word)) {
      stats.duplicate += 1;
      continue;
    }

    words.add(entry.word);
    stats.accepted += 1;
  }

  return {
    words,
    policy,
    stats,
    warnings
  };
}

export function parseDictionaryLine(line, lineNumber = 1) {
  const columns = line.includes("\t") ? line.split("\t").map((column) => column.trim()) : [line.trim()];
  if (columns.length !== 1 && columns.length !== 5) {
    return {
      ok: false,
      warning: `Dictionary line ${lineNumber}: expected plain word or 5 TSV columns.`
    };
  }

  const word = normalizeDictionaryWord(columns[0]);
  if (!word) {
    return {
      ok: false,
      warning: `Dictionary line ${lineNumber}: invalid word characters.`
    };
  }

  const structured = columns.length === 5;
  const source = structured ? columns[1] || DEFAULT_SOURCE : DEFAULT_SOURCE;
  const license = structured ? columns[2] || DEFAULT_LICENSE : DEFAULT_LICENSE;
  const minLength = structured ? parseMinLength(columns[3], lineNumber) : DEFAULT_DICTIONARY_POLICY.minWordLength;
  if (!Number.isInteger(minLength)) {
    return {
      ok: false,
      warning: `Dictionary line ${lineNumber}: minLength must be an integer.`
    };
  }

  const flags = structured ? parseFlags(columns[4], lineNumber) : new Set(["allowed"]);
  if (!flags) {
    return {
      ok: false,
      warning: `Dictionary line ${lineNumber}: unknown dictionary flag.`
    };
  }

  return {
    ok: true,
    entry: {
      word,
      source,
      license,
      minLength,
      flags
    }
  };
}

export function dictionaryEntryDecision(entry, policy = DEFAULT_DICTIONARY_POLICY) {
  const normalizedPolicy = normalizePolicy(policy);
  if (entry.word.length < Math.max(normalizedPolicy.minWordLength, entry.minLength)) {
    return { allowed: false, reason: "tooShort" };
  }
  if (entry.flags.has("proper_noun") && !normalizedPolicy.allowProperNouns) {
    return { allowed: false, reason: "properNoun" };
  }
  if (entry.flags.has("abbreviation") && !normalizedPolicy.allowAbbreviations) {
    return { allowed: false, reason: "abbreviation" };
  }
  if (entry.flags.has("archaic") && !entry.flags.has("allowed") && !normalizedPolicy.allowArchaic) {
    return { allowed: false, reason: "archaic" };
  }
  if (entry.flags.has("slang") && !entry.flags.has("allowed") && !normalizedPolicy.allowSlang) {
    return { allowed: false, reason: "slang" };
  }
  return { allowed: true, reason: null };
}

export function normalizeDictionaryWord(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const letters = [];
  for (const character of Array.from(raw)) {
    const normalized = normalizeLetter(DIACRITIC_FOLD.get(character) || character);
    if (!isPlayableLetter(normalized)) {
      return null;
    }
    letters.push(normalized);
  }
  return letters.join("");
}

function emptyDictionary(policy) {
  return {
    words: new Set(),
    policy: normalizePolicy(policy),
    stats: {
      lines: 0,
      entries: 0,
      accepted: 0,
      duplicate: 0,
      rejected: 0,
      invalid: 0,
      properNoun: 0,
      abbreviation: 0,
      archaic: 0,
      slang: 0,
      tooShort: 0
    },
    warnings: []
  };
}

function normalizePolicy(policy = {}) {
  return {
    ...DEFAULT_DICTIONARY_POLICY,
    ...policy,
    minWordLength: Number.isInteger(policy.minWordLength)
      ? policy.minWordLength
      : DEFAULT_DICTIONARY_POLICY.minWordLength
  };
}

function stripComment(line) {
  return String(line ?? "").replace(/#.*/, "");
}

function isHeaderLine(line) {
  return /^word\tsource\tlicense\tminlength\tflags$/i.test(line.trim());
}

function parseMinLength(value) {
  const minLength = Number(value || DEFAULT_DICTIONARY_POLICY.minWordLength);
  if (!Number.isInteger(minLength) || minLength < DEFAULT_DICTIONARY_POLICY.minWordLength) {
    return null;
  }
  return minLength;
}

function parseFlags(value) {
  const flags = new Set();
  for (const rawFlag of String(value || "")
    .split(/[|,\s]+/)
    .map((flag) => flag.trim().toLowerCase())
    .filter(Boolean)) {
    if (!FLAG_SET.has(rawFlag)) {
      return null;
    }
    flags.add(rawFlag);
  }
  return flags;
}

function countFlags(stats, flags) {
  if (flags.has("proper_noun")) {
    stats.properNoun += 1;
  }
  if (flags.has("abbreviation")) {
    stats.abbreviation += 1;
  }
  if (flags.has("archaic")) {
    stats.archaic += 1;
  }
  if (flags.has("slang")) {
    stats.slang += 1;
  }
}
