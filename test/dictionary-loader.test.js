import assert from "node:assert/strict";
import test from "node:test";
import {
  dictionaryEntryDecision,
  loadDictionaryText,
  normalizeDictionaryWord,
  parseDictionaryLine
} from "../server/dictionary.js";

test("plain dictionary lines remain backwards compatible playable words", () => {
  const dictionary = loadDictionaryText(`
# comment
el
kelime
el
`);

  assert.deepEqual([...dictionary.words].sort(), ["EL", "KELİME"]);
  assert.equal(dictionary.stats.entries, 3);
  assert.equal(dictionary.stats.accepted, 2);
  assert.equal(dictionary.stats.duplicate, 1);
  assert.equal(dictionary.warnings.length, 0);
});

test("structured dictionary entries expose source license min length and flags", () => {
  const parsed = parseDictionaryLine("kelime\tlocal\tuser-provided\t2\tallowed|slang", 1);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.entry.word, "KELİME");
  assert.equal(parsed.entry.source, "local");
  assert.equal(parsed.entry.license, "user-provided");
  assert.equal(parsed.entry.minLength, 2);
  assert.equal(parsed.entry.flags.has("allowed"), true);
  assert.equal(parsed.entry.flags.has("slang"), true);
});

test("dictionary policy rejects proper nouns and abbreviations by default", () => {
  const dictionary = loadDictionaryText(`
word	source	license	minLength	flags
ankara	local	user-provided	2	proper_noun
tbmm	local	user-provided	2	abbreviation
kelime	local	user-provided	2	allowed
`);

  assert.equal(dictionary.words.has("ANKARA"), false);
  assert.equal(dictionary.words.has("TBMM"), false);
  assert.equal(dictionary.words.has("KELİME"), true);
  assert.equal(dictionary.stats.rejected, 2);
  assert.equal(dictionary.stats.properNoun, 1);
  assert.equal(dictionary.stats.abbreviation, 1);
});

test("allowed flag can intentionally include slang or archaic entries", () => {
  const dictionary = loadDictionaryText(`
eski	local	user-provided	2	archaic
argo	local	user-provided	2	slang|allowed
`);

  assert.equal(dictionary.words.has("ESKİ"), false);
  assert.equal(dictionary.words.has("ARGO"), true);
});

test("invalid words and unknown flags are rejected with warnings", () => {
  const dictionary = loadDictionaryText(`
A-B
kelime	local	user-provided	2	unknown_flag
`);

  assert.equal(dictionary.words.size, 0);
  assert.equal(dictionary.stats.invalid, 2);
  assert.equal(dictionary.warnings.length, 2);
  assert.equal(normalizeDictionaryWord("kedi"), "KEDİ");
  assert.equal(normalizeDictionaryWord("âciz"), "ACİZ");
  assert.equal(normalizeDictionaryWord("a-b"), null);
});

test("entry decision honors minLength as a data contract", () => {
  const parsed = parseDictionaryLine("ab\tlocal\tuser-provided\t3\tallowed", 1);

  assert.equal(parsed.ok, true);
  assert.deepEqual(dictionaryEntryDecision(parsed.entry), { allowed: false, reason: "tooShort" });
});
