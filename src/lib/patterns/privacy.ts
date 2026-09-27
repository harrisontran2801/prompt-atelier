const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d[\s().-]?){8,}\d/g;
const TOKEN = /\b(?:sk|pk|rk|ghp|hf_|xai-|Bearer\s+)[A-Za-z0-9._\-]{6,}\b/gi;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;

export function redactPii(input: string): { text: string; hits: string[] } {
  const hits: string[] = [];
  const text = input
    .replace(EMAIL, () => {
      hits.push("email");
      return "[email]";
    })
    .replace(TOKEN, () => {
      hits.push("token");
      return "[token]";
    })
    .replace(CARD, (match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 13) return match;
      hits.push("card");
      return "[card]";
    })
    .replace(PHONE, (match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 15) return match;
      hits.push("phone");
      return "[phone]";
    });
  return { text, hits };
}

export function sanitizePublicError(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/key=[A-Za-z0-9._\-]+/gi, "key=[redacted]")
    .replace(/\b(?:sk|pk|rk|hf_|xai-)[A-Za-z0-9._\-]{6,}\b/g, "[redacted]")
    .slice(0, 280);
}
