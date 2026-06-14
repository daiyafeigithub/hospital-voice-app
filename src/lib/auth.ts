// ============================================
// Auth 工具函数（仅医生登录）
// ============================================

import { NextRequest } from "next/server";

interface SessionData {
  userId: string;
  name: string;
  role: "staff";
  department?: string;
  avatar?: string;
  createdAt: number;
}

const sessions = new Map<string, SessionData>();

export function hasSession(token: string) {
  return sessions.has(token);
}

export function setSession(
  token: string,
  data: { userId: string; name: string; role: "staff"; department?: string; avatar?: string }
) {
  sessions.set(token, { ...data, createdAt: Date.now() });
}

export function deleteSession(token: string) {
  sessions.delete(token);
}

export function getUserFromRequest(request: NextRequest): {
  userId: string;
  name: string;
  role: "staff";
  department?: string;
  avatar?: string;
} | null {
  const token =
    request.headers.get("x-auth-token") || request.cookies.get("auth_token")?.value;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  return {
    userId: s.userId,
    name: s.name,
    role: s.role,
    department: s.department,
    avatar: s.avatar,
  };
}

/** 踢掉同一 userId 的其他 session（单设备登录） */
export function removeSessionsByUserId(userId: string) {
  sessions.forEach((s, token) => {
    if (s.userId === userId) sessions.delete(token);
  });
}

export function getSessionStore() {
  return sessions;
}
