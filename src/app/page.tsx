"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

// ============================================
// 类型定义
// ============================================
interface UserIdentity {
  userId: string;
  name: string;
  department?: string;
  avatar?: string;
  hospitalName?: string;
  hospitalId?: string;
  deptId?: string;
}

interface StaffContact {
  id: string;
  name: string;
  title: string;
  avatar: string;
  department: string;
  hospitalId: string;
  hospitalName: string;
  hospitalShortName: string;
  deptId: string;
}

interface DepartmentGroup {
  deptName: string;
  hospitalName: string;
  hospitalShortName: string;
  contacts: StaffContact[];
}

type Phase =
  | "idle" | "listening" | "processing" | "reply"
  | "calling" | "ringing" | "incall" | "ended";

interface Conversation {
  id: string;
  question: string;
  answer: string;
  contact?: StaffContact | null;
}

// ============================================
// WebRTC 工具
// ============================================
const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
function createPeerConnection() { return new RTCPeerConnection(ICE_SERVERS); }

const SIGNAL_POLL_INTERVAL = 500;

// ============================================
// 主组件
// ============================================
export default function HomePage() {
  const router = useRouter();

  const [user, setUser] = useState<UserIdentity | null>(null);
  const [contactGroups, setContactGroups] = useState<DepartmentGroup[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [convos, setConvos] = useState<Conversation[]>([]);
  const [recognizedText, setRecognizedText] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [targetContact, setTargetContact] = useState<StaffContact | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const isStoppedRef = useRef(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const callIdRef = useRef<string>("");
  const signalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callRoleRef = useRef<"caller" | "callee">("caller");
  const inboundCallIdRef = useRef<string>(""); // 来电 callId，等待用户点击接听
  const isHangingUpRef = useRef(false); // 防重入
  const ringBgmRef = useRef<HTMLAudioElement | null>(null); // 呼叫等待 BGM

  // 初始化：加载当前医生 & 全院通讯录
  useEffect(() => {
    const stored = localStorage.getItem("auth_user");
    if (stored) {
      try {
        const u = JSON.parse(stored) as UserIdentity;
        setUser(u);
        // 加载所有医护人员（含医院信息）
        fetch("/api/auth?list=all-staff-full")
          .then((r) => r.json())
          .then((d) => {
            if (d.staff) {
              const staff: StaffContact[] = d.staff;
              // 排除自己
              const others = staff.filter((s) => s.id !== u.userId);
              // 按医院+科室分组
              const groups = new Map<string, DepartmentGroup>();
              for (const s of others) {
                const key = `${s.hospitalId}__${s.department}`;
                if (!groups.has(key)) {
                  groups.set(key, {
                    deptName: s.department,
                    hospitalName: s.hospitalName,
                    hospitalShortName: s.hospitalShortName,
                    contacts: [],
                  });
                }
                groups.get(key)!.contacts.push(s);
              }
              setContactGroups(Array.from(groups.values()));
            }
          })
          .catch(() => {});
      } catch {}
    }
    setAuthChecked(true);
  }, []);

  // 未登录跳转
  useEffect(() => {
    if (authChecked && !user) router.replace("/login");
  }, [authChecked, user, router]);

  // 呼叫 / 响铃时播放 BGM，接通或结束时停止
  useEffect(() => {
    const audio = ringBgmRef.current;
    if (!audio) return;
    if (phase === "ringing" || phase === "calling") {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [phase]);

  // 主页面轮询等待来电（不自动接听，等待用户点击）
  useEffect(() => {
    if (!user || phase !== "idle") return;
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/call");
        const data = await res.json();
        const pending: any[] = data.pending || [];
        const myCalls = pending.filter(
          (c) => c.targetContact?.id === user.userId && (c.status === "waiting" || c.status === "ringing")
        );
        if (myCalls.length > 0) {
          const call = myCalls[0];
          // 保存来电信息，等用户点击接听后再调 answerIncomingCall
          inboundCallIdRef.current = call.callId;
          callIdRef.current = call.callId;
          callRoleRef.current = "callee";
          setIsVideoCall(call.callType === "video");
          const incomingContact: StaffContact = {
            id: call.callerId,
            name: call.callerName,
            title: "",
            avatar: call.callerName?.slice(0, 1) || "?",
            department: call.callerDepartment || "",
            hospitalId: "",
            hospitalName: call.callerHospitalName || "",
            hospitalShortName: call.callerHospitalName || "",
            deptId: "",
          };
          setTargetContact(incomingContact);
          setPhase("ringing");
          // 停掉轮询，等用户操作
          if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
        }
      } catch {}
    }, 1500);
    return () => {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, [user, phase]);

  const logout = async () => {
    const token = localStorage.getItem("auth_token");
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-token": token || "" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {}
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    router.replace("/login");
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const cleanupWebRTC = useCallback(() => {
    if (signalTimerRef.current) { clearInterval(signalTimerRef.current); signalTimerRef.current = null; }
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
    if (remoteStreamRef.current) { remoteStreamRef.current.getTracks().forEach((t) => t.stop()); remoteStreamRef.current = null; }
    // 只清理 DOM 属性，不把 ref 置 null（否则后续 ontrack 拿不到元素导致连接断开）
    if (remoteAudioRef.current) { remoteAudioRef.current.pause(); remoteAudioRef.current.srcObject = null; }
  }, []);

  const recordedSampleRateRef = useRef(16000); // 存储实际录音采样率

  // --- 重采样：从实际采样率降到 16000Hz ---
  const resampleTo16k = (chunks: Float32Array[], fromRate: number): Float32Array[] => {
    if (fromRate === 16000) return chunks;
    // 将所有 chunk 拼接为一个连续数组
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.length; }
    // 线性插值重采样
    const ratio = fromRate / 16000;
    const newLen = Math.floor(totalLen / ratio);
    const result = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const srcIdx = i * ratio;
      const srcFloor = Math.floor(srcIdx);
      const srcCeil = Math.min(srcFloor + 1, totalLen - 1);
      const frac = srcIdx - srcFloor;
      result[i] = merged[srcFloor] * (1 - frac) + merged[srcCeil] * frac;
    }
    return [result];
  };

  // --- 录音 ---
  const startRecording = useCallback(async () => {
    try {
      isStoppedRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mediaStreamRef.current = stream;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      // 使用浏览器实际采样率（通常 44100 或 48000），后续重采样到 16kHz
      recordedSampleRateRef.current = ctx.sampleRate;
      console.log("录音采样率:", ctx.sampleRate, "Hz");
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = processor;
      pcmChunksRef.current = [];
      processor.onaudioprocess = (e) => {
        if (isStoppedRef.current) return;
        pcmChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      setPhase("listening");
      setRecognizedText("");
    } catch { showToast("无法访问麦克风，请检查权限"); }
  }, [showToast]);

  const stopRecording = useCallback(() => {
    isStoppedRef.current = true;
    if (scriptProcessorRef.current) { scriptProcessorRef.current.disconnect(); scriptProcessorRef.current = null; }
    if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null; }
    if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach((t) => t.stop()); mediaStreamRef.current = null; }
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    if (!chunks.length) { setPhase("idle"); return; }
    setPhase("processing");
    // 重采样到 16000Hz 再发给百度语音识别
    const resampled = resampleTo16k(chunks, recordedSampleRateRef.current);
    processAudio(resampled);
  }, []);

  const float32ToWav = (channels: Float32Array[], sampleRate: number) => {
    const totalLength = channels.reduce((s, c) => s + c.length, 0);
    const buffer = new ArrayBuffer(44 + totalLength * 2);
    const view = new DataView(buffer);
    const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF"); view.setUint32(4, 36 + totalLength * 2, true); writeStr(8, "WAVE");
    writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    writeStr(36, "data"); view.setUint32(40, totalLength * 2, true);
    let offset = 44;
    for (const ch of channels) {
      for (let j = 0; j < ch.length; j++) {
        const s = Math.max(-1, Math.min(1, ch[j]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
      }
    }
    return new Blob([buffer], { type: "audio/wav" });
  };

  // 音频增益（移动端麦克风音量偏小，需要放大）
  const amplifyAudio = (chunks: Float32Array[], gain: number): Float32Array[] => {
    return chunks.map((ch) => {
      const out = new Float32Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        out[i] = Math.max(-1, Math.min(1, ch[i] * gain));
      }
      return out;
    });
  };

  const processAudio = async (chunks: Float32Array[]) => {
    try {
      // 计算音频 RMS 电平用于调试
      let sumSq = 0, totalSamples = 0;
      for (const c of chunks) { for (let i = 0; i < c.length; i++) { sumSq += c[i] * c[i]; } totalSamples += c.length; }
      const rms = Math.sqrt(sumSq / totalSamples);
      console.log(`音频 RMS: ${(rms * 100).toFixed(2)}%, 总采样: ${totalSamples}, ${(totalSamples / 16000).toFixed(1)}s`);

      // 如果音频太短（< 0.5 秒），很可能是误触，不做识别
      const duration = totalSamples / 16000;
      if (duration < 0.5) {
        showToast("录音时间太短，请长按说话");
        setPhase("idle");
        return;
      }

      // 自动增益：RMS < 5% 时放大到 20% 左右
      let amplified = chunks;
      if (rms < 0.05 && rms > 0.001) {
        const gain = Math.min(10, 0.20 / rms);
        amplified = amplifyAudio(chunks, gain);
        console.log(`应用音频增益: ${gain.toFixed(1)}x`);
      }

      // 重采样后始终以 16000 编码 WAV
      const wav = float32ToWav(amplified, 16000);
      const form = new FormData();
      form.append("audio", wav, "audio.wav");
      const res = await fetch("/api/speech-to-text", { method: "POST", body: form });
      const data = await res.json();
      if (!data.success || !data.text) { showToast(data.error || "语音识别失败，请大声清晰说话"); setPhase("idle"); return; }
      setRecognizedText(data.text.trim());
      await chatWithAI(data.text.trim());
    } catch { showToast("语音识别服务异常"); setPhase("idle"); }
  };

  const chatWithAI = async (text: string) => {
    try {
      const history = convos.slice(0, 3).map((c) => ({ role: "user" as const, content: c.question }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          callerName: user?.name || "",
          callerDepartment: user?.department || "",
        }),
      });
      const data = await res.json();
      setAiAnswer(data.answer);

      const convo: Conversation = {
        id: `conv-${Date.now()}`,
        question: text,
        answer: data.answer,
        contact: data.contact || null,
      };
      setConvos((prev) => [convo, ...prev]);

      if (data.action === "call" && data.contact) {
        const fullContact: StaffContact = {
          id: data.contact.id,
          name: data.contact.name,
          title: data.contact.title,
          avatar: data.contact.avatar,
          department: data.contact.department,
          hospitalId: data.contact.hospitalId || "",
          hospitalName: data.contact.hospitalName || "",
          hospitalShortName: data.contact.hospitalShortName || "",
          deptId: data.contact.deptId || "",
        };
        setTargetContact(fullContact);
        callRoleRef.current = "caller";
        setIsVideoCall(true);
        const callRes = await fetch("/api/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            callType: "video",
            callerId: user?.userId || "unknown",
            callerName: user?.name || "",
            callerDepartment: user?.department || "",
            callerHospitalName: user?.hospitalName || "",
            contact: fullContact,
          }),
        });
        const callData = await callRes.json();
        callIdRef.current = callData.callId;
        setPhase("calling");
        await establishCall(fullContact, true);
      } else {
        setPhase("reply");
      }
    } catch {
      setAiAnswer("抱歉，系统暂时出现问题，请稍后再试。");
      setPhase("reply");
    }
  };

  // 直接拨号（从通讯录）
  const directCall = async (contact: StaffContact) => {
    setShowContacts(false);
    setTargetContact(contact);
    callRoleRef.current = "caller";
    setIsVideoCall(true);
    const convo: Conversation = {
      id: `conv-${Date.now()}`,
      question: `呼叫 ${contact.name}`,
      answer: `正在呼叫${contact.name}（${contact.hospitalShortName} ${contact.department}）...`,
      contact,
    };
    setConvos((prev) => [convo, ...prev]);
    const callRes = await fetch("/api/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        callType: "video",
        callerId: user?.userId || "unknown",
        callerName: user?.name || "",
        callerDepartment: user?.department || "",
        callerHospitalName: user?.hospitalName || "",
        contact,
      }),
    });
    const callData = await callRes.json();
    callIdRef.current = callData.callId;
    setPhase("calling");
    await establishCall(contact, true);
  };

  // 被叫端：接听并建立 WebRTC 视频连接（需用户手势触发）
  const answerIncomingCall = async (incomingCallId: string) => {
    try {
      cleanupWebRTC();

      // 先尝试获取媒体流，使用宽松约束（true）兼容更多设备
      let localStream: MediaStream;
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch (mediaErr: any) {
        console.error("getUserMedia 失败:", mediaErr.name, mediaErr.message);
        if (mediaErr.name === "NotFoundError" || mediaErr.name === "DevicesNotFoundError") {
          showToast("未检测到摄像头或麦克风设备");
        } else if (mediaErr.name === "NotAllowedError") {
          showToast("麦克风/摄像头权限被拒绝，请在浏览器设置中允许");
        } else if (mediaErr.name === "NotReadableError") {
          showToast("摄像头/麦克风被其他应用占用");
        } else {
          // 可能是 HTTP 环境导致的安全限制
          showToast("获取媒体设备失败，请确认使用 HTTPS 访问页面");
        }
        hangup();
        return;
      }

      localStreamRef.current = localStream;
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;

      const pc = createPeerConnection();
      pcRef.current = pc;
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0];
        if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = e.streams[0]; remoteAudioRef.current.play().catch(() => {}); }
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
      };

      pc.onicecandidate = (e) => { if (e.candidate) sendSignal("ice-candidate", e.candidate); };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") startCallTimer();
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") hangup();
      };

      // 标记接听
      fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", callId: incomingCallId }),
      }).catch(() => {});

      // 轮询等待 caller 发来的 offer 和 ice-candidates
      signalTimerRef.current = setInterval(async () => {
        const events = await fetchSignals("callee");
        for (const ev of events) {
          if (ev.type === "offer") {
            if (!pcRef.current) return;
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(ev.data));
            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);
            sendSignal("answer", answer);
          } else if (ev.type === "ice-candidate") {
            try { if (pcRef.current) await pcRef.current.addIceCandidate(new RTCIceCandidate(ev.data)); } catch {}
          } else if (ev.type === "call-ended") {
            if (signalTimerRef.current) clearInterval(signalTimerRef.current);
            hangup();
          }
        }
      }, SIGNAL_POLL_INTERVAL);
    } catch (err: any) {
      console.error("接听异常:", err);
      showToast("接听失败，请重试");
      hangup();
    }
  };

  const establishCall = async (contact: { id: string; name: string; avatar: string; department: string }, video: boolean) => {
    try {
      cleanupWebRTC();
      const constraints: MediaStreamConstraints = video ? { audio: true, video: true } : { audio: true, video: false };
      const localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = localStream;
      if (video && localVideoRef.current) localVideoRef.current.srcObject = localStream;
      const pc = createPeerConnection();
      pcRef.current = pc;
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0];
        if (remoteAudioRef.current) { remoteAudioRef.current.srcObject = e.streams[0]; remoteAudioRef.current.play().catch(() => {}); }
        if (video && remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
      };
      pc.onicecandidate = (e) => { if (e.candidate) sendSignal("ice-candidate", e.candidate); };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") startCallTimer();
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") hangup();
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal("offer", offer);
      signalTimerRef.current = setInterval(async () => {
        const events = await fetchSignals("caller");
        for (const ev of events) {
          if (ev.type === "answer") {
            await pc.setRemoteDescription(new RTCSessionDescription(ev.data));
          } else if (ev.type === "ice-candidate") {
            try { await pc.addIceCandidate(new RTCIceCandidate(ev.data)); } catch {}
          } else if (ev.type === "call-ended") {
            if (signalTimerRef.current) clearInterval(signalTimerRef.current);
            hangup();
          }
        }
      }, SIGNAL_POLL_INTERVAL);
      fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ringing", callId: callIdRef.current }),
      });
      setPhase("ringing");
    } catch {
      showToast("呼叫失败，请重试");
      hangup();
    }
  };

  const sendSignal = async (type: string, data: unknown) => {
    try {
      await fetch("/api/signal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, callId: callIdRef.current, data, fromRole: callRoleRef.current }) });
    } catch {}
  };

  const fetchSignals = async (_role: "caller" | "callee"): Promise<{ type: string; data: any }[]> => {
    try {
      const res = await fetch(`/api/signal?callId=${callIdRef.current}&role=${_role}`);
      if (!res.ok) return [];
      const json = await res.json();
      return json.messages || [];
    } catch { return []; }
  };

  const startCallTimer = useCallback(() => {
    if (callTimerRef.current) return;
    setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    setPhase("incall");
  }, []);

  const formatDuration = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

  // 主叫页手动接听来电（由用户点击触发 → 有用户手势 → 权限通过）
  const handleAnswerIncoming = useCallback(() => {
    if (!inboundCallIdRef.current) return;
    answerIncomingCall(inboundCallIdRef.current);
  }, []);

  const hangup = useCallback(() => {
    // 防重入：防止 pc.close() 触发 onconnectionstatechange 再次调用 hangup
    if (isHangingUpRef.current) return;
    isHangingUpRef.current = true;
    inboundCallIdRef.current = "";
    
    // 立即切换 UI，不等待网络请求
    setPhase("ended");
    
    // 先停轮询，再关 PC，避免 close 触发回调死循环
    if (signalTimerRef.current) { clearInterval(signalTimerRef.current); signalTimerRef.current = null; }
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    
    try {
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
      if (localStreamRef.current) { localStreamRef.current.getTracks().forEach((t) => t.stop()); localStreamRef.current = null; }
      if (remoteStreamRef.current) { remoteStreamRef.current.getTracks().forEach((t) => t.stop()); remoteStreamRef.current = null; }
      // 只清理 DOM 属性，不把 ref 置 null
      if (remoteAudioRef.current) { remoteAudioRef.current.pause(); remoteAudioRef.current.srcObject = null; }
    } catch (e) {
      console.error("hangup cleanup error:", e);
    }
    
    // 异步通知对方
    if (callIdRef.current) {
      sendSignal("call-ended", null).catch(() => {});
      fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", callId: callIdRef.current }),
      }).catch(() => {});
    }
    
    isHangingUpRef.current = false;
  }, []);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const t = localStreamRef.current.getAudioTracks()[0];
      if (t) { t.enabled = isMuted; setIsMuted(!isMuted); }
    }
  };

  const toggleSpeaker = () => setIsSpeakerOn(!isSpeakerOn);
  const toggleVideo = async () => {
    if (isVideoCall) {
      // 停止并从 stream 中移除所有视频轨道
      const stream = localStreamRef.current;
      if (stream) {
        stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
        // 通过 PC sender 告知对方视频已关闭
        const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(null);
      }
      setIsVideoCall(false);
    }
    else {
      try {
        const vs = await navigator.mediaDevices.getUserMedia({ video: true });
        if (pcRef.current && vs.getVideoTracks().length > 0) {
          const newVideoTrack = vs.getVideoTracks()[0];
          // 清理 localStream 中残留的旧视频轨道
          if (localStreamRef.current) {
            localStreamRef.current.getVideoTracks().forEach((t) => localStreamRef.current!.removeTrack(t));
            localStreamRef.current.addTrack(newVideoTrack);
          }
          // 告知对方视频恢复
          const sender = pcRef.current.getSenders().find((s) => s.track?.kind === "video");
          if (sender) sender.replaceTrack(newVideoTrack);
          else pcRef.current.addTrack(newVideoTrack, localStreamRef.current!);
          // 先置空再赋值，强制 video 元素刷新
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
            localVideoRef.current.srcObject = localStreamRef.current;
          }
        }
        setIsVideoCall(true);
      } catch { showToast("无法打开摄像头"); }
    }
  };

  const goIdle = () => { hangup(); setPhase("idle"); setRecognizedText(""); setAiAnswer(""); setTargetContact(null); setCallDuration(0); setIsVideoCall(false); setIsMuted(false); };

  // 所有 Hooks 必须在 early return 之前调用，确保每次渲染 Hook 数量和顺序一致
  const audioRefCallback = useCallback((el: HTMLAudioElement | null) => { remoteAudioRef.current = el; }, []);
  const ringBgmCallback = useCallback((el: HTMLAudioElement | null) => { ringBgmRef.current = el; }, []);
  const localVideoRefCallback = useCallback((el: HTMLVideoElement | null) => { localVideoRef.current = el; }, []);
  const remoteVideoRefCallback = useCallback((el: HTMLVideoElement | null) => { remoteVideoRef.current = el; }, []);

  if (!authChecked || !user) {
    return (
      <main className="h-screen bg-gradient-to-b from-gray-900 via-gray-950 to-black flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </main>
    );
  }

  return (
    <main className="h-dvh bg-gradient-to-b from-gray-900 via-gray-950 to-black text-white flex flex-col overflow-hidden">
      <audio ref={ringBgmCallback} src="/ringtone.mp3" loop preload="auto" className="hidden" />
      <audio ref={audioRefCallback} autoPlay playsInline className="hidden" />

      {/* Toast */}
      {toast && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-red-500/90 text-white px-5 py-2.5 rounded-xl text-sm font-medium shadow-lg animate-slide-down">
          {toast}
        </div>
      )}

      {/* ======== 联系人面板 ======== */}
      {showContacts && (
        <div className="fixed inset-0 z-40 bg-black/70 animate-overlay-in" onClick={() => setShowContacts(false)}>
          <div className="absolute bottom-0 left-0 right-0 bg-gray-900 rounded-t-3xl p-5 max-h-[75vh] overflow-y-auto animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 sticky top-0 bg-gray-900 pb-2 z-10">
              <h3 className="text-base font-semibold">全院医护通讯录</h3>
              <button onClick={() => setShowContacts(false)} className="text-gray-400 hover:text-white text-xl">&times;</button>
            </div>
            <div className="space-y-4">
              {contactGroups.map((group) => (
                <div key={`${group.hospitalName}__${group.deptName}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">{group.hospitalShortName}</span>
                    <span className="text-xs text-gray-400">{group.deptName}</span>
                  </div>
                  <div className="space-y-1.5">
                    {group.contacts.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => directCall(c)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-left"
                      >
                        <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-sm font-bold">
                          {c.avatar}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white">{c.name}</div>
                          <div className="text-[11px] text-gray-400">{c.title}</div>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.358 1.85.593 2.81.72A2 2 0 0122 16.92z" />
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ======== 空闲 / 对话 ======== */}
      {(phase === "idle" || phase === "listening" || phase === "processing" || phase === "reply") && (
        <div className="flex-1 flex flex-col">
          <Header
            user={user}
            onShowContacts={() => setShowContacts(true)}
            onLogout={logout}
          />
          <ConversationArea convos={convos} recognizedText={recognizedText} aiAnswer={aiAnswer} phase={phase} user={user} />
          <MicButton
            phase={phase}
            onStart={startRecording}
            onStop={stopRecording}
            onContinue={() => setPhase("idle")}
            onContacts={() => setShowContacts(true)}
          />
        </div>
      )}

      {/* ======== 呼叫中 / 响铃 / 通话中 ======== */}
      {(phase === "calling" || phase === "ringing" || phase === "incall") && (
        <CallScreen
          phase={phase}
          contact={targetContact}
          duration={formatDuration(callDuration)}
          isMuted={isMuted}
          isSpeakerOn={isSpeakerOn}
          isVideoCall={isVideoCall}
          localVideoRef={localVideoRefCallback}
          remoteVideoRef={remoteVideoRefCallback}
          onToggleMute={toggleMute}
          onToggleSpeaker={toggleSpeaker}
          onToggleVideo={toggleVideo}
          onHangup={hangup}
          onAnswer={handleAnswerIncoming}
          isIncoming={callRoleRef.current === "callee"}
          callerName={user?.name || ""}
          callerDept={user?.department || ""}
        />
      )}

      {/* ======== 结束 ======== */}
      {phase === "ended" && (
        <CallEndedScreen contact={targetContact} duration={formatDuration(callDuration)} onBack={goIdle} />
      )}
    </main>
  );
}

// ============================================
// Header
// ============================================
function Header({ user, onShowContacts, onLogout }: {
  user: UserIdentity; onShowContacts: () => void; onLogout: () => void;
}) {
  return (
    <div className="px-4 py-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-xs">H</div>
          <span className="font-semibold text-sm">Hospeech</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">医护端</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onShowContacts} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs text-gray-300 transition-all">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
            科室通讯
          </button>
          <button onClick={onLogout} className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-all">退出</button>
        </div>
      </div>
      <div className="flex items-center gap-2 px-1">
        <div className="w-6 h-6 rounded-full bg-blue-500/30 flex items-center justify-center text-[10px] font-bold text-blue-400">
          {user.name.slice(0, 1)}
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm text-white font-medium">{user.name}</span>
          {user.department && <span className="text-xs text-gray-400">{user.department}</span>}
          {user.hospitalName && <span className="text-[10px] text-gray-500">{user.hospitalName}</span>}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">
            {user.department?.slice(0, 4) || "医护"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// 对话区域
// ============================================
function ConversationArea({ convos, recognizedText, aiAnswer, phase, user }: {
  convos: Conversation[]; recognizedText: string; aiAnswer: string; phase: Phase; user: UserIdentity | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [convos, recognizedText, aiAnswer]);

  if (convos.length === 0 && !recognizedText) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-14 h-14 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
        <h2 className="text-base font-medium text-white mb-1">{user ? `${user.name} 医生，你好` : "你好"}</h2>
        <p className="text-xs text-gray-400 leading-relaxed">
          点击 <span className="text-blue-400 font-medium">科室通讯</span> 可拨号给任何科室的医生<br />长按麦克风说出医生姓名也可快速呼叫
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {convos.map((c) => (
        <div key={c.id} className="animate-fade-in">
          <div className="flex justify-end mb-2">
            <div className="max-w-[80%] bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
              <div className="text-[10px] text-blue-200 mb-0.5">{user?.name || "我"}</div>
              {c.question}
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-white/10 text-gray-100 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm">
              {c.answer}
              {c.contact && (
                <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold">{c.contact.avatar}</div>
                  <div>
                    <div className="text-xs font-medium">{c.contact.name}</div>
                    <div className="text-[10px] text-gray-400">{c.contact.hospitalShortName} · {c.contact.department}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
      {phase === "processing" && recognizedText && (
        <div className="flex justify-end mb-2">
          <div className="max-w-[80%] bg-blue-600/70 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
            <div className="text-[10px] text-blue-200 mb-0.5">{user?.name || "我"}</div>
            {recognizedText}
          </div>
        </div>
      )}
      {phase === "processing" && (
        <div className="flex justify-start">
          <div className="bg-white/10 rounded-2xl rounded-bl-md px-4 py-2.5 flex items-center gap-2">
            <Spinner /><span className="text-sm text-gray-300">识别中...</span>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

// ============================================
// 麦克风按钮
// ============================================
function MicButton({ phase, onStart, onStop, onContinue, onContacts }: {
  phase: Phase; onStart: () => void; onStop: () => void; onContinue: () => void; onContacts: () => void;
}) {
  const isActive = phase === "listening";
  const isProcessing = phase === "processing";

  return (
    <div className="pb-3 pt-1 flex flex-col items-center gap-2.5">
      {phase === "idle" && (
        <button onClick={onContacts} className="text-xs text-gray-400 hover:text-blue-400 transition-all flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="9" cy="7" r="4" />
          </svg>
          或从科室通讯拨号
        </button>
      )}
      <button
        onMouseDown={onStart} onMouseUp={onStop} onMouseLeave={isActive ? onStop : undefined}
        onTouchStart={(e) => { e.preventDefault(); onStart(); }}
        onTouchEnd={(e) => { e.preventDefault(); onStop(); }}
        disabled={isProcessing}
        className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 select-none touch-manipulation ${
          isActive ? "bg-red-500 scale-110 shadow-lg shadow-red-500/40" :
          isProcessing ? "bg-gray-600 scale-90 opacity-60" :
          "bg-blue-500 hover:bg-blue-400 shadow-lg shadow-blue-500/30"
        }`}
      >
        {isActive && (
          <>
            <div className="absolute inset-0 rounded-full animate-ping bg-red-500/30" />
            <div className="absolute inset-0 rounded-full border-2 border-red-400/50 animate-pulse" />
          </>
        )}
        <MicIcon active={isActive} />
      </button>
      <p className="text-xs text-gray-400">{isActive ? "正在聆听...松手停止" : isProcessing ? "识别中..." : "长按说话"}</p>
      {phase === "reply" && (
        <button onClick={onContinue} className="text-xs text-blue-400 hover:text-blue-300 underline mt-1">继续对话</button>
      )}
    </div>
  );
}

// ============================================
// 呼叫界面
// ============================================
function CallScreen({ phase, contact, duration, isMuted, isSpeakerOn, isVideoCall, localVideoRef, remoteVideoRef, onToggleMute, onToggleSpeaker, onToggleVideo, onHangup, onAnswer, isIncoming, callerName, callerDept }: {
  phase: Phase; contact: StaffContact | null; duration: string; isMuted: boolean; isSpeakerOn: boolean; isVideoCall: boolean;
  localVideoRef: (el: HTMLVideoElement | null) => void; remoteVideoRef: (el: HTMLVideoElement | null) => void;
  onToggleMute: () => void; onToggleSpeaker: () => void; onToggleVideo: () => void; onHangup: () => void;
  onAnswer?: () => void; isIncoming?: boolean;
  callerName: string; callerDept: string;
}) {
  const isRinging = phase === "ringing";
  const isCalling = phase === "calling";
  const isInCall = phase === "incall";

  return (
    <div className="flex-1 flex flex-col bg-gray-950 relative">
      {isVideoCall && (
        <>
          <video ref={remoteVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
          <video ref={localVideoRef} autoPlay playsInline muted className="absolute top-4 right-4 w-28 h-40 rounded-xl object-cover border-2 border-white/30 shadow-lg z-10" />
        </>
      )}
      <div className={`flex-1 flex flex-col items-center justify-center ${isVideoCall ? "relative z-10 bg-black/30" : ""}`}>
        {contact && (
          <>
            <div className={`rounded-full flex items-center justify-center font-bold text-white mb-3 transition-all duration-500 ${
              isInCall ? "w-16 h-16 text-lg bg-blue-500/80" : "w-20 h-20 text-xl bg-blue-500"
            }`}>
              {isRinging && <div className="absolute inset-0 rounded-full animate-ping bg-blue-500/20" />}
              {contact.avatar}
            </div>
            <h2 className="text-lg font-semibold text-white mb-1">{contact.name}</h2>
            <p className="text-sm text-gray-400 mb-1">{contact.hospitalShortName} · {contact.department} · {contact.title}</p>
            <p className="text-xs text-gray-500 mb-4">
              呼叫方：{callerName}{callerDept ? `（${callerDept}）` : ""}
            </p>
          </>
        )}
        {isCalling && <div className="flex items-center gap-2 text-gray-300 text-sm mb-4"><Spinner small /> 正在呼叫...</div>}
        {isRinging && !isIncoming && <p className="text-gray-300 text-sm mb-4">等待对方接听...</p>}
        {isRinging && isIncoming && <p className="text-yellow-300 text-sm mb-4">视频来电...</p>}
        {isInCall && <p className="text-blue-400 text-lg font-mono mb-4">{duration}</p>}
      </div>
      <div className={`pb-6 pt-3 px-8 ${isVideoCall ? "relative z-10 bg-gradient-to-t from-black/80 to-transparent" : ""}`}>
        {isRinging && isIncoming && onAnswer && (
          <div className="flex items-center justify-center gap-10 mb-3">
            <button onClick={onHangup} className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/40 active:scale-95 transition-transform">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z" transform="rotate(135 12 12)" />
              </svg>
            </button>
            <button onClick={onAnswer} className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/40 active:scale-95 transition-transform animate-pulse">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.358 1.85.593 2.81.72A2 2 0 0122 16.92z" />
              </svg>
            </button>
          </div>
        )}
        {isInCall && (
          <div className="flex items-center justify-between max-w-xs mx-auto mb-3">
            <CallActionBtn icon={<MuteIcon />} label="静音" active={isMuted} onClick={onToggleMute} />
            <CallActionBtn icon={<SpeakerIcon />} label="免提" active={!isSpeakerOn} onClick={onToggleSpeaker} />
            <CallActionBtn icon={<VideoIcon />} label={isVideoCall ? "关视频" : "视频"} active={false} onClick={onToggleVideo} />
          </div>
        )}
        {/* 仅非来电响铃时显示单独挂断按钮（来电响铃时已有 拒绝/接听 按钮组） */}
        {(!isRinging || !isIncoming) && (
        <div className="flex justify-center">
          <button onClick={onHangup} className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg shadow-red-500/40 transition-all active:scale-95">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
              <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z" transform="rotate(135 12 12)" />
            </svg>
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

function CallActionBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${active ? "bg-white text-gray-900" : "bg-white/20 text-white"}`}>{icon}</div>
      <span className={`text-[11px] ${active ? "text-white" : "text-gray-400"}`}>{label}</span>
    </button>
  );
}

function CallEndedScreen({ contact, duration, onBack }: { contact: StaffContact | null; duration: string; onBack: () => void; }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 bg-gray-950">
      {contact && (
        <>
          <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center text-lg font-bold text-white mb-4">{contact.avatar}</div>
          <h2 className="text-lg font-semibold text-white mb-1">{contact.name}</h2>
          <p className="text-sm text-gray-400 mb-2">{contact.hospitalShortName} · {contact.department}</p>
        </>
      )}
      <p className="text-gray-300 text-sm mb-1">通话已结束</p>
      <p className="text-gray-500 text-xs mb-6">通话时长 {duration}</p>
      <button onClick={onBack} className="bg-white/10 hover:bg-white/20 text-white rounded-full px-8 py-3 text-sm font-medium transition-all">返回首页</button>
    </div>
  );
}

// ============================================
// 图标
// ============================================
function MicIcon({ active }: { active: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function Spinner({ small }: { small?: boolean }) {
  return (
    <svg className={`animate-spin ${small ? "w-4 h-4" : "w-5 h-5"} text-gray-400`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5L6 9H2v6h4l5 4V5z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}
