"use client";

import { useMemo } from "react";

type MathTextProps = {
  text?: string | null;
  className?: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMath(input: string) {
  // KaTeX is optional. In environments where deps cannot be installed (or for a lighter build),
  // we render math tokens as plain text. This keeps the app functional and avoids runtime crashes.
  const normalized = input
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");

  // Keep math delimiters visible so students can still read the expression.
  return escapeHtml(normalized).replace(/\n/g, "<br />");
}

export function MathText({ text, className }: MathTextProps) {
  const html = useMemo(() => renderMath(text ?? ""), [text]);
  return <span className={className ?? "math-text"} dangerouslySetInnerHTML={{ __html: html }} />;
}
