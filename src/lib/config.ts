import { loadEnvFile } from "node:process";
import { resolve } from "node:path";

// This is the only application module allowed to read process.env. It never logs values.
const source = process.env;
const configurationKeys = new Set<string>();
function string(key: string, fallback = "") { configurationKeys.add(key); return source[key]?.trim() || fallback; }
// Native systemd services receive a read-only copy through LoadCredential.
// The source .env stays protected in the workspace; containers use their environment.
const environmentFile = resolve(/* turbopackIgnore: true */ string("CONFIG_ENV_FILE", ".env"));
// Test subprocesses receive a complete isolated environment and never import real deployment credentials.
if (!(source.APP_ENV === "test" && source.DATABASE_URL)) {
  try { loadEnvFile(environmentFile); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Cannot read the protected .env configuration file."); }
}
function bool(key: string, fallback = false) {
  const value = string(key, String(fallback));
  if (value !== "true" && value !== "false") throw new Error(`Invalid boolean configuration: ${key}`);
  return value === "true";
}
function integer(key: string, fallback: number, min = 0, max = 1000000) {
  const value = Number(string(key, String(fallback)));
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid numeric configuration: ${key}`);
  return value;
}
function decimal(key:string,fallback:number,min=0.05,max=2){const value=Number(string(key,String(fallback)));if(!Number.isFinite(value)||value<min||value>max)throw new Error(`Invalid numeric configuration: ${key}`);return value;}
function choice<T extends string>(key: string, values: readonly T[], fallback: T): T {
  const value = string(key, fallback);
  if (!values.includes(value as T)) throw new Error(`Invalid configuration: ${key}`);
  return value as T;
}
function url(key: string, fallback: string) {
  const value = string(key, fallback);
  try { const parsed = new URL(value); if (!["http:","https:"].includes(parsed.protocol)) throw new Error(); }
  catch { throw new Error(`Invalid URL configuration: ${key}`); }
  return value.replace(/\/$/, "");
}
function optionalUrl(key: string) { return string(key) ? url(key, "") : ""; }
const environment = choice("APP_ENV", ["development", "test", "production"] as const, "development");
const authSecret = string("AUTH_SECRET");
if (authSecret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters. Run npm run local:env for local setup.");
const appUrl = url("APP_URL", "http://localhost:3000");
if (new URL(appUrl).origin !== appUrl) throw new Error("APP_URL must be a canonical origin without a path, query, credentials or fragment.");
const databaseUrl = string("DATABASE_URL");
if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
try { const parsedDb = new URL(databaseUrl); if (!parsedDb.hostname || parsedDb.pathname.length < 2) throw new Error(); } catch { throw new Error("Invalid DATABASE_URL configuration."); }
const adsMode = choice("ADS_MODE", ["off", "placeholder", "adsense"] as const, environment === "production" ? "off" : "placeholder");
const adsenseClientId = string("ADSENSE_CLIENT_ID");
if (adsenseClientId && !/^ca-pub-\d{16}$/.test(adsenseClientId)) throw new Error("Invalid ADSENSE_CLIENT_ID format.");
const analyticsId=string("GOOGLE_ANALYTICS_ID"), adsTagId=string("GOOGLE_ADS_ID");
if(analyticsId&&!/^G-[A-Z0-9]{4,20}$/.test(analyticsId))throw new Error("Invalid GOOGLE_ANALYTICS_ID format.");
if(adsTagId&&!/^AW-[0-9]{5,20}$/.test(adsTagId))throw new Error("Invalid GOOGLE_ADS_ID format.");
const configuredGoogle = Boolean(string("GOOGLE_CLIENT_ID") && string("GOOGLE_CLIENT_SECRET"));
if (Boolean(string("GOOGLE_CLIENT_ID")) !== Boolean(string("GOOGLE_CLIENT_SECRET"))) throw new Error("Configure both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET or leave both blank.");
const cmpProvider = choice("CMP_PROVIDER", ["", "cookiebot"] as const, "");
const cmpScriptUrl = optionalUrl("CMP_SCRIPT_URL");
const cmpPublisherId = string("CMP_PUBLISHER_ID");
if (cmpScriptUrl && cmpScriptUrl !== "https://consent.cookiebot.com/uc.js") throw new Error("CMP_SCRIPT_URL must use the supported Cookiebot script URL.");
if (cmpPublisherId && (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(cmpPublisherId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(cmpPublisherId))) throw new Error("CMP_PUBLISHER_ID must be the real Cookiebot domain-group UUID.");
function adSlot(key: string) {
  const value = string(key);
  if (value && !/^\d{1,20}$/.test(value)) throw new Error(`Invalid numeric advertising slot: ${key}`);
  return value;
}
const placements = {
  catalogue: { enabled: bool("ADS_CATALOGUE_ENABLED", true), slot: adSlot("ADS_CATALOGUE_SLOT_ID"), sizes: "728×90 / 320×100" },
  inline: { enabled: bool("ADS_INLINE_ENABLED", true), slot: adSlot("ADS_INLINE_SLOT_ID"), sizes: "300×250", after: integer("ADS_INLINE_AFTER", 8, 4, 40) },
  sidebar: { enabled: bool("ADS_SIDEBAR_ENABLED", true), slot: adSlot("ADS_SIDEBAR_SLOT_ID"), sizes: "300×250" },
  lower: { enabled: bool("ADS_LOWER_ENABLED", false), slot: adSlot("ADS_LOWER_SLOT_ID"), sizes: "728×90 / 320×100" },
};
const smtpHost = string("SMTP_HOST");
const smtpFrom = string("SMTP_FROM");
const mailMode = choice("MAIL_MODE", ["smtp", "disabled"] as const, "disabled");
const smtpRequireTls = bool("SMTP_REQUIRE_TLS", true), smtpVerified = bool("SMTP_VERIFIED", false);
const smtpUser = string("SMTP_USER"), smtpPassword = string("SMTP_PASSWORD");
const smtpDnsTimeoutMs = integer("SMTP_DNS_TIMEOUT_MS", 5000, 500, 30000);
const smtpConnectTimeoutMs = integer("SMTP_CONNECT_TIMEOUT_MS", 10000, 500, 30000);
const smtpGreetingTimeoutMs = integer("SMTP_GREETING_TIMEOUT_MS", 10000, 500, 30000);
const smtpSocketTimeoutMs = integer("SMTP_SOCKET_TIMEOUT_MS", 15000, 500, 30000);
const workerStopGraceSeconds = integer("WORKER_STOP_GRACE_SECONDS", 60, 30, 180);
if (mailMode === "smtp") {
  if (!smtpHost || !smtpFrom) throw new Error("SMTP mode requires SMTP_HOST and SMTP_FROM.");
  if (!smtpRequireTls) throw new Error("SMTP_REQUIRE_TLS must be true when SMTP is enabled.");
  if (Boolean(smtpUser) !== Boolean(smtpPassword)) throw new Error("Configure both SMTP_USER and SMTP_PASSWORD or leave both blank for an authorised relay.");
  if (workerStopGraceSeconds * 1000 < smtpDnsTimeoutMs + smtpConnectTimeoutMs + smtpGreetingTimeoutMs + smtpSocketTimeoutMs + 10000) throw new Error("WORKER_STOP_GRACE_SECONDS must allow SMTP phase timeouts plus at least 10 seconds for job completion.");
}
const registrationEnabled = bool("REGISTRATION_ENABLED", false);
const legalReviewed = bool("LEGAL_REVIEWED", false);
const publicLaunchReviewed = bool("PUBLIC_LAUNCH_REVIEWED", false);
const operatorName = string("OPERATOR_NAME");
const operatorAddress = string("OPERATOR_ADDRESS");
const operatorCountry = string("OPERATOR_COUNTRY");
const supportEmail = string("SUPPORT_EMAIL");
const storageDriver = choice("STORAGE_DRIVER", ["local", "s3"] as const, "local");
const uploadMaxMb=integer("UPLOAD_MAX_MB",10,1,15),proxyMaxBodyMb=integer("PROXY_MAX_BODY_MB",16,2,20);
if(proxyMaxBodyMb<uploadMaxMb+1)throw new Error("PROXY_MAX_BODY_MB must allow UPLOAD_MAX_MB plus at least 1 MB for the multipart envelope.");
const workerDbPoolMax=integer("WORKER_DB_POOL_MAX",2,1,10);
const workerEntrypoint=process.argv?.[1]?.endsWith('/worker.ts')===true;
const s3Endpoint = optionalUrl("S3_ENDPOINT"), s3Bucket = string("S3_BUCKET"), s3AccessKey = string("S3_ACCESS_KEY"), s3SecretKey = string("S3_SECRET_KEY");
if (s3Endpoint && new URL(s3Endpoint).origin !== s3Endpoint) throw new Error("S3_ENDPOINT must be an origin without a path, query, credentials or fragment.");
if (storageDriver === "s3" && (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey)) throw new Error("S3 storage requires endpoint, bucket and both credentials.");
if (environment === "production") {
  if (!appUrl.startsWith("https://")) throw new Error("Production APP_URL requires HTTPS.");
  if (/localhost|127\.0\.0\.1/.test(appUrl)) throw new Error("Production APP_URL requires the real domain.");
  if (/example|change[-_ ]?me|placeholder|generate[-_ ]a[-_ ]random|build[-_ ]only/i.test(authSecret)) throw new Error("Production AUTH_SECRET cannot be a placeholder.");
  if (/placeholder|change[-_ ]?me|generate[-_ ]a[-_ ]random/i.test(decodeURIComponent(new URL(databaseUrl).password))) throw new Error("Production DATABASE_URL cannot use a placeholder password.");
  if (storageDriver === "s3" && !s3Endpoint.startsWith("https://")) throw new Error("Production S3 storage requires an HTTPS endpoint.");
  if (registrationEnabled && (!legalReviewed || !publicLaunchReviewed || !operatorName || !operatorAddress || !operatorCountry || !supportEmail || !smtpHost || !smtpFrom || mailMode !== "smtp" || !smtpVerified)) throw new Error("Public registration requires reviewed legal/security launch checks, real operator/support details and verified SMTP delivery.");
}
export const config = Object.freeze({
  environment, testDatabaseUrl: string("TEST_DATABASE_URL"), appName: string("APP_NAME", "Biblioteca Comunității"), appUrl, authSecret, databaseUrl,
  postgresDb: string("POSTGRES_DB", "community"), postgresUser: string("POSTGRES_USER", "community"), postgresPassword: string("POSTGRES_PASSWORD"),
  postgresMaxConnections: integer("POSTGRES_MAX_CONNECTIONS", 30, 15, 100), postgresSharedBuffersMb: integer("POSTGRES_SHARED_BUFFERS_MB", 128, 32, 512),
  webMemoryMb: integer("WEB_MEMORY_MB", 1024, 256, 2048), workerMemoryMb: integer("WORKER_MEMORY_MB", 384, 128, 768), databaseMemoryMb: integer("DATABASE_MEMORY_MB", 768, 256, 1536), proxyMemoryMb: integer("PROXY_MEMORY_MB", 128, 64, 256),
  webCpus:decimal("WEB_CPUS",1),databaseCpus:decimal("DATABASE_CPUS",0.6),workerCpus:decimal("WORKER_CPUS",0.25),proxyCpus:decimal("PROXY_CPUS",0.15),
  registrationEnabled, googleEnabled: configuredGoogle, googleClientId: string("GOOGLE_CLIENT_ID"), googleClientSecret: string("GOOGLE_CLIENT_SECRET"),
  adminBootstrapEmail: string("ADMIN_BOOTSTRAP_EMAIL", "gocandan@gmail.com").toLowerCase(),
  adminStepUpMinutes: integer("ADMIN_STEP_UP_MINUTES", 30, 5, 120),
  dbPoolMax: workerEntrypoint?workerDbPoolMax:integer("DB_POOL_MAX", 6, 1, 20), workerDbPoolMax, dbStatementTimeoutMs: integer("DB_STATEMENT_TIMEOUT_MS", 10000, 500, 120000),
  sessionDays: integer("AUTH_SESSION_DAYS", 14, 1, 90), authRateLimit: integer("AUTH_RATE_LIMIT", 10, 1, 100),
  operatorName, operatorAddress, operatorCountry, supportEmail,
  legalReviewed, publicLaunchReviewed,
  smtpHost, smtpPort: integer("SMTP_PORT", 587, 1, 65535), smtpSecure: bool("SMTP_SECURE", false), smtpRequireTls, smtpVerified,
  smtpUser, smtpPassword, smtpFrom, mailMode,
  smtpDnsTimeoutMs, smtpConnectTimeoutMs, smtpGreetingTimeoutMs, smtpSocketTimeoutMs,
  googleBooksEnabled: bool("GOOGLE_BOOKS_ENABLED", false), googleBooksApiKey: string("GOOGLE_BOOKS_API_KEY"),
  openLibraryEnabled: bool("OPEN_LIBRARY_ENABLED", false), bookProviderDailyLimit: integer("BOOK_PROVIDER_DAILY_LIMIT", 100, 0, 5000),
  bookMetadataCacheDays: integer("BOOK_METADATA_CACHE_DAYS", 30, 1, 365),
  mistralEnabled: bool("MISTRAL_ENABLED", false), mistralApiKey: string("MISTRAL_API_KEY"), mistralModel: string("MISTRAL_MODEL", "mistral-small-latest"),
  mistralTimeoutMs: integer("MISTRAL_TIMEOUT_MS", 4000, 500, 10000), mistralDailyLimit: integer("MISTRAL_DAILY_REQUEST_LIMIT", 20, 0, 1000),
  mistralMaxRequestCostCents: integer("MISTRAL_MAX_REQUEST_COST_CENTS", 0, 0, 10000),
  mistralMonthlyBudgetCents: integer("MISTRAL_MONTHLY_BUDGET_CENTS", 500, 0, 100000),
  storageDriver, storagePath: resolve(/* turbopackIgnore: true */ string("STORAGE_PATH", "./storage/images")),
  s3Endpoint, s3Region: string("S3_REGION"), s3Bucket, s3AccessKey, s3SecretKey,
  maxPhotos: integer("UPLOAD_MAX_PHOTOS", 3, 1, 6), uploadMaxMb, proxyMaxBodyMb, uploadMaxPixels: integer("UPLOAD_MAX_PIXELS", 40000000, 1000000, 50000000),
  uploadMemberQuotaMb: integer("UPLOAD_MEMBER_QUOTA_MB", 200, 10, 2000), imageConcurrency: integer("IMAGE_CONCURRENCY", 1, 1, 2),
  loanDays: integer("LOAN_DEFAULT_DAYS", 28, 1, 180), loanMaxDays: integer("LOAN_MAX_DAYS", 90, 1, 365), loanMaxActive: integer("LOAN_MAX_ACTIVE", 5, 1, 30),
  reservationHours: integer("RESERVATION_HOURS", 72, 1, 720), loanReminderDays: integer("LOAN_REMINDER_DAYS", 3, 1, 14),
  retentionDays: integer("RETENTION_DAYS", 365, 30, 3650), messageRetentionDays: integer("MESSAGE_RETENTION_DAYS", 365, 30, 3650),
  auditRetentionDays: integer("AUDIT_RETENTION_DAYS", 730, 90, 3650), backupRetentionDays: integer("BACKUP_RETENTION_DAYS", 14, 1, 365),
  backupPath: resolve(/* turbopackIgnore: true */ string("BACKUP_PATH", "./backups")), backupOffsiteDestination: string("BACKUP_OFFSITE_DESTINATION"),
  pairCooldownDays: integer("XP_PAIR_COOLDOWN_DAYS", 30, 1, 365), readingMonthlyCap: integer("XP_READING_MONTHLY_CAP", 10, 0, 100), listingMonthlyCap: integer("XP_LISTING_MONTHLY_CAP", 10, 0, 100),
  monthlyReadingTarget: integer("CHALLENGE_READING_TARGET", 3, 1, 30), monthlyGenresTarget: integer("CHALLENGE_GENRES_TARGET", 2, 1, 10),
  rewardLender: integer("XP_LENDER_RETURN", 30, 0, 100), rewardBorrower: integer("XP_BORROWER_RETURN", 15, 0, 100), rewardOnTime: integer("XP_ON_TIME", 5, 0, 100),
  rewardReading: integer("XP_FINISHED_WORK", 5, 0, 100), rewardDonor: integer("XP_ACCEPTED_GIFT", 20, 0, 100), rewardListing: integer("XP_FIRST_LISTING", 3, 0, 20), rewardRuleVersion: string("XP_RULE_VERSION", "2026-01"),
  reviewBlindDays: integer("REVIEW_BLIND_DAYS", 14, 1, 30), forumEditMinutes: integer("FORUM_EDIT_MINUTES", 60, 1, 1440),
  messageDailyContactLimit: integer("MESSAGE_DAILY_CONTACT_LIMIT", 5, 1, 30), messageMinuteLimit: integer("MESSAGE_MINUTE_LIMIT", 10, 1, 30),
  forumMinuteLimit: integer("FORUM_MINUTE_LIMIT", 5, 1, 20),
  adsMode, placeholdersPublic: bool("ADS_PLACEHOLDERS_PUBLIC", false), placements, adsenseClientId, adsenseVerified: bool("ADSENSE_VERIFIED", false),
  cmpProvider, cmpScriptUrl, cmpPublisherId, cmpCspEnabled: bool("CMP_CSP_ENABLED", false), cmpCertified: bool("CMP_CERTIFIED", false), cmpValidated: bool("CMP_VALIDATED", false),
  googleAnalyticsId: string("GOOGLE_ANALYTICS_ID"), analyticsEnabled: bool("ANALYTICS_ENABLED", false), googleAdsId: string("GOOGLE_ADS_ID"), googleAdsConversionEnabled: bool("GOOGLE_ADS_CONVERSION_ENABLED", false), googleAdsConversionLabel: string("GOOGLE_ADS_CONVERSION_LABEL"),
  systemPath: string("PATH", "/usr/local/bin:/usr/bin:/bin"),
  workerPollMs: integer("WORKER_POLL_MS", 2000, 1000, 10000), workerMaxAttempts: integer("WORKER_MAX_ATTEMPTS", 5, 1, 10), workerStopGraceSeconds,
  trustedProxy: bool("TRUSTED_PROXY", false), previewHost: choice("PREVIEW_HOST", ["127.0.0.1", "0.0.0.0", "::1", "::"] as const, "127.0.0.1"), previewPort: integer("PREVIEW_PORT", 3000, 1024, 65535), previewProxyPort: integer("PREVIEW_PROXY_PORT", 8080, 1024, 65535), siteDomain: string("SITE_DOMAIN"), tlsEmail: string("TLS_EMAIL"),
});
export type AppConfig = typeof config;
export type ChildEnvironment = Record<string, string | undefined> & { NODE_ENV: AppConfig["environment"] };
// Server process handoff only. Never include this environment in browser/admin
// projections. The generated Next server changes cwd, so storage paths are absolute.
export function nativeWebEnvironment():ChildEnvironment{return {...source,NODE_ENV:'production',HOSTNAME:config.previewHost,PORT:String(config.previewPort),STORAGE_PATH:config.storagePath,BACKUP_PATH:config.backupPath,NEXT_TELEMETRY_DISABLED:'1'};}
export function publicConfig() {
  return { appName: config.appName, environment: config.environment, googleEnabled: config.googleEnabled, registrationEnabled: config.registrationEnabled, adsMode: config.adsMode, placeholdersPublic: config.placeholdersPublic || config.environment !== "production", placements: config.placements, defaultLoanDays: config.loanDays, maxPhotos: config.maxPhotos, uploadMaxMb: config.uploadMaxMb };
}
export function safeEffectiveConfig() {
  return { ...publicConfig(), environment: config.environment, appUrl: config.appUrl, dbPoolMax: config.dbPoolMax, storageDriver: config.storageDriver,
    maxPhotos: config.maxPhotos, uploadMaxMb: config.uploadMaxMb, loanDays: config.loanDays, reservationHours: config.reservationHours,
    legalReviewed: config.legalReviewed, smtpConfigured: config.mailMode === "smtp" && Boolean(config.smtpHost && config.smtpFrom), smtpVerified: config.smtpVerified, googleConfigured: config.googleEnabled,
    mistralConfigured: Boolean(config.mistralApiKey), bookApiConfigured: Boolean(config.googleBooksApiKey), s3Configured: Boolean(config.s3AccessKey && config.s3SecretKey),
    cmpConfigured: Boolean(config.cmpProvider && config.cmpScriptUrl && config.cmpPublisherId && config.cmpCspEnabled && config.cmpCertified && config.cmpValidated), adsenseConfigured: Boolean(config.adsenseClientId && config.adsenseVerified) };
}
export function configurationReadiness() {
  const blockers: string[] = [];
  if (config.environment !== "production") blockers.push("Mediul este pentru previzualizare, nu pentru lansare publică.");
  if (!config.appUrl.startsWith("https://")) blockers.push("Configurează domeniul și HTTPS.");
  if (!config.operatorName || !config.supportEmail || !config.operatorAddress || !config.operatorCountry) blockers.push("Completează datele reale ale operatorului și contactul.");
  if (!config.legalReviewed) blockers.push("Documentele juridice necesită revizuire și publicare.");
  if (config.mailMode !== "smtp" || !config.smtpHost || !config.smtpFrom) blockers.push("Configurează și verifică livrarea emailurilor SMTP.");
  else if (!config.smtpVerified) blockers.push("Verifică autentificarea, acceptarea expeditorului și livrarea SMTP înainte de lansare.");
  if (!config.publicLaunchReviewed) blockers.push("Lista de verificare pentru lansare nu este confirmată.");
  if (!config.registrationEnabled) blockers.push("Înregistrarea publică este oprită.");
  if (config.mistralEnabled && (!config.mistralApiKey || config.mistralMaxRequestCostCents <= 0)) blockers.push("AI-ul bibliografic este oprit până la configurarea bugetului conservator pe cerere.");
  if (config.adsMode === "adsense" && !(config.adsenseVerified && config.adsenseClientId && config.cmpProvider === "cookiebot" && config.cmpCertified && config.cmpValidated && config.cmpScriptUrl && config.cmpPublisherId && config.cmpCspEnabled)) blockers.push("Publicitatea live este blocată până la verificarea editorului și CMP.");
  if (config.adsMode === "adsense" && Object.values(config.placements).some(placement => placement.enabled && !placement.slot)) blockers.push("Completează identificatorii reali ai tuturor pozițiilor publicitare activate.");
  return { readyForPublicLaunch: blockers.length === 0, blockers };
}

export function isolatedTestEnvironment(databaseUrl: string, storagePath: string, backupPath: string, authSecret: string): ChildEnvironment {
  const target = new URL(databaseUrl);
  if (!/^[a-z0-9_]+_test$/.test(target.pathname.slice(1))) throw new Error("Test subprocess requires an isolated *_test database.");
  // Next loads project .env files before importing this module during build/start.
  // Defined empty values block those defaults while preserving typed fallbacks.
  const cleared = Object.fromEntries([...configurationKeys].map(key => [key, ""]));
  return { ...cleared, PATH: config.systemPath, APP_ENV: "test", NODE_ENV: "test", APP_NAME: "Biblioteca Comunității test", APP_URL: `http://127.0.0.1:${config.previewPort}`, PREVIEW_HOST: "127.0.0.1", PREVIEW_PORT: String(config.previewPort),
    AUTH_SECRET: authSecret, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl, DB_POOL_MAX: "2", REGISTRATION_ENABLED: "true",
    STORAGE_DRIVER: "local", STORAGE_PATH: storagePath, BACKUP_PATH: backupPath, MAIL_MODE: "disabled", ADS_MODE: "off", ADS_PLACEHOLDERS_PUBLIC: "false",
    GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", MISTRAL_ENABLED: "false", MISTRAL_API_KEY: "", GOOGLE_BOOKS_ENABLED: "false", GOOGLE_BOOKS_API_KEY: "",
    OPEN_LIBRARY_ENABLED: "false", ANALYTICS_ENABLED: "false", GOOGLE_ADS_CONVERSION_ENABLED: "false", CMP_CSP_ENABLED: "false",
    LEGAL_REVIEWED: "false", PUBLIC_LAUNCH_REVIEWED: "false", TRUSTED_PROXY: "false", IMAGE_CONCURRENCY: "1", NODE_OPTIONS: "--max-old-space-size=512" };
}
