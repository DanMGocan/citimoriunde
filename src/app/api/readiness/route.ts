import { launchReadiness } from "@/domain/readiness";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const readiness = await launchReadiness();
    return Response.json({ running: true, readyForPublicLaunch: readiness.readyForPublicLaunch }, { status: readiness.readyForPublicLaunch ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ running: false, readyForPublicLaunch: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
