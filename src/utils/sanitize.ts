/* Strips all HTML tags — prevents XSS from AI responses */
export function sanitizeHtml(html: string): string {
  const escaped = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
  return escaped;
}

/* Convert markdown-like text to safe HTML for chat messages */
export function formatChatMessage(text: string): string {
  if (!text) return "";
  let safe = sanitizeHtml(text);
  safe = safe
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#8B6040;font-weight:700">$1</strong>')
    .replace(/_(.*?)_/g, "<em>$1</em>")
    .replace(/^\d+[\.\)]\s*/gm, "")
    .replace(/^[-\u2022]\s*/gm, "")
    .replace(/\n{2,}/g, '</p><p style="margin:10px 0 0">')
    .replace(/\n/g, "<br/>")
    .replace(/^/, '<p style="margin:0">')
    .replace(/$/, "</p>");
  return safe;
}
