import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {access,cp} from 'node:fs/promises';
import { config,nativeWebEnvironment } from "../src/lib/config";
const standalone=resolve('.next/standalone');
try{await access(resolve(standalone,'server.js'));await cp(resolve('.next/static'),resolve(standalone,'.next/static'),{recursive:true});await cp(resolve('public'),resolve(standalone,'public'),{recursive:true});}
catch{console.error('Production preview requires a successful standalone build and public assets. No server started.');process.exit(1);}
const child = spawn(process.execPath, [
  `--max-old-space-size=${Math.floor(config.webMemoryMb * 0.75)}`,
  resolve(standalone,'server.js'),
], { stdio: "inherit",env:nativeWebEnvironment() });
for (const signal of ["SIGINT","SIGTERM"] as const) process.once(signal, () => child.kill(signal));
child.once("error", () => { console.error("Production preview could not start; install dependencies and build first. Details redacted."); process.exitCode = 1; });
child.once("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGTERM" || signal === "SIGINT" ? 0 : 1); });
