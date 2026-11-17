#!/usr/bin/env python3
"""Verify that Overwatch's read-only Git status cannot invoke fsmonitor hooks."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class ReadOnlyStatusTests(unittest.TestCase):
    def test_status_does_not_execute_configured_fsmonitor(self):
        source = Path(__file__).with_name("overwatch-status.sh")
        with tempfile.TemporaryDirectory(prefix="conway-status-hook-") as name:
            root = Path(name) / "repo"
            scripts = root / "scripts"
            scripts.mkdir(parents=True)
            shutil.copyfile(source, scripts / source.name)

            def git(*arguments):
                proc = subprocess.run(
                    ["git", "-C", str(root), *arguments],
                    capture_output=True, text=True, timeout=15, check=False,
                )
                self.assertEqual(proc.returncode, 0, proc.stderr)
                return proc.stdout

            git("init", "-q")
            git("config", "user.name", "Status Test")
            git("config", "user.email", "status-test@example.invalid")
            (root / "README.md").write_text("test fixture\n", encoding="utf-8")
            git("add", "README.md", "scripts/overwatch-status.sh")
            git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture")
            marker = Path(name) / "external-hook-executed"
            hook = Path(name) / "fsmonitor.sh"
            hook.write_text(
                "#!/bin/sh\nprintf 'invoked' > " + str(marker) + "\n"
                "printf '/README.md\\n'\n",
                encoding="utf-8",
            )
            hook.chmod(0o700)
            git("config", "core.fsmonitor", str(hook))

            # Prove the hostile fixture really would be called by baseline Git.
            git("--no-optional-locks", "status", "--porcelain=v1")
            self.assertTrue(marker.exists(), "Fixture did not exercise the Git hook")
            marker.unlink()

            env = os.environ.copy()
            env["CONWAY_LOCAL_EXEC_ENABLED"] = "0"
            env["CONWAY_HOST_MUTATION_ENABLED"] = "0"
            proc = subprocess.run(
                ["bash", str(scripts / source.name)],
                capture_output=True, text=True, timeout=30, check=False, env=env,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            body = json.loads(proc.stdout)
            self.assertEqual(body["schema"], "conway-overwatch-readonly-v1")
            self.assertFalse(marker.exists(), "Status command executed fsmonitor hook")


if __name__ == "__main__":
    unittest.main()
