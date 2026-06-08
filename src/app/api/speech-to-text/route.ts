import { NextRequest, NextResponse } from "next/server";

// 百度语音识别配置
const APP_ID = process.env.BAIDU_APP_ID || "";
const API_KEY = process.env.BAIDU_API_KEY || "";
const SECRET_KEY = process.env.BAIDU_SECRET_KEY || "";

// 缓存 access_token，避免每次请求都获取
let cachedToken = "";
let tokenExpireTime = 0;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpireTime) {
    return cachedToken;
  }

  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`;

  const response = await fetch(url, { method: "POST" });
  const data = await response.json();

  if (data.error) {
    throw new Error(`获取百度 access_token 失败: ${data.error_description || data.error}`);
  }

  cachedToken = data.access_token;
  // 提前 5 分钟过期以留出缓冲
  tokenExpireTime = now + (data.expires_in - 300) * 1000;

  console.log("百度 access_token 获取成功");
  return cachedToken;
}

export async function POST(request: NextRequest) {
  try {
    // 检查配置
    if (!APP_ID || !API_KEY || !SECRET_KEY) {
      console.error("百度语音配置缺失");
      return NextResponse.json(
        { error: "语音识别配置错误，请检查环境变量" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;

    if (!audioFile) {
      return NextResponse.json(
        { error: "未找到音频文件" },
        { status: 400 }
      );
    }

    // 将音频文件转为 base64
    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");

    // 获取 access_token
    const token = await getAccessToken();

    // 调用百度语音识别 REST API
    const asrUrl = "https://vop.baidu.com/server_api";
    const asrBody = JSON.stringify({
      format: "wav",
      rate: 16000,
      channel: 1,
      cuid: "hospital_voice_app",
      token: token,
      speech: base64Audio,
      len: arrayBuffer.byteLength,
    });

    console.log(`发送语音识别请求，音频大小: ${arrayBuffer.byteLength} bytes`);

    const asrResponse = await fetch(asrUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: asrBody,
    });

    if (!asrResponse.ok) {
      console.error(`百度 API HTTP 错误: ${asrResponse.status}`);
      return NextResponse.json(
        { error: `语音识别服务返回 HTTP ${asrResponse.status}` },
        { status: 500 }
      );
    }

    const result = await asrResponse.json();

    // 检查识别结果
    if (result.err_no !== 0) {
      console.error("百度语音识别错误:", JSON.stringify(result));
      return NextResponse.json(
        { error: result.err_msg || "语音识别失败" },
        { status: 500 }
      );
    }

    // 提取识别文字
    const text = result.result?.[0] || "";

    if (!text) {
      console.error("百度语音识别返回空文本, result:", JSON.stringify(result));
      return NextResponse.json(
        { error: "未识别到语音内容，请清晰说话后再试" },
        { status: 400 }
      );
    }

    console.log(`语音识别成功: "${text}"`);

    return NextResponse.json({
      text,
      success: true,
    });
  } catch (error) {
    console.error("语音识别异常:", error);
    return NextResponse.json(
      { error: "语音识别服务异常: " + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
