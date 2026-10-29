export const initialPolicySlugs = ["termeni", "confidentialitate", "cookie-uri", "reguli-comunitate", "siguranta", "imprumuturi-daruri", "raportare-contestatii", "operator-contact"] as const;
export function parseReviewedPolicy(slug: string, content: string) {
  if (!(initialPolicySlugs as readonly string[]).includes(slug)) throw new Error("Unexpected policy slug; publication refused.");
  if (Buffer.byteLength(content,"utf8") > 65536 || content.includes("\0")) throw new Error("Invalid policy file; publication refused.");
  const lines=content.replace(/\r\n/g,"\n").trim().split("\n"),heading=lines.shift()?.match(/^# ([^#].{2,179})$/);
  const body=lines.join("\n").trim();
  if (!heading || body.length < 100 || /^\s*(PROIECT|DRAFT|TODO)\b/im.test(body) || /\{\{[\s\S]*?\}\}|\[(?:OPERATOR|SUPPORT|ADDRESS|EMAIL)[A-Z_]*\]/.test(body)) throw new Error("Policy is still a draft or incomplete. Review the entire text and its operator details before publication.");
  // Removing a marker is not legal approval. The protected CLI requires a separate
  // operator attestation, and documentation requires competent review of all text.
  return {slug,title:heading[1].trim(),body};
}
