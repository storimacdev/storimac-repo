import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt } from "@/lib/systemPrompt";

export const runtime = "nodejs";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function isValidHistory(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (m) =>
        m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
  );
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set. Add it to web/.env.local and restart the dev server.",
      },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const messages = body?.messages;

  if (!isValidHistory(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "Request must include a non-empty `messages` array." },
      { status: 400 }
    );
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1536,
      system: getSystemPrompt(),
      messages,
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Anthropic API error:", err);
    return NextResponse.json(
      { error: "The interview couldn't reach the model. Please try again." },
      { status: 502 }
    );
  }
}
