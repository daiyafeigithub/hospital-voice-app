import { NextRequest, NextResponse } from "next/server";
import knowledgeBase from "@/data/knowledge-base.json";
import videos from "@/data/videos.json";
import { keywordMatch } from "@/lib/similarity";

const SYSTEM_PROMPT = `你是一个医院智能助手，专门为住院患者和家属提供医疗知识解答和视频推荐。
你的回答要：
1. 通俗易懂，避免过于专业的术语
2. 语气温和友善，适合老年患者阅读
3. 基于提供的知识库内容回答，如果知识库没有相关信息，请诚实告知
4. 每次回答末尾，如果有关联视频，请推荐用户观看

请用以下JSON格式回复：
{"answer": "你的文字回答", "videoIds": ["推荐视频id数组，没有则为空数组"]}`;

export async function POST(req: NextRequest) {
  const { message, history = [] } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "请输入您的问题" }, { status: 400 });
  }

  const matchedDocs = knowledgeBase
    .map((doc) => ({
      ...doc,
      score: keywordMatch(message, doc.content, doc.tags),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter((d) => d.score > 0);

  const matchedVideos = videos
    .map((v) => ({
      ...v,
      score: keywordMatch(message, v.title + v.description, v.tags),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .filter((v) => v.score > 0);

  const contextText = matchedDocs.length > 0
    ? `以下是相关的医疗知识文档，请基于这些内容回答患者问题：\n\n${matchedDocs.map((d) => `【${d.title}】\n${d.content}`).join("\n\n")}`
    : "知识库中没有找到完全匹配的内容，请根据你的医疗常识给出一般性建议，并提醒患者咨询主治医生。";

  const videoIds = matchedVideos.map((v) => v.id);

  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey || apiKey === "your_dashscope_api_key_here") {
    const fallbackAnswer = matchedDocs.length > 0
      ? `根据您的提问，我找到了以下相关信息：\n\n${matchedDocs.map((d) => `**${d.title}**\n${d.content}`).join("\n\n")}${matchedVideos.length > 0 ? "\n\n📺 为您推荐以下视频：" : ""}`
      : `感谢您的提问！请在 .env.local 文件中配置您的 DASHSCOPE_API_KEY 以启用通义千问大模型。\n\n目前我可以根据关键词为您找到相关资料：\n${matchedDocs.length > 0 ? matchedDocs.map((d) => `- ${d.title}`).join("\n") : "- 暂未找到相关内容"}`;

    return NextResponse.json({
      answer: fallbackAnswer,
      videos: matchedVideos.map(({ score: _, ...v }) => v),
      videoIds,
      sources: matchedDocs.map((d) => d.title),
    });
  }

  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${contextText}\n\n患者问题：${message}` },
    ];

    if (history.length > 0) {
      messages.splice(1, 0, ...history.slice(-6));
    }

    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen-plus",
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error(`DashScope API error: ${response.status}`);
    }

    const data = await response.json();
    let aiContent = data.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      parsed = JSON.parse(aiContent);
    } catch {
      parsed = { answer: aiContent, videoIds: [] };
    }

    const finalVideoIds = [...new Set([...(parsed.videoIds || []), ...videoIds])];
    const finalVideos = videos
      .filter((v) => finalVideoIds.includes(v.id))
      .slice(0, 3);

    return NextResponse.json({
      answer: parsed.answer,
      videos: finalVideos,
      videoIds: finalVideoIds,
      sources: matchedDocs.map((d) => d.title),
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "抱歉，系统暂时出现问题，请稍后再试或咨询医护人员。" },
      { status: 500 }
    );
  }
}
