import path from "node:path";

export function resolveStaticPath(urlPath, { publicDir, sharedDir }) {
  const decodedPath = safeDecodePath(urlPath);
  if (decodedPath === null) {
    return { status: 400, filePath: null };
  }

  if (decodedPath.startsWith("/shared/")) {
    return resolvedRoute(sharedDir, decodedPath.slice("/shared/".length));
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  return resolvedRoute(publicDir, relativePath);
}

function safeDecodePath(urlPath) {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return null;
  }
}

function resolvedRoute(root, relativePath) {
  const filePath = resolveFromRoot(root, relativePath);
  return filePath ? { status: 200, filePath } : { status: 404, filePath: null };
}

export function resolveFromRoot(root, relativePath) {
  const normalizedRoot = path.resolve(root);
  const filePath = path.resolve(normalizedRoot, relativePath);
  const relativeToRoot = path.relative(normalizedRoot, filePath);

  if (relativeToRoot === "" || (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot))) {
    return filePath;
  }

  return null;
}
