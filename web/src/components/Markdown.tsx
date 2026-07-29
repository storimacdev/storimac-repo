import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared markdown renderer for chat replies and the generated document
 * preview — both previously rendered raw markdown source as plain text.
 * Styled to match the dark neutral-950/red-orange theme already used
 * throughout ChatInterview.tsx rather than pulling in a Tailwind plugin.
 */

const components: Components = {
  h1: ({ children }) => <h1 className="mb-3 mt-5 text-lg font-bold text-neutral-100 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-bold text-neutral-100 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-bold text-neutral-200 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold text-neutral-200 first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="mb-3 leading-relaxed last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-neutral-50">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-orange-400 underline hover:text-orange-300">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-red-500/40 pl-3 text-neutral-400 last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-neutral-800" />,
  code: ({ className, children, ...props }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded-lg bg-neutral-900/80 px-3 py-2 font-mono text-[12px] text-neutral-200" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[12px] text-orange-200" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="mb-3 overflow-x-auto last:mb-0">{children}</pre>,
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-neutral-700 text-neutral-300">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1.5 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t border-neutral-800 px-2 py-1.5 align-top">{children}</td>,
};

export default function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ?? "text-[13px] leading-relaxed text-neutral-100"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
