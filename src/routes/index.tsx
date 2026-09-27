import { createFileRoute } from "@tanstack/react-router";
import { AtelierApp } from "@/components/atelier/atelier-app";

export const Route = createFileRoute("/")({ component: AtelierApp });
