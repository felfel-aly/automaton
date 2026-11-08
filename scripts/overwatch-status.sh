#!/usr/bin/env bash
set -euo pipefail
repo="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec python3 - "$repo" <<'PY'
import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys

root = pathlib.Path(sys.argv[1]).resolve()

def git(*args):
    result = subprocess.run(
        ["git", "-C", str(root), "--no-optional-locks", *args],
        capture_output=True,
        text=True,
        timeout=12,
        check=True,
    )
    return result.stdout.strip()

status = git("status", "--porcelain=v1", "--untracked-files=normal").splitlines()
data = {
    "schema": "conway-overwatch-readonly-v1",
    "checked_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "branch": git("branch", "--show-current"),
    "commit": git("rev-parse", "HEAD"),
    "working_tree_clean": len(status) == 0,
    "changed_paths_count": len(status),
    "node_available": shutil.which("node") is not None,
    "pnpm_available": shutil.which("pnpm") is not None,
    "codex_available": shutil.which("codex") is not None,
    "ci_workflow_present": (root / ".github" / "workflows" / "ci.yml").is_file(),
    "local_shell_execution_enabled": os.environ.get("CONWAY_LOCAL_EXEC_ENABLED") == "1",
    "host_mutation_enabled": os.environ.get("CONWAY_HOST_MUTATION_ENABLED") == "1",
    "runtime_health": "not_checked",
}
print(json.dumps(data, sort_keys=True, separators=(",", ":")))
PY
