"use client";

import ProjectExperience from "@/components/project/ProjectExperience";

export default function ProjectScreen({ projectId }: { projectId: string }) {
  return <ProjectExperience projectId={projectId} />;
}
