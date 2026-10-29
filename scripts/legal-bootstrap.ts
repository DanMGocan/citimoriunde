import { constants } from "node:fs";
import { mkdir, lstat, open, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { config } from "../src/lib/config";
import { POLICY_DRAFTS } from "../src/domain/policies";
import { initialPolicySlugs, parseReviewedPolicy } from "../src/lib/legal-publication";

async function run() {
  const command=process.argv[2],argument=process.argv[3];
  if (!argument || !["export","publish"].includes(command)) throw new Error("Usage: npm run legal:export -- /absolute/review-directory OR npm run legal:bootstrap -- /absolute/review-directory --confirm-reviewed");
  const directory=resolve(argument);
  if (command === "export") {
    // Require a new directory; no reviewed text or unrelated permissions are overwritten.
    try { await lstat(directory); throw new Error("Review directory already exists. Choose a new directory; existing work is preserved."); }
    catch(error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await mkdir(directory,{mode:0o700});
    for(const draft of POLICY_DRAFTS) await writeFile(join(directory,`${draft.slug}.md`),`# ${draft.title}\n\n${draft.body}\n`,{encoding:"utf8",mode:0o600,flag:"wx"});
    console.log("Eight draft policy files exported. They remain drafts; actual operator/legal review is required before publication.");return;
  }
  if (!process.argv.includes("--confirm-reviewed") || !config.legalReviewed || !config.operatorName || !config.operatorAddress || !config.operatorCountry || !config.supportEmail) throw new Error("Initial publication requires actual operator/contact configuration, LEGAL_REVIEWED=true after real review, and --confirm-reviewed. No policies were published.");
  if(config.registrationEnabled) throw new Error("Keep public registration disabled throughout initial legal/admin setup.");
  const directoryInfo=await lstat(directory);if(!directoryInfo.isDirectory()||directoryInfo.isSymbolicLink()) throw new Error("Use a regular local review directory.");
  const policies: (ReturnType<typeof parseReviewedPolicy> & { sha256: string })[]=[];
  for(const slug of initialPolicySlugs) {
    const file=await open(join(directory,`${slug}.md`),constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const info=await file.stat();if(!info.isFile()||info.size>65536)throw new Error("Invalid review file; publication refused.");
      const content=await file.readFile({encoding:"utf8"});
      policies.push({...parseReviewedPolicy(slug,content),sha256:createHash("sha256").update(content).digest("hex")});
    } finally {await file.close();}
  }
  const { pool,transaction }=await import("../src/lib/db");
  try {
    await transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(73142620)");
      const existing=await client.query("SELECT 1 FROM admin_bootstrap UNION ALL SELECT 1 FROM members WHERE role='ADMIN' UNION ALL SELECT 1 FROM audit_log WHERE action='INITIAL_LEGAL_PUBLICATION' LIMIT 1");
      if(existing.rowCount)throw new Error("Initial setup is already completed. Use audited admin legal version publication for subsequent changes.");
      const published=await client.query("SELECT 1 FROM legal_documents WHERE slug=ANY($1) AND NOT is_draft AND published_at IS NOT NULL LIMIT 1",[[...initialPolicySlugs]]);
      if(published.rowCount)throw new Error("Published policies already exist; initial offline publication refuses to overwrite prior decisions.");
      const records=[];
      for(const policy of policies) {
        const result=await client.query("INSERT INTO legal_documents(slug,version,title,body,is_draft,published_at) SELECT $1,coalesce(max(version),0)+1,$2,$3,false,now() FROM legal_documents WHERE slug=$1 RETURNING id,version",[policy.slug,policy.title,policy.body]);
        records.push({slug:policy.slug,id:result.rows[0].id,version:result.rows[0].version,sha256:policy.sha256});
      }
      await client.query("INSERT INTO audit_log(actor_id,action,target_type,target_id,reason,data) VALUES(NULL,'INITIAL_LEGAL_PUBLICATION','legal_document',NULL,$1,$2)",["Initial protected local operator command with review attestation. This record does not assert independent legal approval.",JSON.stringify({documents:records})]);
    });
    console.log("Eight reviewed policy versions published transactionally and audited. Registration remains disabled; complete verified Google/TOTP admin onboarding next.");
  } finally {await pool.end();}
}
run().catch(()=>{console.error("Initial legal operation failed. Check arguments, reviewed files, real operator configuration and existing publication status; no legal approval or success is claimed.");process.exitCode=1;});
