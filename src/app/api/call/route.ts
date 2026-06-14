// ============================================
// 呼叫管理 API (创建/接听/挂断)
// 医生之间的互相通话
// ============================================

interface CallSession {
  callId: string;
  status: "waiting" | "ringing" | "connected" | "ended";
  callerId: string;
  callerName: string;
  callerDepartment?: string;
  callerHospitalName?: string;
  targetContact: {
    id: string;
    name: string;
    title: string;
    avatar: string;
    department: string;
  };
  createdAt: number;
  callType: "voice" | "video";
}

const activeCalls = new Map<string, CallSession>();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, callId, callType, callerId, callerName, callerDepartment, callerHospitalName, contact } = body;

    if (action === "create") {
      const id = callId || `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const session: CallSession = {
        callId: id,
        status: "waiting",
        callerId: callerId || "unknown",
        callerName: callerName || "未知医生",
        callerDepartment: callerDepartment || undefined,
        callerHospitalName: callerHospitalName || undefined,
        targetContact: contact,
        createdAt: Date.now(),
        callType: callType || "voice",
      };
      activeCalls.set(id, session);
      return Response.json({
        success: true,
        callId: id,
        session,
        pendingCalls: Array.from(activeCalls.values()).filter(
          (c) => c.status === "waiting" || c.status === "ringing"
        ),
      });
    }

    if (action === "ringing") {
      const session = activeCalls.get(callId);
      if (!session) return Response.json({ error: "呼叫不存在" }, { status: 404 });
      session.status = "ringing";
      activeCalls.set(callId, session);
      return Response.json({ success: true, session });
    }

    if (action === "accept") {
      const session = activeCalls.get(callId);
      if (!session) return Response.json({ error: "呼叫不存在" }, { status: 404 });
      session.status = "connected";
      activeCalls.set(callId, session);
      return Response.json({ success: true, session });
    }

    if (action === "end") {
      const session = activeCalls.get(callId);
      if (session) {
        session.status = "ended";
        activeCalls.set(callId, session);
      }
      const cutoff = Date.now() - 10 * 60 * 1000;
      activeCalls.forEach((c, k) => {
        if (c.status === "ended" && c.createdAt < cutoff) {
          activeCalls.delete(k);
        }
      });
      return Response.json({ success: true });
    }

    return Response.json({ error: "未知 action" }, { status: 400 });
  } catch {
    return Response.json({ error: "请求处理失败" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const callId = searchParams.get("callId");

  if (callId) {
    const session = activeCalls.get(callId);
    if (!session) return Response.json({ error: "呼叫不存在" }, { status: 404 });
    return Response.json({ session });
  }

  // 列出所有等待中的呼叫（被叫端按 targetContact.id 自行过滤）
  const pending = Array.from(activeCalls.values()).filter(
    (c) => c.status === "waiting" || c.status === "ringing"
  );
  return Response.json({ pending });
}
