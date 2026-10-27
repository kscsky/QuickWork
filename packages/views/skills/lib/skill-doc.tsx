"use client";

const SKILL_MD = "SKILL.md";

/**
 * SKILL.md renders as a document: frontmatter and the leading H1 are lifted
 * into the page header, so the body starts at the first real section.
 */
export function skillBodyForDoc(path: string, content: string): string {
  if (path !== SKILL_MD) return content;
  let body = content;
  const frontmatter = body.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (frontmatter) body = body.slice(frontmatter[0].length);
  return body.replace(/^\s*#\s+.*(?:\r?\n)+/, "");
}

const INLINE_MARKUP =
  /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const pattern = new RegExp(INLINE_MARKUP);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code key={key} className="qw-sk-inline">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      parts.push(
        link ? (
          <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer">
            {link[1]}
          </a>
        ) : (
          token
        ),
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function SkillDoc({
  path,
  content,
  className = "qw-sk-doc",
}: {
  path: string;
  content: string;
  className?: string;
}) {
  const nodes: React.ReactNode[] = [];
  let code: string[] | null = null;

  const flushCode = (key: string) => {
    if (code === null) return;
    nodes.push(
      <pre key={key} className="qw-sk-code">
        {code.join("\n")}
      </pre>,
    );
    code = null;
  };

  skillBodyForDoc(path, content)
    .split("\n")
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("```")) {
        if (code === null) code = [];
        else flushCode(`code-${index}`);
        return;
      }
      if (code !== null) {
        code.push(line);
        return;
      }
      if (!trimmed) return;
      if (trimmed.startsWith("### ")) {
        nodes.push(
          <h3 key={index}>{renderInline(trimmed.slice(4), `h3-${index}`)}</h3>,
        );
      } else if (trimmed.startsWith("## ")) {
        nodes.push(
          <h2 key={index}>{renderInline(trimmed.slice(3), `h2-${index}`)}</h2>,
        );
      } else if (trimmed.startsWith("# ")) {
        nodes.push(
          <h2 key={index}>{renderInline(trimmed.slice(2), `h1-${index}`)}</h2>,
        );
      } else if (trimmed.startsWith("- ")) {
        nodes.push(
          <div key={index} className="qw-sk-li">
            {renderInline(trimmed.slice(2), `li-${index}`)}
          </div>,
        );
      } else if (/^\d+\.\s/.test(trimmed)) {
        nodes.push(
          <div key={index} className="qw-sk-li">
            {renderInline(trimmed, `li-${index}`)}
          </div>,
        );
      } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        nodes.push(<hr key={index} className="qw-sk-hr" />);
      } else {
        nodes.push(<p key={index}>{renderInline(trimmed, `p-${index}`)}</p>);
      }
    });
  flushCode("code-end");

  return <div className={className}>{nodes}</div>;
}
