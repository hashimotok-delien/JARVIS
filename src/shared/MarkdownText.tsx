import { useMemo, type ReactNode } from "react";

interface Block {
  type: "text" | "code";
  content: string;
}

function splitBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let buffer: string[] = [];
  let inCode = false;

  for (const line of lines) {
    const fence = line.match(/^\s*```/);
    if (fence) {
      if (inCode) {
        blocks.push({ type: "code", content: buffer.join("\n") });
        buffer = [];
        inCode = false;
      } else {
        if (buffer.length > 0) {
          blocks.push({ type: "text", content: buffer.join("\n") });
          buffer = [];
        }
        inCode = true;
      }
      continue;
    }
    buffer.push(line);
  }

  if (buffer.length > 0) {
    blocks.push({
      type: inCode ? "code" : "text",
      content: buffer.join("\n"),
    });
  }

  return blocks.filter((block) => block.content.length > 0);
}

function renderInline(text: string): ReactNode {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={index}
          className="rounded bg-[var(--bg-base)] px-1 py-0.5 font-[var(--font-mono)] text-[12px] text-[var(--accent-bright)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (
      part.startsWith("**") &&
      part.endsWith("**") &&
      part.length > 4
    ) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

/** Minimal markdown renderer: fenced code, inline code, bold. */
export default function MarkdownText({ text }: { text: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);

  return (
    <div className="space-y-2">
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <pre
            key={index}
            className="overflow-x-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-[12px] leading-relaxed"
          >
            <code className="font-[var(--font-mono)] whitespace-pre text-[var(--accent-bright)]">
              {block.content}
            </code>
          </pre>
        ) : (
          <p
            key={index}
            className="whitespace-pre-wrap break-words"
          >
            {renderInline(block.content)}
          </p>
        ),
      )}
    </div>
  );
}
