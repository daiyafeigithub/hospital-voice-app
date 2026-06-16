// ============================================
// 数据 API — 医院/科室/医护人员（无需登录）
// ============================================

import { NextRequest, NextResponse } from "next/server";
import users from "@/data/users.json";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const listType = searchParams.get("list");

  // 所有医护人员 + 医院列表
  if (listType === "all-staff-full") {
    const full = users.staff.map((s) => {
      const hospital = users.hospitals.find((h) => h.id === s.hospitalId);
      return {
        ...s,
        hospitalName: hospital?.name || "",
        hospitalShortName: hospital?.shortName || "",
      };
    });
    return NextResponse.json({ staff: full, hospitals: users.hospitals });
  }

  // 仅医院列表
  if (listType === "hospitals") {
    return NextResponse.json({ hospitals: users.hospitals });
  }

  return NextResponse.json({ error: "未知请求" }, { status: 400 });
}
