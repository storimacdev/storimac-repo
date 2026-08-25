import { Suspense } from "react";
import WorldInterview from "@/components/WorldInterview";

export const metadata = {
  title: "World Bible — Storimac",
};

export default function WorldBiblePage() {
  return (
    <Suspense fallback={null}>
      <WorldInterview />
    </Suspense>
  );
}
