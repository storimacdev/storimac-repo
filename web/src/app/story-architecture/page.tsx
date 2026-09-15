import { Suspense } from "react";
import ArchitectureInterview from "@/components/ArchitectureInterview";

export const metadata = {
  title: "Story Architecture — Storimac",
};

export default function StoryArchitecturePage() {
  return (
    <Suspense fallback={null}>
      <ArchitectureInterview />
    </Suspense>
  );
}
