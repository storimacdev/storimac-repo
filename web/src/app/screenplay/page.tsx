import { Suspense } from "react";
import ScreenplayInterview from "@/components/ScreenplayInterview";

export const metadata = {
  title: "Screenplay — Storimac",
};

export default function ScreenplayPage() {
  return (
    <Suspense fallback={null}>
      <ScreenplayInterview />
    </Suspense>
  );
}
