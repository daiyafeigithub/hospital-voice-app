// ============================================
// AI 对话 API — 医生呼叫医生
// ============================================

import { NextRequest, NextResponse } from "next/server";
import users from "@/data/users.json";

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "";

interface Contact {
  id: string;
  name: string;
  title: string;
  avatar: string;
  department: string;
  hospitalName: string;
  hospitalShortName: string;
  hospitalId: string;
  deptId: string;
  keywords: string[];
}

// 从 users.json 构建联系人列表（含医院信息）
const CONTACTS: Contact[] = users.staff.map((s) => {
  const hospital = users.hospitals.find((h) => h.id === s.hospitalId);
  return {
    id: s.id,
    name: s.name,
    title: s.title,
    avatar: s.avatar,
    department: s.department,
    hospitalName: hospital?.name || "",
    hospitalShortName: hospital?.shortName || "",
    hospitalId: s.hospitalId,
    deptId: s.deptId,
    keywords: [s.name, s.name.slice(0, 2), s.department],
  };
});

const contactsSummary = CONTACTS
  .map((c) => `- ${c.name} (${c.hospitalShortName} ${c.department}, ${c.title}), id: ${c.id}`)
  .join("\n");

const SYSTEM_PROMPT =
  "你是一个医院医护呼叫助手，名字叫小H。核心任务：帮医生联系其他科室的医生。\n\n" +
  "可用联系人：\n" +
  contactsSummary +
  "\n\n" +
  "规则：\n" +
  "1. 用户打招呼(你好/在吗/呼叫) → 用对方称呼回应，然后询问要联系哪位医生\n" +
  "2. 用户说出联系人名字 → 返回 { \"action\":\"call\", \"answer\":\"好的，正在为您呼叫...\", \"contactId\":\"联系人id\" }\n" +
  "3. 用户说不相关的 → 引导说出要呼叫谁\n" +
  "4. 用户说取消/不用 → 友好结束\n\n" +
  "必须返回纯JSON。action: reply或call。call时contactId必须是列表中存在的id。answer不超过50字。";

// 本地关键词匹配
function localMatchContact(text: string): Contact | null {
  let best: Contact | null = null;
  let bestScore = 0;
  for (const c of CONTACTS) {
    for (const kw of c.keywords) {
      if (text.includes(kw) && kw.length > bestScore) {
        bestScore = kw.length;
        best = c;
      }
    }
  }
  return bestScore > 0 ? best : null;
}

function localClassifyIntent(text: string): { action: string; answer: string; contactId?: string } {
  const cancel = ["不用", "取消", "算了", "没事", "不要", "不需要"];
  const greet = ["你好", "在吗", "呼叫", "小h", "小H", "help", "帮助", "请问", "hi", "hello"];

  if (cancel.some((w) => text.includes(w))) {
    return { action: "reply", answer: "好的，有需要随时叫我。" };
  }

  const matched = localMatchContact(text);
  if (matched) {
    return { action: "call", answer: `好的，正在为您呼叫${matched.name}（${matched.hospitalShortName} ${matched.department}）...`, contactId: matched.id };
  }

  if (greet.some((w) => text.includes(w))) {
    return { action: "reply", answer: `您好！我是小H。请问需要呼叫哪位医生？可联系：${CONTACTS.map((c) => c.name).join("、")}` };
  }

  return { action: "reply", answer: "请问您需要联系哪位医生？说出医生姓名即可快速呼叫。" };
}

const MODELS = ["qwen3.6-max-preview", "deepseek-v4-flash", "kimi-k2.6", "qwen3.6-flash-2026-04-16"];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message: string = (body.message || "").trim();
    const history: { role: string; content: string }[] = body.history || [];
    const callerName: string = body.callerName || "";
    const callerDepartment: string = body.callerDepartment || "";

    if (!message) {
      return NextResponse.json({ action: "reply", answer: "请说一句话，我来帮您。", contact: null });
    }

    const apiKey = DASHSCOPE_API_KEY;

    if (!apiKey) {
      console.log("无 DASHSCOPE_API_KEY，使用本地意图匹配");
      const result = localClassifyIntent(message);
      const contact = result.contactId ? CONTACTS.find((c) => c.id === result.contactId) || null : null;
      return NextResponse.json({ ...result, contact });
    }

    // 在 system prompt 中注入呼叫方身份信息
    const identityHint = callerName
      ? `当前呼叫方身份：${callerName}医生${callerDepartment ? `，${callerDepartment}` : ""}。请用医生称呼。`
      : "";

    const messages = [
      { role: "system", content: identityHint ? `${SYSTEM_PROMPT}\n\n${identityHint}` : SYSTEM_PROMPT },
      ...history.slice(-6),
      { role: "user", content: message },
    ];

    let aiContent = "";

    for (const model of MODELS) {
      try {
        const response = await fetch(
          "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + apiKey,
            },
            body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 500 }),
          }
        );

        if (!response.ok) {
          const errorBody = await response.text();
          console.error(`DashScope [${model}] 失败 (${response.status}):`, errorBody);
          continue;
        }

        const data = await response.json();
        aiContent = data.choices?.[0]?.message?.content || "";
        break;
      } catch (e) {
        console.warn(`DashScope [${model}] 异常:`, e);
      }
    }

    if (!aiContent) {
      console.error("所有 AI 模型调用失败，降级到本地匹配");
      const result = localClassifyIntent(message);
      const contact = result.contactId ? CONTACTS.find((c) => c.id === result.contactId) || null : null;
      return NextResponse.json({ ...result, contact });
    }

    let parsed: { action: string; answer: string; contactId?: string };
    try {
      const cleaned = aiContent.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const result = localClassifyIntent(message);
      const contact = result.contactId ? CONTACTS.find((c) => c.id === result.contactId) || null : null;
      return NextResponse.json({ ...result, contact });
    }

    const contact = parsed.contactId ? CONTACTS.find((c) => c.id === parsed.contactId) || null : null;

    return NextResponse.json({
      action: parsed.action === "call" && contact ? "call" : "reply",
      answer: parsed.answer || "请问需要联系哪位医生？",
      contact,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ action: "reply", answer: "抱歉，系统暂时出现问题，请稍后再试。", contact: null });
  }
}
