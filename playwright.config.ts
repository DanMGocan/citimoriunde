import { defineConfig } from "@playwright/test";
import {config} from './src/lib/config';
if(config.environment!=='test'||!/^[a-z0-9_]+_test$/.test(new URL(config.databaseUrl).pathname.slice(1))||!config.storagePath.startsWith('/tmp/community-tests-'))throw new Error('Browser tests require the isolated test-db harness; no server or browser started.');
export default defineConfig({
  testDir:"./tests/browser",fullyParallel:false,workers:1,retries:0,
  timeout:30000,expect:{timeout:8000},reporter:[["list"],["html",{outputFolder:"test-artifacts/browser-report",open:"never"}]],
  use:{baseURL:config.appUrl,trace:"retain-on-failure",screenshot:"only-on-failure",video:"off",actionTimeout:10000},
  webServer:{command:"npm run start",url:`${config.appUrl}/api/health`,reuseExistingServer:false,timeout:60000},
  outputDir:"test-artifacts/browser",projects:[{name:"chromium",use:{browserName:"chromium"}}]
});
