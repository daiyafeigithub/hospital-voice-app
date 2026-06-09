"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ====== PCM → WAV ======
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

// ====== 类型 ======
interface Video { id: string; title: string; description: string; url: string; duration: string; category: string; tags: string[] }

const CATEGORY_LABELS: Record<string, string> = {
  'pre-surgery': '术前准备',
  'post-surgery': '术后护理',
  'hypertension': '心血管内科',
  'diabetes': '内分泌科',
  'rehabilitation': '康复科',
  'medication-safety': '药剂科',
  'discharge': '出院指导',
  'emergency': '急诊科',
};
interface Conversation { id: string; question: string; answer: string; videos?: Video[]; sources?: string[]; timestamp: number }
type Phase = "idle" | "listening" | "processing" | "playing";

// ====== 图标 ======
const Icon = {
  mic: (c = "w-6 h-6") => <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>,
  stop: (c = "w-5 h-5") => <svg className={c} fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
  history: (c = "w-5 h-5") => <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  x: (c = "w-5 h-5") => <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>,
  spinner: (c = "w-4 h-4") => <svg className={`${c} animate-spin`} fill="none" viewBox="0 0 24 24"><circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>,
  video: (c = "w-4 h-4") => <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
  alert: (c = "w-4 h-4") => <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  trash: (c = "w-4 h-4") => <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
};

// ====== Toast ======
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] animate-[slideDown_0.25s_ease-out]">
      <div className="bg-gray-900/90 backdrop-blur text-white text-sm px-5 py-2.5 rounded-full shadow-xl flex items-center gap-2">
        {Icon.alert("w-4 h-4 text-amber-400")}
        <span>{msg}</span>
      </div>
    </div>
  );
}

// ====== 全屏视频播放器 ======
function VideoOverlay({ video, onClose }: { video: Video; onClose: () => void }) {
  const categoryLabel = CATEGORY_LABELS[video.category] || video.category;
  return (
    <div className="fixed inset-0 z-50 bg-black animate-[fadeIn_0.2s_ease-out] flex flex-col">
      {/* 顶栏 */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/70 to-transparent px-4 pt-4 pb-10 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-4">
          <span className="text-[11px] text-white/50 flex-shrink-0">当前播放：</span>
          <span className="text-white text-sm font-medium truncate">{categoryLabel}</span>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors flex-shrink-0">
          {Icon.x("w-5 h-5 text-white")}
        </button>
      </div>
      {/* 视频 */}
      <div className="flex-1 flex items-center justify-center">
        <video src={video.url} controls autoPlay playsInline className="w-full h-full object-contain" />
      </div>
      {/* 底部信息 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-5 pt-10 pb-6">
        <p className="text-white/60 text-xs mb-2">{video.description}</p>
        <div className="flex gap-1.5">
          {video.tags.slice(0, 4).map(t => (
            <span key={t} className="text-[10px] text-white/80 bg-white/15 px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ====== 主页面 ======
export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);
  const [recognizedText, setRecognizedText] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const isStoppedRef = useRef(false);

  const showToast = useCallback((m: string) => setToast(m), []);

  // 处理录音 → 识别 → 自动播放
  const processRecording = useCallback(async (pcmChunks: Float32Array[]) => {
    setIsListening(false);
    setIsLoading(true);
    setPhase("processing");
    try {
      const totalLen = pcmChunks.reduce((s, c) => s + c.length, 0);
      if (totalLen === 0) {
        setPhase("idle");
        showToast("未检测到语音，请靠近麦克风说话");
        setIsLoading(false);
        return;
      }
      const merged = new Float32Array(totalLen);
      let off = 0;
      for (const c of pcmChunks) { merged.set(c, off); off += c.length; }

      const wavBlob = float32ToWav(merged, 16000);
      const fd = new FormData();
      fd.append("audio", wavBlob, "recording.wav");

      const sttRes = await fetch("/api/speech-to-text", { method: "POST", body: fd });
      const sttData = await sttRes.json();

      if (!sttData.success || !sttData.text) {
        setPhase("idle");
        showToast(sttData.error || "语音识别失败");
        setIsLoading(false);
        return;
      }

      setRecognizedText(sttData.text);

      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: sttData.text,
          history: conversations.slice(-3).map(c => ({ role: "user", content: c.question })),
        }),
      });
      const chatData = await chatRes.json();

      const conv: Conversation = {
        id: Date.now().toString(),
        question: sttData.text,
        answer: chatData.answer || "",
        videos: chatData.videos || [],
        sources: chatData.sources || [],
        timestamp: Date.now(),
      };
      setConversations(prev => [conv, ...prev]);

      // 有视频 → 直接播放最佳视频
      if (chatData.videos && chatData.videos.length > 0) {
        setPlayingVideo(chatData.videos[0]);
        setPhase("playing");
      } else {
        setPhase("idle");
        showToast("未找到匹配视频");
      }
    } catch (e) {
      console.error("处理错误:", e);
      setPhase("idle");
      showToast("服务异常，请重试");
    } finally {
      setIsLoading(false);
    }
  }, [conversations, showToast]);

  // 开始录音
  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("浏览器不支持录音");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC({ sampleRate: 16000 });
      audioContextRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = proc;
      pcmChunksRef.current = [];
      isStoppedRef.current = false;
      proc.onaudioprocess = (e) => { pcmChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      src.connect(proc);
      proc.connect(ctx.destination);
      setIsListening(true);
      setPhase("listening");
      setRecognizedText("");
    } catch (e) {
      console.error("麦克风权限失败:", e);
      showToast("无法访问麦克风，请检查权限");
    }
  }, [showToast]);

  // 停止录音
  const stopRecording = useCallback(() => {
    if (isStoppedRef.current) return;
    isStoppedRef.current = true;
    scriptProcessorRef.current?.disconnect(); scriptProcessorRef.current = null;
    audioContextRef.current?.close(); audioContextRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null;
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    processRecording(chunks);
  }, [processRecording]);

  // 点击麦克风
  const handleMicClick = useCallback(() => {
    if (isLoading) return;
    if (isListening) stopRecording();
    else startRecording();
  }, [isListening, isLoading, startRecording, stopRecording]);

  // 关闭视频
  const closeVideo = useCallback(() => {
    setPlayingVideo(null);
    setPhase("idle");
    setRecognizedText("");
  }, []);

  // 历史记录点击 → 直接播放第一条视频
  const playFromHistory = useCallback((conv: Conversation) => {
    setShowHistory(false);
    if (conv.videos && conv.videos.length > 0) {
      setRecognizedText(conv.question);
      setPlayingVideo(conv.videos[0]);
      setPhase("playing");
    } else {
      showToast("该记录无视频");
    }
  }, [showToast]);

  // 阶段文案
  const phaseText = {
    idle: "点击开始说话",
    listening: "正在聆听…再次点击停止",
    processing: recognizedText ? `"${recognizedText}"` : "识别中…",
    playing: "",
  }[phase];

  return (
    <div className="h-screen bg-gradient-to-b from-[#0a0f1a] via-[#0d1628] to-[#0a0f1a] flex flex-col overflow-hidden select-none">
      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}

      {/* 顶栏 */}
      <header className="flex items-center justify-between px-5 py-4 z-10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
            <span className="text-white text-xs font-bold">H</span>
          </div>
          <span className="text-white/80 text-sm font-medium tracking-wide">Hospeech</span>
        </div>
        {conversations.length > 0 && (
          <button onClick={() => setShowHistory(!showHistory)} className={`p-2 rounded-xl transition-all ${showHistory ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/10"}`}>
            {Icon.history("w-5 h-5")}
          </button>
        )}
      </header>

      {/* 历史侧栏 */}
      <div className={`fixed inset-0 z-30 transition-all duration-300 ${showHistory ? "visible" : "invisible"}`}>
        <div className={`absolute inset-0 bg-black/50 transition-opacity duration-300 ${showHistory ? "opacity-100" : "opacity-0"}`} onClick={() => setShowHistory(false)} />
        <aside className={`absolute top-0 right-0 h-full w-80 bg-[#111827]/98 backdrop-blur-xl border-l border-white/10 transition-transform duration-300 ease-out flex flex-col ${showHistory ? "translate-x-0" : "translate-x-full"}`}>
          <div className="flex items-center justify-between p-4 border-b border-white/8">
            <span className="text-white/80 text-sm font-medium">历史记录</span>
            <div className="flex items-center gap-2">
              {conversations.length > 0 && (
                <button onClick={() => setConversations([])} className="text-white/30 hover:text-red-400 transition-colors p-1">
                  {Icon.trash("w-4 h-4")}
                </button>
              )}
              <button onClick={() => setShowHistory(false)} className="text-white/40 hover:text-white/80 p-1 transition-colors">
                {Icon.x("w-4 h-4")}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {conversations.map(c => (
              <button key={c.id} onClick={() => playFromHistory(c)} className="w-full text-left p-3 rounded-xl hover:bg-white/8 transition-colors group">
                <p className="text-white/70 text-xs leading-relaxed line-clamp-2 group-hover:text-white/90 transition-colors">{c.question}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-[10px] text-white/25">{new Date(c.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                  {c.videos && c.videos.length > 0 && <span className="text-[10px] text-emerald-400/70">{c.videos.length} 视频</span>}
                </div>
              </button>
            ))}
          </div>
        </aside>
      </div>

      {/* 主内容 */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative">
        {/* 识别文字（processing 时显示在按钮上方） */}
        {phase === "processing" && (
          <div className="mb-10 text-center animate-[fadeIn_0.3s_ease-out]">
            {recognizedText ? (
              <>
                <p className="text-white/90 text-lg font-light mb-3">&ldquo;{recognizedText}&rdquo;</p>
                <div className="flex items-center justify-center gap-2 text-white/40 text-xs">
                  {Icon.spinner("w-3.5 h-3.5")}
                  <span>正在匹配视频</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center gap-2 text-white/40 text-xs">
                {Icon.spinner("w-3.5 h-3.5")}
                <span>识别中</span>
              </div>
            )}
          </div>
        )}

        {/* 麦克风按钮 */}
        <button
          onClick={handleMicClick}
          disabled={isLoading && phase !== "listening"}
          className={`relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500 ease-out outline-none focus:outline-none ${
            phase === "listening"
              ? "bg-red-500/20 ring-2 ring-red-400/50 scale-110"
              : phase === "processing"
              ? "bg-white/5 scale-95 opacity-60"
              : "bg-white/8 hover:bg-white/12 hover:scale-105 active:scale-95"
          }`}
        >
          {/* 录音时呼吸光环 */}
          {phase === "listening" && (
            <>
              <div className="absolute inset-0 rounded-full bg-red-400/20 animate-ping" />
              <div className="absolute -inset-3 rounded-full border border-red-400/20 animate-pulse" />
            </>
          )}

          {/* 图标 */}
          {phase === "listening" ? (
            Icon.stop("w-8 h-8 text-red-400")
          ) : phase === "processing" ? (
            Icon.spinner("w-8 h-8 text-white/40")
          ) : (
            Icon.mic("w-10 h-10 text-white/70")
          )}
        </button>

        {/* 底部提示文字 */}
        <div className="mt-8 text-center min-h-[2rem]">
          {phaseText && (
            <p className={`text-sm transition-all duration-300 ${
              phase === "listening" ? "text-red-400/70" : phase === "processing" ? "text-white/50" : "text-white/30"
            }`}>
              {phaseText}
            </p>
          )}
        </div>

        {/* 声波动画 */}
        {phase === "listening" && (
          <div className="mt-6 flex items-end justify-center gap-[3px] h-8">
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <span
                key={i}
                className="w-[3px] bg-red-400/50 rounded-full animate-[wave_0.8s_ease-in-out_infinite]"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        )}

        {/* 历史计数 */}
        {conversations.length > 0 && phase === "idle" && (
          <p className="mt-10 text-[11px] text-white/15">{conversations.length} 条记录</p>
        )}
      </main>

      {/* 全屏视频 */}
      {playingVideo && <VideoOverlay video={playingVideo} onClose={closeVideo} />}
    </div>
  );
}
