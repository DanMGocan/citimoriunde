import { readFile, writeFile, chmod, mkdir, lstat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
const target = resolve(".env");
let exists = true;
try { if (!(await lstat(target)).isFile()) throw new Error("Existing .env is not a regular file; preserved without changes."); await readFile(target); } catch (error) { if (error.code === "ENOENT") exists = false; else throw error; }
if (!exists) {
  const password = randomBytes(24).toString("hex");
  const template = await readFile(resolve(".env.example"), "utf8");
  await writeFile(target, template
    .replace("AUTH_SECRET=generate-a-random-secret-at-least-32-characters", `AUTH_SECRET=${randomBytes(48).toString("base64url")}`)
    .replace("POSTGRES_PASSWORD=generate-a-random-local-password", `POSTGRES_PASSWORD=${password}`)
    .replace("local-password-placeholder@", `${password}@`), { mode: 0o600, flag: "wx" });
  console.log("Created local .env with random local credentials. Public registration and integrations remain disabled.");
} else console.log("Existing .env preserved; no values were changed.");
await chmod(target, 0o600);
await mkdir(resolve("storage/images"), { recursive: true, mode: 0o700 });
await mkdir(resolve("backups"), { recursive: true, mode: 0o700 });
