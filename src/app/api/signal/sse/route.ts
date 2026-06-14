// ============================================
// WebRTC SSE 信令端点
// ============================================

// 共享 storage (从 signal/route.ts import 不到，使用全局变量)
// @ts-ignore
if (!globalThis.__signalingStore) {
  // @ts-ignore
  globalThis.__signalingStore = new Map<string, any[]>();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const callId = searchParams.get("callId");
  const role = searchParams.get("role");

  if (!callId || !role) {
    return new Response(JSON.stringify({ error: "缺少参数" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // @ts-ignore
  const store: Map<string, any[]> = globalThis.__signalingStore;
  if (!store.has(callId)) {
    store.set(callId, []);
  }

  const targetRole = role === "caller" ? "callee" : "caller";

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let lastIndex = 0;

      const sendSSE = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          clearInterval(interval);
        }
      };

      sendSSE(JSON.stringify({ type: "connected" }));

      const interval = setInterval(() => {
        try {
          const messages = store.get(callId) || [];

          // 检查结束信号
          const hasEnd = messages.some((m) => m.type === "call-ended");
          if (hasEnd) {
            sendSSE(JSON.stringify({ type: "call-ended" }));
            clearInterval(interval);
            controller.close();
            return;
          }

          // 发送新消息
          for (let i = lastIndex; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.fromRole === targetRole) {
              sendSSE(JSON.stringify(msg));
            }
          }
          lastIndex = messages.length;
        } catch {
          clearInterval(interval);
        }
      }, 500);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
