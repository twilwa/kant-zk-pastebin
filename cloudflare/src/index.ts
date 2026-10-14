// ABOUTME: Serves the general pastebin and a retirement notice on the room hostname.
// ABOUTME: Retains storage alarm exports so existing expiration deadlines are honored.
import { pastebin } from "./pastebin";
import { retired } from "./retirement";
export { Room } from "./room";
export { Access } from "./access";

export default {
  async fetch(request, env) {
    const origin = new URL(request.url).origin;
    if (origin === env.APP_ORIGIN) return retired(request);
    if (origin !== env.PASTEBIN_ORIGIN)
      return new Response("Not found", { status: 404 });
    try {
      return await pastebin(request, env);
    } catch {
      return Response.json(
        { error: "Service unavailable; retry shortly" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
} satisfies ExportedHandler<Env>;
