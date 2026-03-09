import DOMPurify from "dompurify";

/* Strips all HTML tags — prevents XSS from AI responses */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

/* Convert markdown-like text to safe HTML for chat messages */
export function formatChatMessage(text: string): string {
  if (!text) return "";
  // First escape all HTML via DOMPurify (strip everything)
  let safe = DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  // Then apply markdown formatting on the clean text
  safe = safe
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#8B6040;font-weight:700">$1</strong>')
    .replace(/_(.*?)_/g, "<em>$1</em>")
    .replace(/^\d+[\.\)]\s*/gm, "")
    .replace(/^[-\u2022]\s*/gm, "")
    .replace(/\n{2,}/g, '</p><p style="margin:10px 0 0">')
    .replace(/\n/g, "<br/>")
    .replace(/^/, '<p style="margin:0">')
    .replace(/$/, "</p>");
  // Final sanitize pass — allow only the tags we just created
  return DOMPurify.sanitize(safe, {
    ALLOWED_TAGS: ["p", "br", "strong", "em"],
    ALLOWED_ATTR: ["style"],
  });
}
