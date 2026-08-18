import ProjectScreen from "@/components/ProjectScreen";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProjectScreen projectId={id} />;
}
