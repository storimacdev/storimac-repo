import { Suspense } from "react";
import ProjectDashboard from "@/components/ProjectDashboard";

export const metadata = {
  title: "Your Projects — Storimac",
};

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <ProjectDashboard />
    </Suspense>
  );
}
