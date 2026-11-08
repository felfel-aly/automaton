/**
 * Perform syntax-only checks without importing modules from the caller's cwd,
 * PYTHONPATH, sitecustomize or user site packages.
 */
import { spawnSync } from "node:child_process";

export function isValidPythonSyntax(snippet: string): boolean {
  if (typeof snippet !== "string" || snippet.length > 10_000) return false;
  const result = spawnSync(
    "/usr/bin/python3",
    ["-I", "-S", "-B", "-c", "import ast,sys; ast.parse(sys.stdin.read())"],
    {
      input: snippet,
      encoding: "utf8",
      timeout: 2500,
      maxBuffer: 8192,
      cwd: "/usr",
      env: { PATH: "/usr/bin:/bin" },
    },
  );
  return !result.error && result.status === 0;
}
