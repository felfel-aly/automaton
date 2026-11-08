/**
 * Security boundary for explicitly approved local Conway mode.
 * Remote sandbox calls never use these helpers.
 *
 * Local shell execution requires Linux Bubblewrap and an approved workspace.
 * A missing sandbox or missing approval fails closed, never to a host shell.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ExecResult } from "../types.js";

const BWRAP = "/usr/bin/bwrap";
const MAX_EXEC_TIMEOUT_MS = 60_000;
const MAX_EXEC_BUFFER = 1_048_576;
const SENSITIVE_DIRS = new Set([".ssh", ".gnupg", ".aws", ".automaton"]);
const SENSITIVE_FILES = new Set(["wallet.json", "automaton.json", "state.db", "config.json"]);

function requireLinux(): void {
  if (process.platform !== "linux") {
    throw new Error("Secure Conway local mode requires Linux; host filesystem and shell access refused.");
  }
}

function inspectApprovedLocalRoot(configuredRoot?: string): { root: string; dev: number; ino: number } {
  requireLinux();
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new Error("Conway local workspace root is required: configure an absolute CONWAY_LOCAL_WORKSPACE_ROOT.");
  }
  const lexical = path.resolve(configuredRoot);
  const home = path.resolve(process.env.HOME || "/root");
  if (lexical === "/" || lexical === home || lexical === path.resolve(process.cwd()) ||
      lexical.split(path.sep).some((part) => SENSITIVE_DIRS.has(part))) {
    throw new Error("Conway local workspace root must be a dedicated directory, not home, source checkout, or protected storage.");
  }
  let physical: string;
  try {
    physical = fs.realpathSync(lexical);
  } catch {
    throw new Error("Conway local workspace root does not exist or is inaccessible.");
  }
  if (physical !== lexical) {
    throw new Error("Conway local workspace root must not contain symlinked path components.");
  }
  const stat = fs.lstatSync(physical);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error("Conway local workspace root must be an existing, owner-only (0700), non-group/world-writable directory.");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new Error("Conway local workspace root must be owned by the current user.");
  }
  return { root: physical, dev: stat.dev, ino: stat.ino };
}

export function requireApprovedLocalRoot(configuredRoot?: string): string {
  return inspectApprovedLocalRoot(configuredRoot).root;
}

/**
 * Open the actual workspace directory inode through no-follow lookups.
 * Checking a pathname without retaining a descriptor is subject to a
 * replacement race. Each pathname component is opened relative to the
 * previously opened directory, so a concurrent symlink swap fails closed.
 */
function openApprovedLocalRootFd(root: string, expected: { dev: number; ino: number }): number {
  const flags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY |
    fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  let fd = fs.openSync("/", flags);
  try {
    for (const segment of root.split(path.sep).filter(Boolean)) {
      const next = fs.openSync("/proc/self/fd/" + fd + "/" + segment, flags);
      fs.closeSync(fd);
      fd = next;
    }
    const stat = fs.fstatSync(fd);
    const current = fs.lstatSync(root);
    if (!stat.isDirectory() || (stat.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
        stat.dev !== current.dev || stat.ino !== current.ino ||
        stat.dev !== expected.dev || stat.ino !== expected.ino ||
        current.isSymbolicLink()) {
      throw new Error("Blocked: approved workspace directory changed during validation.");
    }
    return fd;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

/**
 * Check objects before exposing the full workspace as a writable mount.
 * Helper-level hardlink checks alone cannot protect files accessed by shell.
 */
function assertSafeSandboxTree(rootFd: number): void {
  const rootStat = fs.fstatSync(rootFd);
  let entries = 0;
  const base = "/proc/self/fd/" + rootFd;
  const check = (relative: string, depth: number): void => {
    if (depth > 24) throw new Error("Blocked: local workspace exceeds sandbox depth limit.");
    for (const name of fs.readdirSync(relative ? base + "/" + relative : base)) {
      if (++entries > 5000) throw new Error("Blocked: local workspace exceeds sandbox entry limit.");
      if (SENSITIVE_DIRS.has(name) || SENSITIVE_FILES.has(name) ||
          name === ".env" || name.startsWith(".env.") ||
          name.startsWith("private-key") || name.endsWith(".pem") || name.endsWith(".key")) {
        throw new Error("Blocked: local workspace contains a protected file.");
      }
      const child = relative ? relative + "/" + name : name;
      const stat = fs.lstatSync(base + "/" + child);
      if (stat.dev !== rootStat.dev ||
          (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
          (stat.mode & 0o6000) !== 0) {
        throw new Error("Blocked: local workspace contains an unapproved object.");
      }
      if (stat.isDirectory()) {
        if ((stat.mode & 0o022) !== 0) {
          throw new Error("Blocked: local workspace contains an unsafe directory.");
        }
        check(child, depth + 1);
      } else if (!stat.isFile() || stat.nlink !== 1) {
        throw new Error("Blocked: local workspace contains a symlink, hardlink, or non-regular object.");
      }
    }
  };
  check("", 0);
}

function requireConfinedPath(root: string, input: string): string {
  if (!input || input.includes("\0") || input.startsWith("~")) {
    throw new Error("Blocked: invalid or home-expanded local workspace path.");
  }
  if (input.split(path.sep).includes("..")) {
    throw new Error("Blocked: local workspace path traversal.");
  }
  const resolved = path.resolve(root, input);
  const relative = path.relative(root, resolved);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Blocked: local file path outside the approved workspace.");
  }
  const parts = relative.split(path.sep);
  const name = parts[parts.length - 1];
  if (parts.some((part) => SENSITIVE_DIRS.has(part)) ||
      SENSITIVE_FILES.has(name) || name === ".env" || name.startsWith(".env.") ||
      name.startsWith("private-key") || name.endsWith(".pem") || name.endsWith(".key")) {
    throw new Error("Blocked: local credential or protected file access.");
  }
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error("Blocked: local workspace symlink path.");
    }
    if (i < parts.length - 1 && !stat.isDirectory()) {
      throw new Error("Blocked: local workspace path is not a directory.");
    }
  }
  return resolved;
}

// Anchor every parent lookup to an open directory descriptor. This prevents a
// concurrently swapped symlink in the workspace from changing the effective
// parent directory after lexical validation.
function openConfinedParent(root: string, rootFd: number, target: string, createParents: boolean): {
  directoryFd: number;
  basename: string;
} {
  const relative = path.relative(root, target).split(path.sep);
  const basename = relative.pop();
  if (!basename || basename === "." || basename === "..") {
    throw new Error("Blocked: invalid local workspace filename.");
  }
  const directoryFlags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY |
    fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
  // Duplicate the already-validated directory descriptor, not its pathname.
  let directoryFd = fs.openSync("/proc/self/fd/" + rootFd,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NONBLOCK);
  const validateDirectory = (fd: number): void => {
    const stat = fs.fstatSync(fd);
    if (!stat.isDirectory() || (stat.mode & 0o022) !== 0 ||
        (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
      throw new Error("Blocked: local workspace directory must be owned and non-group/world-writable.");
    }
  };
  try {
    validateDirectory(directoryFd);
    for (const segment of relative) {
      const nextPath = "/proc/self/fd/" + directoryFd + "/" + segment;
      if (createParents) {
        try {
          fs.mkdirSync(nextPath, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      const nextFd = fs.openSync(nextPath, directoryFlags);
      try {
        validateDirectory(nextFd);
      } catch (error) {
        fs.closeSync(nextFd);
        throw error;
      }
      fs.closeSync(directoryFd);
      directoryFd = nextFd;
    }
    return { directoryFd, basename };
  } catch (error) {
    fs.closeSync(directoryFd);
    throw error;
  }
}

export function readLocalWorkspaceFile(configuredRoot: string | undefined, filePath: string): string {
  const approved = inspectApprovedLocalRoot(configuredRoot);
  const root = approved.root;
  const rootFd = openApprovedLocalRootFd(root, approved);
  try {
    const target = requireConfinedPath(root, filePath);
    const { directoryFd, basename } = openConfinedParent(root, rootFd, target, false);
    let fd: number | undefined;
    try {
      fd = fs.openSync("/proc/self/fd/" + directoryFd + "/" + basename,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 ||
          (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
        throw new Error("Blocked: local read target is not a singly linked, owned regular file.");
      }
      return fs.readFileSync(fd, "utf8");
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      fs.closeSync(directoryFd);
    }
  } finally {
    fs.closeSync(rootFd);
  }
}

export function writeLocalWorkspaceFile(
  configuredRoot: string | undefined,
  filePath: string,
  content: string,
): void {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 1_048_576) {
    throw new Error("Blocked: invalid or oversized local workspace content.");
  }
  const approved = inspectApprovedLocalRoot(configuredRoot);
  const root = approved.root;
  const rootFd = openApprovedLocalRootFd(root, approved);
  try {
    const target = requireConfinedPath(root, filePath);
    const { directoryFd, basename } = openConfinedParent(root, rootFd, target, true);
    let fd: number | undefined;
    try {
      // Local work mode creates fresh drafts only. O_EXCL prevents an
      // attacker or another writer from racing the prior exists check.
      fd = fs.openSync("/proc/self/fd/" + directoryFd + "/" + basename,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 ||
          (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
        throw new Error("Blocked: local write target is not a singly linked, owned regular file.");
      }
      fs.ftruncateSync(fd, 0);
      fs.writeFileSync(fd, content, "utf8");
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      fs.closeSync(directoryFd);
    }
  } finally {
    fs.closeSync(rootFd);
  }
}

export function execInLocalSandbox(
  command: string,
  configuredRoot: string | undefined,
  enabled: boolean,
  timeoutMs?: number,
): ExecResult {
  if (!enabled) {
    throw new Error("Conway local command execution is disabled; explicit CONWAY_LOCAL_EXEC_ENABLED=1 approval is required.");
  }
  const approved = inspectApprovedLocalRoot(configuredRoot);
  const root = approved.root;
  if (!fs.existsSync(BWRAP)) {
    throw new Error("Conway local execution refused: Bubblewrap is unavailable (no host-shell fallback).");
  }
  if (typeof command !== "string" || !command.trim() || command.length > 4096) {
    throw new Error("Conway local execution refused: invalid command.");
  }
  const timeout = Math.max(1, Math.min(timeoutMs ?? 30_000, MAX_EXEC_TIMEOUT_MS));
  const rootFd = openApprovedLocalRootFd(root, approved);
  let result: ReturnType<typeof spawnSync>;
  try {
    assertSafeSandboxTree(rootFd);
    // The third inherited descriptor carries the validated workspace inode.
    // No lexical pathname is resolved by Bubblewrap after this point.
    const args = [
      "--die-with-parent", "--new-session", "--unshare-all", "--unshare-user",
      "--disable-userns", "--cap-drop", "ALL", "--clearenv",
      "--ro-bind", "/usr", "/usr",
      "--symlink", "usr/bin", "/bin",
      "--symlink", "usr/lib", "/lib",
      "--symlink", "usr/lib64", "/lib64",
      "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp",
      "--bind", "/proc/self/fd/3", "/workspace", "--chdir", "/workspace",
      "--setenv", "PATH", "/usr/bin:/bin",
      "--setenv", "HOME", "/workspace",
      "--setenv", "TMPDIR", "/tmp",
      "--", "/bin/sh", "-c", command,
    ];
    result = spawnSync(BWRAP, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: MAX_EXEC_BUFFER,
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe", rootFd],
    });
  } finally {
    fs.closeSync(rootFd);
  }
  if (result.error) {
    throw new Error("Conway local sandbox execution failed: " + result.error.message);
  }
  return {
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    exitCode: result.status ?? 1,
  };
}
