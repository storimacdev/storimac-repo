import { Suspense } from "react";
import ChatInterview from "@/components/ChatInterview";

export const metadata = {
  title: "Story Foundation Interview — Storimac",
};

export default function InterviewPage() {
  return (
    <Suspense fallback={null}>
      <ChatInterview />
    </Suspense>
  );
}
