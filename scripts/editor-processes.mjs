// Local macOS/Linux dev-server ownership checks. No PID file grants permission
// to signal a process. Only these exact launches in this checkout are managed.
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const editor = resolve(root, "packages/editor");
const apiArgs = ["server", "serve", "--port", "63620", "--static", "packages/editor/dist"];
const viteArgs = ["--host", "127.0.0.1", "--port", "5173", "--strictPort"];
const apiFlags = ` ${apiArgs.join(" ")}`;
const viteFlags = ` ${viteArgs.join(" ")}`;
const launcherFlags = ` --filter editor exec vite${viteFlags}`;
const commandOptions = { encoding: "utf8", env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 };

function command(program, args) {
  return execFileSync(program, args, commandOptions).trim();
}

function roleFor(line) {
  const args = line.match(/^(?:\/.*?)?node (.+)$/)?.[1];
  if (!args) return undefined;
  if (args.endsWith(apiFlags) && resolve(root, args.slice(0, -apiFlags.length)) === resolve(root, "dist/cli.js")) {
    return { name: "api", cwd: root };
  }
  if (args.endsWith(viteFlags) && resolve(editor, args.slice(0, -viteFlags.length)) === resolve(editor, "node_modules/vite/bin/vite.js")) {
    return { name: "vite", cwd: editor };
  }
  if (args.endsWith(launcherFlags) && ["pnpm", "pnpm.js", "pnpm.cjs", "pnpm.mjs"].includes(basename(args.slice(0, -launcherFlags.length)))) {
    return { name: "vite launcher", cwd: root };
  }
  return undefined;
}

function parseProcess(line) {
  const match = line.match(/^\s*(\d+)\s+(.{24})\s+(.+)$/);
  if (!match) return undefined;
  const role = roleFor(match[3]);
  return role && { pid: Number(match[1]), started: match[2], command: match[3], ...role };
}

function hasExpectedOwner(target) {
  try {
    // Checking the executable also excludes shells whose arguments quote a
    // matching command. lsof is available on macOS and required on Linux.
    if (basename(command("ps", ["-p", String(target.pid), "-o", "comm="])) !== "node") return false;
    const cwd = command("lsof", ["-a", "-p", String(target.pid), "-d", "cwd", "-Fn"])
      .split("\n").find((line) => line.startsWith("n"))?.slice(1);
    return cwd === target.cwd;
  } catch {
    return false; // A process that exits during inspection is no longer owned.
  }
}

function ownedProcesses() {
  return command("ps", ["-axo", "pid=,lstart=,command="]).split("\n")
    .map(parseProcess).filter((target) => target && target.pid > 1 && hasExpectedOwner(target));
}

function stillMatches(target) {
  try {
    if (!hasExpectedOwner(target)) return false;
    // Read the identity last, immediately before any signal, so a reused PID
    // or a process that execs another command is excluded after cwd inspection.
    const current = parseProcess(command("ps", ["-p", String(target.pid), "-o", "pid=,lstart=,command="]));
    return current?.started === target.started && current.command === target.command;
  } catch {
    return false;
  }
}

function signal(target, signalName) {
  if (!stillMatches(target)) return;
  try {
    process.kill(target.pid, signalName);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function waitForExit(targets, milliseconds) {
  const deadline = Date.now() + milliseconds;
  let remaining = targets.filter(stillMatches);
  while (remaining.length && Date.now() < deadline) {
    await setTimeout(100);
    remaining = remaining.filter(stillMatches);
  }
  return remaining;
}

async function launch(name, executable, args) {
  const log = openSync(resolve(root, `.dev/${name}.log`), "w");
  try {
    // A separate process group survives terminal/exec-wrapper cleanup. Both
    // output streams use the log file, so no pipe keeps this launcher alive.
    const child = spawn(executable, args, { cwd: root, detached: true, stdio: ["ignore", log, log] });
    await once(child, "spawn");
    child.unref();
    writeFileSync(resolve(root, `.dev/${name}.pid`), `${child.pid}\n`);
  } finally {
    closeSync(log);
  }
}

const action = process.argv[2];
if (!["launch", "stop", "status"].includes(action)) throw new Error("Use launch, stop, or status.");
// Fail clearly if inspection is unavailable instead of pretending a server is
// stopped and launching another copy. Per-process races are handled above.
command("lsof", ["-v"]);
const targets = ownedProcesses();
if (action === "launch") {
  if (targets.length) throw new Error("Editor processes are already running; use scripts/editor-dev.sh restart.");
  await launch("api", process.execPath, ["dist/cli.js", ...apiArgs]);
  await launch("vite", "pnpm", ["--filter", "editor", "exec", "vite", ...viteArgs]);
} else if (action === "status") {
  for (const name of ["api", "vite"]) {
    const pids = targets.filter((target) => target.name === name).map((target) => target.pid);
    console.log(`${name}: ${pids.length ? `running (pid ${pids.join(", ")})` : "stopped"}`);
  }
} else {
  // Vite and both pnpm wrappers are separate targets. Signal the actual
  // servers first; an orphaned Vite child is also found without a PID file.
  targets.sort((a, b) => Number(a.name === "vite launcher") - Number(b.name === "vite launcher"));
  for (const target of targets) signal(target, "SIGTERM");
  const remaining = await waitForExit(targets, 5_000);
  for (const target of remaining) signal(target, "SIGKILL");
  const survivors = await waitForExit(remaining, 1_000);
  if (survivors.length) throw new Error(`Could not stop editor processes: ${survivors.map((target) => target.pid).join(", ")}`);
}
