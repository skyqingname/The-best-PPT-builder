import { onProjectChange } from "@/lib/events-bus";
import { auditProjectArtifacts } from "@/lib/pipeline";
import { serializeProject } from "@/lib/serialize";
import { getProject, listEvents, listPages } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    getProject(id);
    auditProjectArtifacts(id);
  } catch {
    return new Response("not found", { status: 404 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let scheduled: ReturnType<typeof setTimeout> | null = null;
      const send = () => {
        if (closed) return;
        const project = serializeProject(getProject(id), listPages(id), listEvents(id));
        controller.enqueue(
          encoder.encode(`event: project\ndata: ${JSON.stringify(project)}\n\n`),
        );
      };
      const schedule = () => {
        if (closed || scheduled) return;
        scheduled = setTimeout(() => {
          scheduled = null;
          send();
        }, 60);
      };
      send();
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 15_000);
      const off = onProjectChange((projectId) => {
        if (projectId === id) schedule();
      });
      const abort = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (scheduled) clearTimeout(scheduled);
        off();
        controller.close();
      };
      request.signal.addEventListener("abort", abort, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
