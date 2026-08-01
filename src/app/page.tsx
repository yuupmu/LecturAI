import { Suspense } from "react";
import LecturAIApp from "@/frontend/LecturAIApp";

// The route remains a thin Server Component; all session interaction is client-side.
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <LecturAIApp />
    </Suspense>
  );
}
