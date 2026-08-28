import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

export default function MarkdownBody({ text }: { text: string }) {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
