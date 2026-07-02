import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveFromRoot, resolveStaticPath } from "../server/static-paths.js";

const publicDir = path.resolve("public");
const sharedDir = path.resolve("src", "shared");

test("static path resolver rejects malformed percent-encoded paths", () => {
  const route = resolveStaticPath("/%E0%A4%A", { publicDir, sharedDir });

  assert.equal(route.status, 400);
  assert.equal(route.filePath, null);
});

test("static path resolver maps public and shared routes inside their roots", () => {
  const indexRoute = resolveStaticPath("/", { publicDir, sharedDir });
  const sharedRoute = resolveStaticPath("/shared/game-core.js", { publicDir, sharedDir });

  assert.equal(indexRoute.status, 200);
  assert.equal(indexRoute.filePath, path.join(publicDir, "index.html"));
  assert.equal(sharedRoute.status, 200);
  assert.equal(sharedRoute.filePath, path.join(sharedDir, "game-core.js"));
});

test("static path resolver rejects traversal outside static roots", () => {
  const publicTraversal = resolveStaticPath("/..%2Fserver%2Findex.js", { publicDir, sharedDir });
  const sharedTraversal = resolveStaticPath("/shared/..%2F..%2Fserver%2Findex.js", { publicDir, sharedDir });

  assert.equal(publicTraversal.status, 404);
  assert.equal(publicTraversal.filePath, null);
  assert.equal(sharedTraversal.status, 404);
  assert.equal(sharedTraversal.filePath, null);
});

test("resolveFromRoot uses path containment instead of string prefix", () => {
  const siblingRoot = path.resolve("public");
  const siblingPath = path.join("..", `${path.basename(siblingRoot)}-copy`, "index.html");

  assert.equal(resolveFromRoot(siblingRoot, siblingPath), null);
});
