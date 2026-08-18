import { onProjectChange } from "@/lib/events-bus";
import { getProject, listEvents } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    getProject(id);
  } catch {
    return new Response("not found", { status: 404 });
  }

  const url = new URL(request.url);
  let last = url.searchParams.get("after") ?? "";

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = () => {
        const events = listEvents(id, last || undefined);
        if (events.length) {
          last = events[events.length - 1].created_at;
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ ping: true, last, count: events.length })}\n\n`),
        );
        if (events.length) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ events })}\n\n`),
          );
        }
      };
      send();
      const timer = setInterval(send, 1200);
      const off = onProjectChange((projectId) => {
        if (projectId === id) send();
      });
      const abort = () => {
        clearInterval(timer);
        off();
        controller.close();
      };
      request.signal.addEventListener("abort", abort);
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
