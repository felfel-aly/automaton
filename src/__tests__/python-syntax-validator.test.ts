import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isValidPythonSyntax } from "../agent/python-syntax-validator.js";

describe.skipIf(process.platform !== "linux" || !fs.existsSync("/usr/bin/python3"))(
  "host Python syntax validation",
  () => {
    const priorPath = process.env.PYTHONPATH;
    afterEach(() => {
      if (priorPath === undefined) delete process.env.PYTHONPATH;
      else process.env.PYTHONPATH = priorPath;
    });

    it("parses valid code but rejects syntax errors", () => {
      expect(isValidPythonSyntax("print(123)\n")).toBe(true);
      expect(isValidPythonSyntax("def broken(\n")).toBe(false);
    });

    it("cannot import an attacker-controlled ast module from PYTHONPATH", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conway-python-safe-"));
      try {
        fs.writeFileSync(path.join(tmp, "ast.py"), "raise RuntimeError('unsafe module imported')\n");
        process.env.PYTHONPATH = tmp;
        expect(isValidPythonSyntax("x = 1\n")).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  },
);
