// Setup tasks run inside the container (workspace-setup.sh):
//
//   node server/cli.ts has-owner             exit 0 when a login exists
//   node server/cli.ts create-owner [EMAIL]  asks for an email and a password
//   node server/cli.ts reset-password EMAIL  asks for a new password
import { stdin, stdout } from "node:process";
import readline from "node:readline";
import { createOwner, hasOwner } from "./auth.ts";
import { db } from "./db.ts";

// One reader for the whole run (several would race for piped input); typing is
// hidden only on a real terminal.
const tty = !!stdin.isTTY;
const rl = readline.createInterface({ input: stdin, output: stdout, terminal: tty });
const lines: string[] = [];
const waiting: ((s: string) => void)[] = [];
let muted = false;
if (tty) {
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  const write = out._writeToOutput.bind(rl);
  out._writeToOutput = (s: string) => { if (!muted || /^\s*\S.*: $/.test(s)) write(s); };
}
rl.on("line", (l) => (waiting.length ? waiting.shift()!(l.trim()) : lines.push(l.trim())));

function ask(question: string, hidden = false): Promise<string> {
  stdout.write(question);
  muted = hidden && tty;
  return new Promise((resolve) => {
    const done = (s: string) => { if (muted) stdout.write("\n"); muted = false; resolve(s); };
    if (lines.length) done(lines.shift()!);
    else waiting.push(done);
  });
}

async function password(): Promise<string> {
  for (let tries = 0; tries < 5; tries++) {
    const a = await ask("  password (10+ characters): ", true);
    if (a.length < 10) { console.log("  too short"); continue; }
    const b = await ask("  again: ", true);
    if (a === b) return a;
    console.log("  they differ, once more");
  }
  throw new Error("no password set");
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === "has-owner") {
    process.exitCode = hasOwner() ? 0 : 1;
  } else if (cmd === "create-owner") {
    const email = arg || await ask("  your email: ");
    createOwner(email, await password());
    console.log(`  ${email} can now sign in to Xooteq Mail.`);
  } else if (cmd === "reset-password" && arg) {
    if (!db.prepare("SELECT id FROM owners WHERE email = ?").get(arg.toLowerCase())) throw new Error(`no login for ${arg}`);
    createOwner(arg, await password());
    console.log(`  new password set for ${arg}`);
  } else {
    console.log("usage: cli.ts has-owner | create-owner [EMAIL] | reset-password EMAIL");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(`  ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
