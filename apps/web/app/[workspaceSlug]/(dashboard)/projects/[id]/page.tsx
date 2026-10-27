"use client";

import { use } from "react";
import { ProjectsPage } from "@quickwork/views/projects/components";

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <ProjectsPage initialProjectId={id} />;
}
