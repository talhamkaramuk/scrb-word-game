import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDictionaryFile } from "../server/dictionary.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dictionary = loadDictionaryFile(path.join(root, "data", "dictionary.tr.txt"));

if (dictionary.words.size === 0) {
  console.error("Dictionary check failed: no playable words were loaded.");
  process.exit(1);
}

if (dictionary.warnings.length > 0) {
  console.error(`Dictionary check failed: ${dictionary.warnings.length} warning(s).`);
  for (const warning of dictionary.warnings.slice(0, 10)) {
    console.error(`- ${warning}`);
  }
  process.exit(1);
}

console.log(
  `Dictionary check passed: ${dictionary.words.size} playable words, ${dictionary.stats.duplicate} duplicates ignored.`
);
