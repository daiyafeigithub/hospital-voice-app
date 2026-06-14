// ============================================
// 身份认证 API — 登录/登出/获取当前用户/查询医院层级
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { setSession, deleteSession, hasSession, removeSessionsByUserId, getSessionStore } from "@/lib/auth";
import users from "@/data/users.json";

function generateToken() {
  return `token-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// POST: 登录 or 登出
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, userId } = body;

    // === 登出 ===
    if (action === "logout") {
      const token = request.headers.get("x-auth-token") || request.cookies.get("auth_token")?.value;
      if (token) deleteSession(token);
      const res = NextResponse.json({ success: true });
      res.cookies.delete("auth_token");
      return res;
    }

    // === 登录 ===
    if (action === "login") {
      if (!userId) {
        return NextResponse.json({ error: "缺少 userId" }, { status: 400 });
      }

      // 只支持医护登录
      const s = users.staff.find((u) => u.id === userId);
      if (!s) return NextResponse.json({ error: "医护人员不存在" }, { status: 404 });

      const hospital = users.hospitals.find((h) => h.id === s.hospitalId);
      const identity = {
        name: s.name,
        department: s.department,
        avatar: s.avatar,
        hospitalName: hospital?.name || "",
        hospitalId: s.hospitalId,
        deptId: s.deptId,
      };

      // 单设备登录：先踢掉同一 userId 的旧 session
      removeSessionsByUserId(userId);

      const token = generateToken();
      setSession(token, {
        userId,
        name: identity.name,
        role: "staff",
        department: identity.department,
        avatar: identity.avatar,
      });

      const res = NextResponse.json({
        success: true,
        token,
        user: {
          userId,
          role: "staff",
          name: identity.name,
          department: identity.department || null,
          avatar: identity.avatar || null,
          hospitalName: identity.hospitalName || null,
          hospitalId: identity.hospitalId || null,
          deptId: identity.deptId || null,
        },
      });

      res.cookies.set("auth_token", token, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 86400,
      });

      return res;
    }

    return NextResponse.json({ error: "未知 action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "请求处理失败" }, { status: 500 });
  }
}

// GET: 获取用户/医院/科室/医护人员列表
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const listType = searchParams.get("list");
  const hospitalId = searchParams.get("hospitalId");
  const deptId = searchParams.get("deptId");

  // --- 医院列表（含科室） ---
  if (listType === "hospitals") {
    return NextResponse.json({ hospitals: users.hospitals });
  }

  // --- 按医院+科室过滤的医护列表 ---
  if (listType === "staff") {
    let staffList = users.staff;
    if (hospitalId) staffList = staffList.filter((s) => s.hospitalId === hospitalId);
    if (deptId) staffList = staffList.filter((s) => s.deptId === deptId);
    return NextResponse.json({ staff: staffList });
  }

  // --- 获取某个医院的科室列表 ---
  if (listType === "departments") {
    if (!hospitalId) return NextResponse.json({ error: "缺少 hospitalId" }, { status: 400 });
    const hospital = users.hospitals.find((h) => h.id === hospitalId);
    if (!hospital) return NextResponse.json({ error: "医院不存在" }, { status: 404 });
    return NextResponse.json({ departments: hospital.departments });
  }

  // --- 所有医护人员（含医院/科室信息） ---
  if (listType === "all-staff-full") {
    const full = users.staff.map((s) => {
      const hospital = users.hospitals.find((h) => h.id === s.hospitalId);
      return {
        ...s,
        hospitalName: hospital?.name || "",
        hospitalShortName: hospital?.shortName || "",
      };
    });
    return NextResponse.json({ staff: full });
  }

  // --- 验证当前登录态 ---
  const token = request.headers.get("x-auth-token") || request.cookies.get("auth_token")?.value;
  if (!token || !hasSession(token)) {
    return NextResponse.json({ user: null });
  }

  const sessions = getSessionStore();
  const session = sessions.get(token);
  if (!session) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: {
      userId: session.userId,
      role: session.role,
      name: session.name,
      department: session.department || null,
      avatar: session.avatar || null,
    },
  });
}
