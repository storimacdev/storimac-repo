import { Suspense } from "react";
import CharacterInterview from "@/components/CharacterInterview";

export const metadata = {
  title: "Character Bible — Storimac",
};

export default function CharacterBiblePage() {
  return (
    <Suspense fallback={null}>
      <CharacterInterview />
    </Suspense>
  );
}
