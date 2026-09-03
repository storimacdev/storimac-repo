"use client";

import { useRef, useState } from "react";

/** Shared scroll-position tracking for a chat-style message list - used
 * identically by all three interview screens (Story Foundation, Character
 * Bible, World Bible), which otherwise duplicate the same scrollable-
 * panel structure. `containerRef` goes on the scrollable messages `<div>`
 * (with `onScroll={handleScroll}`); `endRef` goes on the empty marker
 * `<div>` at the bottom of the message list; `scrollToLatest` scrolls to
 * that marker. */
export function useScrollToLatest() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    setIsNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 100);
  }

  function scrollToLatest(behavior: ScrollBehavior = "smooth") {
    endRef.current?.scrollIntoView({ behavior });
  }

  return { containerRef, endRef, isNearBottom, handleScroll, scrollToLatest };
}
