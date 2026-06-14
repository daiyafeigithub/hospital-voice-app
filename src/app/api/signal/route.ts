// ============================================
// WebRTC 信令 API (统一存储)
// ============================================

// 使用 globalThis 共享存储
interface SignalMessage {
  type: string;
  data: unknown;
  fromRole: string;
  timestamp: number;
}

if (!(globalThis as any).__signalingStore) {
  (globalThis as any).__signalingStore = new Map<string, SignalMessage[]>();
}

// POST: 发送信令消息
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, callId, data, fromRole } = body;
    if (!type || !callId) {
      return Response.json({ error: "missing params" }, { status: 400 });
    }

    const store: Map<string, SignalMessage[]> = (globalThis as any).__signalingStore;
    if (!store.has(callId)) store.set(callId, []);
    const messages = store.get(callId)!;
    messages.push({ type, data, fromRole, timestamp: Date.now() });

    // 清理 5 分钟前的旧消息
    const cutoff = Date.now() - 5 * 60 * 1000;
    store.set(callId, messages.filter((m) => m.timestamp > cutoff));

    return Response.json({ success: true });
  } catch {
    return Response.json({ error: "parse error" }, { status: 400 });
  }
}

// GET: 轮询获取信令消息（对方发送的，返回后清空）
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const callId = searchParams.get("callId");
  const role = searchParams.get("role");
  if (!callId) {
    return Response.json({ error: "missing callId" }, { status: 400 });
  }

  const store: Map<string, SignalMessage[]> = (globalThis as any).__signalingStore;
  const messages = store.get(callId) || [];
  
  // 只返回对方发来的消息
  const myMessages = messages.filter((m) => m.fromRole !== role);
  
  // 返回后清空已读取的消息（保留自己的消息）
  store.set(callId, messages.filter((m) => m.fromRole === role));

  // 清理过期消息
  const cutoff = Date.now() - 5 * 60 * 1000;
  store.set(callId, store.get(callId)!.filter((m) => m.timestamp > cutoff));

  return Response.json({ messages: myMessages });
}
