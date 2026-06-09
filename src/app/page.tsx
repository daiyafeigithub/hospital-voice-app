"use client";

import { useState, useRef, useCallback } from "react";

// ====== 工具函数：PCM → WAV ======
function float32ToWav(samples: Float32Array, sampleRate: number): Blob {
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const numChannels = 1;
  const dataLength = samples.length * bytesPerSample;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);

  const w = (dv: DataView, o: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };

  w(view, 0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  w(view, 8, "WAVE");
  w(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  w(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

// ====== 类型定义 ======
interface Video {
  id: string;
  title: string;
  description: string;
  url: string;
  duration: string;
  category: string;
  tags: string[];
}

interface Conversation {
  id: string;
  question: string;
  answer: string;
  videos?: Video[];
  sources?: string[];
  timestamp: number;
}

type ProcessPhase = "idle" | "listening" | "recognizing" | "ai-answering" | "done";

// ====== 内联 SVG 图标组件 ======
const Icons = {
  mic: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 10v2a7 7 0 01-14 0v-2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19v4M8 23h8" />
    </svg>
  ),
  search: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  cpu: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
    </svg>
  ),
  check: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  play: (cls = "w-5 h-5") => (
    <svg className={cls} fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  alert: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86l-8.6 14.86A2 2 0 003.91 22h16.18a2 2 0 001.71-3.28l-8.6-14.86a2 2 0 00-3.42 0z" />
    </svg>
  ),
  info: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
    </svg>
  ),
  clock: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  video: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  chat: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  x: (cls = "w-5 h-5") => (
    <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  loader: (cls = "w-4 h-4") => (
    <svg className={`${cls} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  ),
};

// ====== Toast ======
function Toast({ message, type, onClose }: { message: string; type: "info" | "error"; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-40 max-w-lg w-full px-4 animate-slide-down">
      <div className={`px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 ${
        type === "error"
          ? "bg-red-50 border border-red-200 text-red-700"
          : "bg-white border border-gray-200 text-gray-700"
      }`}>
        <span className={type === "error" ? "text-red-500" : "text-blue-500"}>
          {type === "error" ? Icons.alert("w-4 h-4") : Icons.info("w-4 h-4")}
        </span>
        <p className="text-xs flex-1">{message}</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 leading-none">&times;</button>
      </div>
    </div>
  );
}

// ====== 视频播放器 ======
function VideoPlayer({ video, onClose }: { video: Video; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 animate-overlay-in" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl animate-modal-in" onClick={(e) => e.stopPropagation()}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-emerald-600">{Icons.video("w-4 h-4")}</span>
            <h3 className="text-sm font-medium text-gray-800 truncate">{video.title}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600">
            {Icons.x("w-4 h-4")}
          </button>
        </div>
        {/* 视频 */}
        <div className="bg-black">
          <video src={video.url} controls autoPlay className="w-full aspect-video" />
        </div>
        {/* 底部信息 */}
        <div className="px-5 py-3 flex items-center justify-between">
          <p className="text-xs text-gray-500 truncate flex-1 mr-4">{video.description}</p>
          <div className="flex gap-1.5 flex-shrink-0">
            {video.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-xs font-medium">{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ====== 结果弹窗（仅显示视频结果） ======
function VideoResultModal({
  question,
  videos,
  onClose,
  onPlayVideo,
}: {
  question: string;
  videos: Video[];
  onClose: () => void;
  onPlayVideo: (v: Video) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-overlay-in" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden shadow-2xl animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600">
              {Icons.check("w-4 h-4")}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{question || "识别结果"}</p>
              <p className="text-xs text-gray-400">{videos.length} 个推荐视频</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600">
            {Icons.x("w-4 h-4")}
          </button>
        </div>

        {/* 视频列表 */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 56px)' }}>
          {videos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              {Icons.video("w-12 h-12 mb-3 opacity-30")}
              <p className="text-sm">暂无推荐视频</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {videos.map((video) => (
                <button
                  key={video.id}
                  onClick={() => onPlayVideo(video)}
                  className="w-full flex items-center gap-4 p-3 rounded-xl border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all text-left group"
                >
                  {/* 缩略图占位 */}
                  <div className="relative flex-shrink-0 w-40 aspect-video rounded-lg bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center overflow-hidden">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <span className="text-white ml-0.5">{Icons.play("w-5 h-5")}</span>
                    </div>
                    <span className="absolute bottom-1.5 right-1.5 text-[10px] text-white bg-black/50 px-1.5 py-0.5 rounded">
                      {video.duration}
                    </span>
                  </div>

                  {/* 信息 */}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-gray-800 line-clamp-2 mb-1">{video.title}</h4>
                    <p className="text-xs text-gray-500 line-clamp-1 mb-2">{video.description}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">{video.category}</span>
                      {video.tags.slice(0, 2).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[10px]">{tag}</span>
                      ))}
                    </div>
                  </div>

                  {/* 播放图标 */}
                  <span className="flex-shrink-0 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    {Icons.play("w-5 h-5")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ====== 主页面 ======
export default function Home() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [liveSubtitle, setLiveSubtitle] = useState("");
  const [processPhase, setProcessPhase] = useState<ProcessPhase>("idle");
  const [toast, setToast] = useState<{ message: string; type: "info" | "error" } | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const isStoppedRef = useRef(false);

  const showToast = useCallback((message: string, type: "info" | "error" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 处理录音数据
  const processRecording = useCallback(async (pcmChunks: Float32Array[]) => {
    setIsListening(false); // 立即关闭录音状态，不再显示脉冲动画
    setIsLoading(true);
    setProcessPhase("recognizing");
    try {
      const totalLen = pcmChunks.reduce((sum, c) => sum + c.length, 0);
      if (totalLen === 0) {
        setProcessPhase("idle");
        showToast("未检测到有效语音，请靠近麦克风清晰说话", "info");
        setIsLoading(false);
        return;
      }

      const merged = new Float32Array(totalLen);
      let offset = 0;
      for (const c of pcmChunks) { merged.set(c, offset); offset += c.length; }

      const wavBlob = float32ToWav(merged, 16000);
      const formData = new FormData();
      formData.append("audio", wavBlob, "recording.wav");

      const response = await fetch("/api/speech-to-text", { method: "POST", body: formData });
      const data = await response.json();

      if (data.success && data.text) {
        setLiveSubtitle(data.text);
        setProcessPhase("ai-answering");

        const chatResponse = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: data.text,
            history: conversations.slice(-3).map(c => ({ role: "user", content: c.question }))
          }),
        });

        const chatData = await chatResponse.json();

        const newConversation: Conversation = {
          id: Date.now().toString(),
          question: data.text,
          answer: chatData.answer || "",
          videos: chatData.videos || [],
          sources: chatData.sources || [],
          timestamp: Date.now(),
        };

        setConversations(prev => [newConversation, ...prev]);
        setProcessPhase("done");

        setTimeout(() => {
          setSelectedConversation(newConversation);
          setProcessPhase("idle");
          setLiveSubtitle("");
        }, 600);
      } else {
        setProcessPhase("idle");
        showToast(data.error || "语音识别失败，请重试", "error");
      }
    } catch (error) {
      console.error("处理错误:", error);
      setProcessPhase("idle");
      showToast("服务异常，请稍后重试", "error");
    } finally {
      setIsLoading(false);
    }
  }, [conversations, showToast]);

  // 开始录音
  const startRecording = useCallback(async () => {
    console.log('[录音] startRecording 被调用');
    console.log('[录音] navigator.mediaDevices:', !!navigator.mediaDevices);
    console.log('[录音] getUserMedia:', !!navigator.mediaDevices?.getUserMedia);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.error('[录音] 浏览器不支持 mediaDevices API');
      showToast("您的浏览器不支持录音功能", "error");
      return;
    }
    try {
      console.log('[录音] 请求麦克风权限...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('[录音] 麦克风权限获取成功');
      mediaStreamRef.current = stream;

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioCtx({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;

      pcmChunksRef.current = [];
      isStoppedRef.current = false;

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        const input = e.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(input));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setIsListening(true);
      setProcessPhase("listening");
    } catch (error) {
      console.error("麦克风权限失败:", error);
      if (error instanceof Error) {
        console.error('[录音] 错误名称:', error.name, '消息:', error.message);
      }
      showToast("无法访问麦克风，请检查浏览器权限设置", "error");
    }
  }, [showToast]);

  // 停止录音
  const stopRecording = useCallback(() => {
    if (isStoppedRef.current) return;
    isStoppedRef.current = true;

    if (scriptProcessorRef.current) { scriptProcessorRef.current.disconnect(); scriptProcessorRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null; }

    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    processRecording(chunks);
  }, [processRecording]);

  // 点击录音：点一下开始，再点一下停止（兼容所有设备）
  const handleMicClick = useCallback(() => {
    console.log('[按钮] handleMicClick, isListening:', isListening, 'isLoading:', isLoading);
    if (isLoading) return;
    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isListening, isLoading, startRecording, stopRecording]);

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 via-emerald-50 to-green-50 flex overflow-hidden">
      {/* ====== 侧边栏 ====== */}
      <aside
        className={`fixed top-0 right-0 h-full bg-white/95 backdrop-blur-md border-l border-gray-200 shadow-2xl transition-transform duration-300 ease-in-out z-30 ${
          showHistory ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: '320px' }}
      >
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">历史记录</h2>
            <button onClick={() => setShowHistory(false)} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              {Icons.x("w-4 h-4 text-gray-500")}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {conversations.length === 0 ? (
              <div className="text-center py-12 text-gray-300">
                <div className="mb-3">{Icons.chat("w-10 h-10 mx-auto opacity-30")}</div>
                <p className="text-xs">暂无历史记录</p>
              </div>
            ) : (
              <div className="space-y-2">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => { setSelectedConversation(conv); setShowHistory(false); }}
                    className="w-full p-3 rounded-lg border border-gray-100 bg-white hover:border-emerald-200 hover:shadow-sm transition-all text-left"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center mt-0.5">
                        {Icons.chat("w-3.5 h-3.5 text-gray-400")}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-700 line-clamp-2 leading-relaxed">{conv.question}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-gray-400">
                            {new Date(conv.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {conv.videos && conv.videos.length > 0 && (
                            <span className="text-[10px] text-emerald-500">{conv.videos.length} 视频</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {conversations.length > 0 && (
            <div className="p-4 border-t border-gray-100">
              <button onClick={() => setConversations([])} className="w-full px-3 py-2 bg-gray-50 text-gray-500 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-xs">
                清空记录
              </button>
            </div>
          )}
        </div>
      </aside>

      {showHistory && (
        <div className="fixed inset-0 bg-black/20 z-20 animate-overlay-in" onClick={() => setShowHistory(false)} />
      )}

      {/* ====== 主区域 ====== */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* 顶栏 */}
        <header className="bg-white/95 backdrop-blur-md border-b border-gray-100 px-6 py-3 relative z-20 shadow-sm">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center shadow">
                <span className="text-white text-sm font-bold">H</span>
              </div>
              <div>
                <h1 className="text-sm font-bold text-gray-800">Hospeech</h1>
                <p className="text-[10px] text-gray-400">医疗健康智能匹配</p>
              </div>
            </div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-lg transition-all duration-200 ${
                showHistory ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {Icons.clock("w-5 h-5")}
            </button>
          </div>
        </header>

        {/* 内容 */}
        <main className="flex-1 flex items-center justify-center px-4 py-8 overflow-hidden relative">
          <Toast message={toast?.message || ""} type={toast?.type || "info"} onClose={() => setToast(null)} />
          <div className="max-w-4xl w-full flex flex-col items-center">
            {/* ====== 录音按钮 ====== */}
            <button
              onClick={handleMicClick}
              disabled={isLoading}
              className={`relative w-36 h-36 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl select-none ${
                processPhase === "listening"
                  ? 'bg-gradient-to-br from-red-500 to-rose-600 scale-110 shadow-red-300/50'
                  : isLoading
                  ? 'bg-gradient-to-br from-gray-300 to-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-br from-emerald-500 to-green-600 hover:scale-105 hover:shadow-emerald-300/50 active:scale-95'
              }`}
            >
              {/* 聆听时脉冲动画 */}
              {processPhase === "listening" && (
                <>
                  <div className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-30" />
                  <div className="absolute inset-2 rounded-full bg-red-400 animate-pulse opacity-20" />
                </>
              )}
              <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </button>

            {/* ====== 流程状态区 ====== */}
            <div className="mt-8 w-full max-w-lg mx-auto">
              {/* idle */}
              {processPhase === "idle" && (
                <div className="text-center animate-fade-in">
                  <p className="text-sm text-gray-500">
                    {isListening ? '点击按钮停止录音' : '点击按钮开始录音'}
                  </p>
                </div>
              )}

              {/* listening */}
              {processPhase === "listening" && (
                <div className="text-center animate-fade-in">
                  <div className="flex items-center justify-center gap-1.5 mb-2">
                    <span className="text-red-500">{Icons.mic("w-4 h-4")}</span>
                    <p className="text-xs font-medium text-red-600">正在聆听，再次点击停止</p>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    {[0, 1, 2, 3, 4].map(i => (
                      <span key={i} className="w-0.5 bg-red-400/60 rounded-full animate-wave" style={{ animationDelay: `${i * 100}ms` }} />
                    ))}
                  </div>
                </div>
              )}

              {/* recognizing */}
              {processPhase === "recognizing" && (
                <div className="text-center animate-fade-in">
                  <div className="flex items-center justify-center gap-1.5 mb-2">
                    {Icons.loader("w-3.5 h-3.5 text-emerald-600")}
                    <p className="text-xs font-medium text-emerald-600">识别中</p>
                  </div>
                </div>
              )}

              {/* ai-answering */}
              {processPhase === "ai-answering" && (
                <div className="text-center animate-fade-in space-y-3">
                  {liveSubtitle && (
                    <div className="bg-white/80 border border-gray-200 rounded-lg px-4 py-2.5 shadow-sm">
                      <p className="text-xs text-gray-400 mb-0.5">识别结果</p>
                      <p className="text-sm text-gray-700 font-medium">{liveSubtitle}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-1.5">
                    {Icons.loader("w-3.5 h-3.5 text-blue-500")}
                    <p className="text-xs font-medium text-blue-500">正在匹配</p>
                  </div>
                </div>
              )}

              {/* done */}
              {processPhase === "done" && (
                <div className="text-center animate-fade-in space-y-3">
                  {liveSubtitle && (
                    <div className="bg-white/80 border border-gray-200 rounded-lg px-4 py-2.5 shadow-sm">
                      <p className="text-xs text-gray-400 mb-0.5">识别结果</p>
                      <p className="text-sm text-gray-700 font-medium">{liveSubtitle}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-center gap-1.5">
                    <span className="text-emerald-500">{Icons.check("w-4 h-4")}</span>
                    <p className="text-xs font-medium text-emerald-600">已完成</p>
                  </div>
                </div>
              )}
            </div>

            {/* 底部提示 */}
            {conversations.length > 0 && processPhase === "idle" && (
              <div className="mt-6">
                <p className="text-[11px] text-gray-400">
                  共 {conversations.length} 条记录 · 点击右上角查看
                </p>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* ====== 弹窗 ====== */}
      {playingVideo && <VideoPlayer video={playingVideo} onClose={() => setPlayingVideo(null)} />}
      {selectedConversation && !playingVideo && (
        <VideoResultModal
          question={selectedConversation.question}
          videos={selectedConversation.videos || []}
          onClose={() => setSelectedConversation(null)}
          onPlayVideo={(v) => {
            setPlayingVideo(v);
          }}
        />
      )}
    </div>
  );
}
