"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError } from "@/lib/api";

const MARKDOWN_COMPONENTS = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  h1: ({ children }) => <h1 className="mb-2 mt-1 text-base font-semibold text-[#102a43]">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-1 text-sm font-semibold text-[#102a43]">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-1 text-sm font-semibold text-[#102a43]">{children}</h3>,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto rounded-md border border-[#1d4f73]/15 last:mb-0">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#1d4f73]/5">{children}</thead>,
  th: ({ children }) => <th className="border-b border-[#1d4f73]/15 px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-[#1d4f73]/10 px-3 py-2 align-top">{children}</td>,
  code: ({ children }) => <code className="rounded bg-[#1d4f73]/10 px-1 py-0.5 font-mono text-[13px]">{children}</code>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  )
};

export default function AssistantView({ clubId }) {
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  async function ask(event) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !clubId || asking) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setQuestion("");
    setAsking(true);

    try {
      const body = await api.post("/api/assistant", { question: trimmed, clubId });
      setMessages((prev) => [...prev, { role: "assistant", text: body.answer }]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: error instanceof ApiError ? error.message : error.message || "Something went wrong.",
          isError: true
        }
      ]);
    } finally {
      setAsking(false);
    }
  }

  if (!clubId) {
    return <div className="rounded-xl border border-dashed border-[#1d4f73]/25 bg-white/50 p-10 text-center text-[#647b8f]">Choose a club to ask the assistant.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="min-h-[220px] space-y-3 rounded-xl border border-[#1d4f73]/10 bg-white/80 p-5">
        {messages.length === 0 && (
          <p className="text-sm text-[#647b8f]">Ask about your standing, contributions, next payout, or recent announcements for this club. Answers come from your current records.</p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={
              message.role === "user"
                ? "ml-auto max-w-[80%] rounded-lg bg-[#1f5f8b] p-3 text-sm text-white"
                : `max-w-[95%] rounded-lg p-3 text-sm ${message.isError ? "bg-red-400/10 text-red-700" : "bg-[#eef6fb] text-[#102a43]"}`
            }
          >
            {message.role === "assistant" && !message.isError ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {message.text}
              </ReactMarkdown>
            ) : (
              message.text
            )}
          </div>
        ))}
        {asking && <div className="max-w-[80%] rounded-lg bg-[#eef6fb] p-3 text-sm text-[#647b8f]">Checking your records...</div>}
      </div>
      <form onSubmit={ask} className="flex gap-2">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="e.g. How much do I still owe this month?"
          className="flex-1 rounded-lg border border-[#173b56]/20 bg-white px-4 py-3 text-sm outline-none focus:border-[#1f5f8b]"
        />
        <button type="submit" disabled={asking || !question.trim()} className="rounded-lg bg-[#1f5f8b] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#18496b] disabled:opacity-50">
          Ask
        </button>
      </form>
    </div>
  );
}
