import { createFileRoute } from "@tanstack/react-router";
import { PromptAtelier } from "@/components/prompt/prompt-atelier";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <PromptAtelier />;
}
