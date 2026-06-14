"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";

// ============================================
// 类型
// ============================================
interface UserIdentity {
  userId: string;
  name: string;
  department?: string;
  avatar?: string;
}

interface CallSession {
  callId: string;
  status: string;
  callerName: string;
  callerDepartment?: string;
  callerHospitalName?: string;
  callerId?: string;
  targetContact: {
    id: string;
    name: string;
    title: string;
    avatar: string;
    department: string;
  };
  callType: "voice" | "video";
  createdAt: number;
}

type Phase = "waiting" | "ringing" | "incall" | "ended" | "idle" | "loading";

// ============================================
// WebRTC
// ============================================
const ICE_SERVERS = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

// ============================================
// 被叫端主页（医生接听其他医生的来电）
// ============================================
export default function ReceiverPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<UserIdentity | null>(null);
  const [session, setSession] = useState<CallSession | null>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [isVideoCall, setIsVideoCall] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const signalPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const ringToneRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHangingUpRef = useRef(false);
  const ringBgmRef = useRef<HTMLAudioElement | null>(null);

  // ============================================
  // 初始化：检查登录状态
  // ============================================
  useEffect(() => {
    const stored = localStorage.getItem("auth_user");
    if (stored) {
      try {
        const u = JSON.parse(stored) as UserIdentity;
        setUser(u);
        setPhase("idle");
      } catch {
        router.replace("/login");
      }
    } else {
      router.replace("/login");
    }
  }, [router]);

  // 响铃时播放 BGM，接通或结束时停止
  useEffect(() => {
    const audio = ringBgmRef.current;
    if (!audio) return;
    if (phase === "ringing") {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [phase]);

  // 轮询等待来电 (只收匹配自己身份的)
  useEffect(() => {
    if (phase !== "idle" || !user) return;

    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/call");
        const data = await res.json();
        const pending: CallSession[] = data.pending || [];
        // 只接收 targetContact.id 匹配自己的来电
        const myCalls = pending.filter(
          (c: CallSession) => c.targetContact.id === user.userId && (c.status === "waiting" || c.status === "ringing")
        );
        if (myCalls.length > 0) {
          const ring = myCalls[0];
          setSession(ring);
          setPhase("ringing");
          playRingtone();
        }
      } catch {}
    }, 1500);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [phase, user]);

  // 播放响铃
  const playRingtone = () => {
    try {
      if (ringToneRef.current) return;
      const ctx = new AudioContext();
      const beep = () => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.frequency.value = 800;
        g.gain.value = 0.3;
        o.start();
        o.stop(ctx.currentTime + 0.3);
      };
      beep();
      ringToneRef.current = setInterval(beep, 2000) as unknown as ReturnType<typeof setInterval>;
    } catch {}
  };

  const stopRingtone = () => {
    if (ringToneRef.current) {
      clearInterval(ringToneRef.current);
      ringToneRef.current = null;
    }
  };

  // 登出
  const logout = async () => {
    stopRingtone();
    if (pcRef.current) pcRef.current.close();
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

  // 接听
  const answer = async (video: boolean) => {
    if (!session) return;
    stopRingtone();
    try {
      setIsVideoCall(video);

      const constraints: MediaStreamConstraints = video
        ? { audio: true, video: true }
        : { audio: true, video: false };
      const localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = localStream;

      if (video && localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

      pc.ontrack = (e) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = e.streams[0];
          remoteAudioRef.current.play().catch(() => {});
        }
        if (video && remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = e.streams[0];
        }
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          fetch("/api/signal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "ice-candidate",
              callId: session.callId,
              data: e.candidate,
              fromRole: "callee",
            }),
          }).catch(() => {});
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          startTimer();
        }
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          hangup();
        }
      };

      // 轮询等待对方信令（替代不存在的 SSE 端点）
      signalPollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/signal?callId=${session.callId}&role=callee`);
          if (!res.ok) return;
          const json = await res.json();
          const events = json.messages || [];
          for (const msg of events) {
            if (msg.type === "offer") {
              await pc.setRemoteDescription(new RTCSessionDescription(msg.data));
              const ans = await pc.createAnswer();
              await pc.setLocalDescription(ans);
              fetch("/api/signal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "answer",
                  callId: session.callId,
                  data: ans,
                  fromRole: "callee",
                }),
              }).catch(() => {});
            } else if (msg.type === "ice-candidate") {
              try { await pc.addIceCandidate(new RTCIceCandidate(msg.data)); } catch {}
            } else if (msg.type === "call-ended") {
              if (signalPollRef.current) { clearInterval(signalPollRef.current); signalPollRef.current = null; }
              hangup();
            }
          }
        } catch {}
      }, 500);

      fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", callId: session.callId }),
      }).catch(() => {});

      setPhase("incall");
    } catch {
      alert("接听失败，请检查麦克风权限");
      hangup();
    }
  };

  const startTimer = () => {
    if (callTimerRef.current) return;
    setCallDuration(0);
    callTimerRef.current = setInterval(() => {
      setCallDuration((d) => d + 1);
    }, 1000);
  };

  const hangup = useCallback(() => {
    if (isHangingUpRef.current) return;
    isHangingUpRef.current = true;
    
    stopRingtone();
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    if (signalPollRef.current) { clearInterval(signalPollRef.current); signalPollRef.current = null; }
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (session) {
      fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", callId: session.callId }),
      }).catch(() => {});
      fetch("/api/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "call-ended",
          callId: session.callId,
          data: null,
          fromRole: "callee",
        }),
      }).catch(() => {});
    }
    setPhase("ended");
    isHangingUpRef.current = false;
  }, [session]);

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
    } else {
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
      } catch {}
    }
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const backToIdle = () => {
    setPhase("idle");
    setSession(null);
    setCallDuration(0);
    setIsVideoCall(false);
    setIsMuted(false);
  };

  // ============================================
  // 加载中
  // ============================================
  if (phase === "loading") {
    return (
      <main className="h-screen bg-gradient-to-b from-gray-900 via-gray-950 to-black flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </main>
    );
  }



  // ============================================
  // 渲染
  // ============================================
  return (
    <main className="h-screen bg-gradient-to-b from-gray-900 via-gray-950 to-black text-white flex flex-col overflow-hidden">
      <audio ref={(el) => { ringBgmRef.current = el; }} src="/ringtone.mp3" loop preload="auto" className="hidden" />
      <audio ref={(el) => { remoteAudioRef.current = el; }} autoPlay playsInline className="hidden" />

      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-xs">
            {user?.avatar || "医"}
          </div>
          <div>
            <div className="font-semibold text-sm">{user?.name || "医护"}</div>
            <div className="text-xs text-gray-400">{user?.department || ""}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-all"
        >
          退出
        </button>
      </div>

      {/* 等待来电 */}
      {phase === "idle" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-blue-500/10 flex items-center justify-center mb-6">
            <div className="relative">
              <div className="w-3 h-3 rounded-full bg-blue-500 animate-ping absolute inset-0 m-auto" />
              <div className="w-3 h-3 rounded-full bg-blue-500" />
            </div>
          </div>
          <h2 className="text-lg font-medium text-white mb-2">等待来电</h2>
          <p className="text-sm text-gray-400">
            {user ? `${user.name} 医生，您好。当其他医生呼叫您时，这里会自动响铃。` : "等待其他医生的来电..."}
          </p>
        </div>
      )}

      {/* 来电 */}
      {phase === "ringing" && session && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="relative mb-6">
            <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center text-2xl font-bold text-white animate-ring-shake">
              <div className="absolute inset-0 rounded-full animate-ping bg-blue-500/20" />
              {session.targetContact.avatar}
            </div>
          </div>
          <h2 className="text-xl font-semibold mb-1">来电</h2>
          <p className="text-sm text-gray-300 mb-3">
            <span className="text-white font-medium">{session.callerName}</span>
            {session.callerDepartment && (
              <span className="text-gray-500"> · {session.callerDepartment}</span>
            )}
          </p>
          <p className="text-xs text-gray-500 mb-2">呼叫对象：{session.targetContact.name}</p>
          <p className="text-xs text-gray-500 mb-8">
            {session.callType === "voice" ? "语音通话" : "视频通话"}
          </p>

          <div className="flex items-center gap-10">
            <button
              onClick={hangup}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/30 active:scale-95 transition-transform">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                  <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z" transform="rotate(135 12 12)" />
                </svg>
              </div>
              <span className="text-xs text-gray-400">拒绝</span>
            </button>

            <button
              onClick={() => answer(true)}
              className="flex flex-col items-center gap-2"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 active:scale-95 transition-transform animate-pulse">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.358 1.85.593 2.81.72A2 2 0 0122 16.92z" />
                </svg>
              </div>
              <span className="text-xs text-emerald-400">视频接听</span>
            </button>
          </div>
        </div>
      )}

      {/* 通话中 */}
      {phase === "incall" && (
        <div className="flex-1 flex flex-col bg-gray-950 relative">
          {isVideoCall && (
            <>
              <video ref={(el) => { remoteVideoRef.current = el; }} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
              <video ref={(el) => { localVideoRef.current = el; }} autoPlay playsInline muted className="absolute top-4 right-4 w-28 h-40 rounded-xl object-cover border-2 border-white/30 z-10" />
            </>
          )}

          <div className={`flex-1 flex flex-col items-center justify-center ${isVideoCall ? "relative z-10 bg-black/30" : ""}`}>
            {session && (
              <>
                <div className="w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center text-xl font-bold text-white mb-4">
                  {session.targetContact.avatar}
                </div>
                <p className="text-xs text-gray-500 mb-1">与</p>
                <h2 className="text-lg font-semibold text-white">
                  {session.callerName}
                  {session.callerDepartment && (
                    <span className="text-sm text-gray-400 ml-1">({session.callerDepartment})</span>
                  )}
                </h2>
                <p className="text-sm text-gray-400 mt-2">通话中</p>
                <p className="text-blue-400 text-lg font-mono mt-2">{formatDuration(callDuration)}</p>
              </>
            )}
          </div>

          <div className={`pb-10 pt-4 px-8 ${isVideoCall ? "relative z-10 bg-gradient-to-t from-black/80 to-transparent" : ""}`}>
            <div className="flex items-center justify-between max-w-xs mx-auto mb-3">
              <ActionBtn icon={<MuteSvg />} label="静音" active={isMuted} onClick={toggleMute} />
              <ActionBtn icon={<SpeakerSvg />} label="免提" active={!isSpeakerOn} onClick={toggleSpeaker} />
              <ActionBtn icon={<VideoSvg />} label={isVideoCall ? "关视频" : "视频"} active={false} onClick={toggleVideo} />
            </div>
            <div className="flex justify-center">
              <button onClick={hangup} className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/40 active:scale-95 transition-transform">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                  <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z" transform="rotate(135 12 12)" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通话结束 */}
      {phase === "ended" && (
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          {session && (
            <>
              <div className="w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center text-xl font-bold text-white mb-4">
                {session.targetContact.avatar}
              </div>
              <p className="text-gray-300 text-sm mb-1">通话已结束</p>
              <p className="text-gray-400 text-xs mb-1">
                与 {session.callerName}{session.callerDepartment ? ` (${session.callerDepartment})` : ""}
              </p>
              <p className="text-gray-500 text-xs mb-10">时长 {formatDuration(callDuration)}</p>
            </>
          )}
          <button
            onClick={backToIdle}
            className="bg-white/10 hover:bg-white/20 text-white rounded-full px-8 py-3 text-sm font-medium transition-all"
          >
            返回等待
          </button>
        </div>
      )}
    </main>
  );
}

function ActionBtn({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${active ? "bg-white text-gray-900" : "bg-white/20 text-white"}`}>
        {icon}
      </div>
      <span className={`text-[11px] ${active ? "text-white" : "text-gray-400"}`}>{label}</span>
    </button>
  );
}

function MuteSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

function SpeakerSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function VideoSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}
