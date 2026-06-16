"use client";

import { useState, useRef, useEffect } from "react";

// ============================================
// 类型定义
// ============================================
interface Hospital {
  id: string;
  name: string;
  shortName: string;
  departments: Department[];
}

interface Department {
  id: string;
  name: string;
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

type Phase =
  | "idle"
  | "select-hospital"
  | "select-department"
  | "select-doctor"
  | "consulting";

// ============================================
// 主组件
// ============================================
export default function HomePage() {
  // 远程会诊流程状态
  const [phase, setPhase] = useState<Phase>("idle");
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [allStaff, setAllStaff] = useState<StaffContact[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<Hospital | null>(null);
  const [selectedDept, setSelectedDept] = useState<Department | null>(null);
  const [selectedDoctor, setSelectedDoctor] = useState<StaffContact | null>(null);
  const [deptDoctors, setDeptDoctors] = useState<StaffContact[]>([]);
  const [inputText, setInputText] = useState("");
  const [responseShown, setResponseShown] = useState(false);
  const [responseType, setResponseType] = useState<"audio" | "video" | "text">("text");

  // 媒体 ref
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // 检测本地媒体文件是否存在（优先 public，否则在线兜底）
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [mediaChecked, setMediaChecked] = useState(false);

  const FALLBACK_VIDEO = "https://www.w3schools.com/html/mov_bbb.mp4";

  useEffect(() => {
    const checkLocal = async (path: string) => {
      try {
        const r = await fetch(path, { method: "HEAD" });
        return r.ok ? path : null;
      } catch {
        return null;
      }
    };

    Promise.all([
      checkLocal("/emergency-response.mp3"),
      checkLocal("/respiratory-response.mp4"),
    ]).then(([localAudio, localVideo]) => {
      setAudioSrc(localAudio);
      setVideoSrc(localVideo || FALLBACK_VIDEO);
      setMediaChecked(true);
    });
  }, []);

  // 直接加载医院和人员数据（无需登录）
  useEffect(() => {
    fetch("/api/auth?list=all-staff-full")
      .then((r) => r.json())
      .then((d) => {
        if (d.staff) setAllStaff(d.staff);
        if (d.hospitals) setHospitals(d.hospitals);
      })
      .catch(() => {});
  }, []);

  // ============================================
  // 流程导航
  // ============================================

  /** 点击"远程会诊"入口 */
  const startConsultation = () => {
    setPhase("select-hospital");
  };

  /** 选择医院 → 进入选科室 */
  const onSelectHospital = (h: Hospital) => {
    setSelectedHospital(h);
    setSelectedDept(null);
    setSelectedDoctor(null);
    setResponseShown(false);
    setResponseType("text");
    setInputText("");
    setPhase("select-department");
  };

  /** 选择科室 → 进入选医生 */
  const onSelectDepartment = (d: Department) => {
    setSelectedDept(d);
    setSelectedDoctor(null);
    setResponseShown(false);
    setResponseType("text");
    setInputText("");
    // 过滤该科室的医生
    const doctors = allStaff.filter(
      (s) => s.hospitalId === selectedHospital?.id && s.deptId === d.id
    );
    setDeptDoctors(doctors);
    setPhase("select-doctor");
  };

  /** 选择医生 → 进入会诊界面 */
  const onSelectDoctor = (doc: StaffContact) => {
    setSelectedDoctor(doc);
    setResponseShown(false);
    setResponseType("text");
    setInputText("");
    setPhase("consulting");
  };

  /** 提交输入文本，根据关键词触发不同响应 */
  const handleSubmitInput = () => {
    if (!inputText.trim()) return;
    const text = inputText.trim();
    if (text.includes("资料全部上传完毕")) {
      setResponseType("audio");
    } else if (text.includes("是否建立人工气道")) {
      setResponseType("video");
    } else {
      setResponseType("text");
    }
    setResponseShown(true);
  };

  /** 返回首页 */
  const goHome = () => {
    setPhase("idle");
    setSelectedHospital(null);
    setSelectedDept(null);
    setSelectedDoctor(null);
    setResponseShown(false);
    setResponseType("text");
    setInputText("");
    // 停止媒体播放
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = 0; }
  };

  const goBackStep = () => {
    if (phase === "consulting") setPhase("select-doctor");
    else if (phase === "select-doctor") setPhase("select-department");
    else if (phase === "select-department") setPhase("select-hospital");
    else goHome();
  };

  // ============================================
  // 渲染：主页面（卡片风格）
  // ============================================
  if (phase === "idle") {
    return <MainPage onRemoteConsult={startConsultation} />;
  }

  // ============================================
  // 渲染：选择医院
  // ============================================
  if (phase === "select-hospital") {
    return (
      <main className="min-h-dvh bg-gradient-to-b from-slate-50 to-blue-50">
        <TopBar title="选择医院" onBack={goHome} />
        <div className="px-5 pt-4 pb-6 space-y-3">
          {hospitals.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mr-2" />
              <span className="text-sm text-gray-400">加载医院列表中...</span>
            </div>
          ) : (
            hospitals.map((h) => (
            <button
              key={h.id}
              onClick={() => onSelectHospital(h)}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:scale-[0.98] transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-lg">
                {h.shortName[0]}
              </div>
              <div className="text-left flex-1">
                <div className="text-base font-semibold text-gray-800">{h.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">{h.departments.length} 个科室</div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2">
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))
          )}
        </div>
      </main>
    );
  }

  // ============================================
  // 渲染：选择科室
  // ============================================
  if (phase === "select-department") {
    return (
      <main className="min-h-dvh bg-gradient-to-b from-slate-50 to-blue-50">
        <TopBar title="选择科室" onBack={() => setPhase("select-hospital")} subtitle={selectedHospital?.name} />
        <div className="px-5 pt-4 pb-6 space-y-3">
          {selectedHospital?.departments.map((d) => (
            <button
              key={d.id}
              onClick={() => onSelectDepartment(d)}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:scale-[0.98] transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold text-sm">
                {d.name.slice(0, 2)}
              </div>
              <div className="text-left flex-1">
                <div className="text-base font-semibold text-gray-800">{d.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">点击进入选择医生</div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2">
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      </main>
    );
  }

  // ============================================
  // 渲染：选择医生
  // ============================================
  if (phase === "select-doctor") {
    return (
      <main className="min-h-dvh bg-gradient-to-b from-slate-50 to-blue-50">
        <TopBar title="选择医生" onBack={() => setPhase("select-department")} subtitle={`${selectedHospital?.shortName} · ${selectedDept?.name}`} />
        <div className="px-5 pt-4 pb-6 space-y-3">
          {deptDoctors.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">该科室暂无医生</div>
          )}
          {deptDoctors.map((doc) => (
            <button
              key={doc.id}
              onClick={() => onSelectDoctor(doc)}
              className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm active:scale-[0.98] transition-all"
            >
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-base">
                {doc.avatar}
              </div>
              <div className="text-left flex-1">
                <div className="text-base font-semibold text-gray-800">{doc.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">{doc.title}</div>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2">
                <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
      </main>
    );
  }

  // ============================================
  // 渲染：会诊界面（输入 + 响应）— 关键词"资料全部上传完毕"=音频 / "是否建立人工气道"=视频
  // ============================================
  if (phase === "consulting") {
    return (
      <main className="min-h-dvh bg-gradient-to-b from-slate-50 to-blue-50">
        <TopBar title="远程会诊" onBack={goBackStep} subtitle={`${selectedDoctor?.name} · ${selectedDept?.name}`} />

        {/* 医生信息卡片 */}
        <div className="px-5 pt-4">
          <div className="bg-white rounded-2xl p-5 mb-4 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xl shadow-md">
                {selectedDoctor?.avatar}
              </div>
              <div>
                <div className="text-lg font-bold text-gray-800">{selectedDoctor?.name}</div>
                <div className="text-sm text-gray-500">{selectedDoctor?.title}</div>
                <div className="text-xs text-blue-500 mt-1">{selectedHospital?.shortName} · {selectedDept?.name}</div>
              </div>
            </div>
          </div>
        </div>

        {!responseShown ? (
          /* ===== 输入区域：键盘打字 ===== */
          <div className="px-5 pb-6">
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M6 8h12M6 12h12M6 16h4" />
                </svg>
                <label className="text-sm font-medium text-gray-600">键盘输入会诊内容</label>
              </div>
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="请输入内容"
                rows={3}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none transition-all"
              />
              <button
                onClick={handleSubmitInput}
                disabled={!inputText.trim()}
                className="mt-3 w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium text-sm active:scale-[0.98] transition-all disabled:opacity-40 disabled:active:scale-100"
              >
                发送
              </button>
            </div>
          </div>
        ) : responseType === "audio" ? (
          /* ===== 音频响应 ===== */
          <div className="px-5 pb-6 space-y-4 animate-fade-in">
            {/* 已发送消息气泡 */}
            <div className="flex justify-end">
              <div className="max-w-[80%] bg-blue-500 text-white rounded-2xl rounded-br-md px-4 py-3 text-sm">
                {inputText}
              </div>
            </div>
            {/* 医生回复 — 音频卡片 */}
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm">
                {selectedDoctor?.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-400 ml-1 mb-1">{selectedDoctor?.name} · 语音回复</div>
                <div className="bg-white rounded-2xl rounded-tl-md shadow-sm overflow-hidden">
                  {/* 音频波形装饰 */}
                  <div className="bg-gradient-to-r from-emerald-400 to-green-500 px-4 py-5">
                    <div className="flex items-center justify-center gap-1 h-10">
                      {[1, 0.7, 1, 0.5, 0.9, 0.6, 1, 0.4, 0.8, 0.5, 1, 0.7].map((scale, i) => (
                        <div
                          key={i}
                          className="w-1 bg-white/80 rounded-full animate-pulse"
                          style={{ height: `${scale * 100}%`, animationDelay: `${i * 0.1}s` }}
                        />
                      ))}
                    </div>
                    <p className="text-center text-white/60 text-xs mt-2 font-medium">🔊 语音消息</p>
                  </div>
                  {/* 音频播放器 */}
                  <div className="p-4">
                    <p className="text-sm text-gray-700 leading-relaxed mb-3">
                      患者为上感诱发急性喉梗阻，保守治疗无效，即刻行气管插管开放气道，纠正缺氧，保障生命体征稳定。
                    </p>
                    {audioSrc ? (
                      /* 本地文件存在 → 用真实 mp3 */
                      <audio
                        ref={audioRef}
                        src={audioSrc}
                        controls
                        controlsList="nodownload"
                        className="w-full h-10"
                        autoPlay
                      >
                        您的浏览器不支持音频播放
                      </audio>
                    ) : (
                      /* 无本地文件 → 在线 TTS 合成语音 */
                      <EmergencyTTSAudio
                        text="患者为上感诱发急性喉梗阻，保守治疗无效，即刻行气管插管开放气道，纠正缺氧，保障生命体征稳定。"
                        audioRef={audioRef}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={goHome}
              className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 font-medium text-sm active:scale-[0.98] transition-all"
            >
              返回首页
            </button>
          </div>
        ) : responseType === "video" ? (
          /* ===== 视频响应 ===== */
          <div className="px-0 pb-6 animate-fade-in">
            {/* 已发送消息 */}
            <div className="px-5 mb-3 flex justify-end">
              <div className="max-w-[80%] bg-blue-500 text-white rounded-2xl rounded-br-md px-4 py-3 text-sm">
                {inputText}
              </div>
            </div>
            {/* 视频播放器 — 全宽、大屏（本地优先，在线兜底） */ }
            <div className="bg-black">
              {mediaChecked && (
                <video
                  ref={videoRef}
                  src={videoSrc!}
                  controls
                  autoPlay
                  controlsList="nodownload"
                  playsInline
                  className="w-full"
                  style={{ maxHeight: "60vh" }}
                  poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%231e1b4b' width='400' height='300'/%3E%3Ctext fill='%23c7d2fe' x='50%25' y='45%25' text-anchor='middle' font-size='14'%3E📹 视频消息%3C/text%3E%3Ctext fill='%23818cf8' x='50%25' y='55%25' text-anchor='middle' font-size='12'%3E{selectedDoctor?.name} · 呼吸科%3C/text%3E%3C/svg%3E"
                >
                  您的浏览器不支持视频播放
                </video>
              )}
              {!mediaChecked && (
                <div className="flex items-center justify-center py-20">
                  <div className="animate-spin w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full mr-2" />
                  <span className="text-white/60 text-sm">加载视频中...</span>
                </div>
              )}
            </div>
            {/* 视频信息条 */}
            <div className="px-5 mt-3">
              <div className="bg-white rounded-2xl p-4 shadow-sm">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
                    {selectedDoctor?.avatar}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-800">{selectedDoctor?.name}</div>
                    <div className="text-xs text-gray-400">{selectedDoctor?.title}</div>
                  </div>
                </div>
                <p className="text-sm text-gray-600">已为您播放预先录制的会诊视频回复</p>
              </div>
              <button
                onClick={goHome}
                className="w-full mt-3 py-3 rounded-xl bg-gray-100 text-gray-600 font-medium text-sm active:scale-[0.98] transition-all"
              >
                返回首页
              </button>
            </div>
          </div>
        ) : (
          /* ===== 文字回复 ===== */
          <div className="px-5 pb-6 space-y-4 animate-fade-in">
            <div className="flex justify-end">
              <div className="max-w-[80%] bg-blue-500 text-white rounded-2xl rounded-br-md px-4 py-3 text-sm">
                {inputText}
              </div>
            </div>
            <div className="flex gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm">
                {selectedDoctor?.avatar}
              </div>
              <div className="flex-1">
                <div className="text-xs text-gray-400 ml-1 mb-1">{selectedDoctor?.name}</div>
                <div className="bg-white rounded-2xl rounded-tl-md shadow-sm px-4 py-3">
                  <p className="text-sm text-gray-600 leading-relaxed">
                    已收到您的会诊请求，{selectedDoctor?.name} 医生将尽快回复。
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={goHome}
              className="w-full py-3 rounded-xl bg-gray-100 text-gray-600 font-medium text-sm active:scale-[0.98] transition-all"
            >
              返回首页
            </button>
          </div>
        )}
      </main>
    );
  }

  return null;
}

// ============================================
// 顶部导航栏
// ============================================
function TopBar({ title, onBack, subtitle }: { title: string; onBack: () => void; subtitle?: string }) {
  return (
    <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100">
      <div className="flex items-center px-4 h-14">
        <button onClick={onBack} className="mr-3 p-1 -ml-1 active:opacity-60 transition-opacity">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div>
          <div className="text-base font-semibold text-gray-800">{title}</div>
          {subtitle && <div className="text-[11px] text-gray-400 -mt-0.5">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}

// ============================================
// 主页面 — 卡片风格
// ============================================
function MainPage({ onRemoteConsult }: { onRemoteConsult: () => void }) {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-blue-50/50 to-blue-50">
      {/* 顶部栏 */}
      <header className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <span className="text-white text-xs font-bold">协</span>
          </div>
          <span className="font-bold text-base text-gray-800">协同诊疗系统</span>
        </div>
      </header>

      {/* 主标题区 */}
      <div className="px-5 pt-6 pb-4 relative">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">虚拟病人问诊系统</h1>
        <p className="text-sm text-gray-400 mt-1">沉浸式病史采集</p>

        {/* 盾牌图标 */}
        <div className="absolute right-5 top-6 w-28 h-28 opacity-90 pointer-events-none">
          <svg viewBox="0 0 120 140" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M60 4L108 22V58C108 92 78 122 60 136C42 122 12 92 12 58V22L60 4Z" fill="url(#shieldGrad)" fillOpacity="0.15" stroke="#93c5fd" strokeWidth="1.5"/>
            <path d="M48 68L56 76L74 54" stroke="#3b82f6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="44" y="44" width="32" height="26" rx="3" fill="#dbeafe" stroke="#3b82f6" strokeWidth="1.5"/>
            <line x1="52" y1="52" x2="68" y2="52" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
            <line x1="52" y1="59" x2="64" y2="59" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"/>
            <defs>
              <linearGradient id="shieldGrad" x1="60" y1="4" x2="60" y2="136" gradientUnits="userSpaceOnUse">
                <stop stopColor="#3b82f6" stopOpacity="0.3"/>
                <stop offset="1" stopColor="#93c5fd" stopOpacity="0.05"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="px-5 pb-5">
        <div className="bg-white rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-sm border border-gray-100">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
          </svg>
          <span className="text-sm text-gray-400">选择权威病例，铸就医学标杆</span>
        </div>
      </div>

      {/* 功能卡片列表 */}
      <div className="px-5 space-y-3 pb-8">

        {/* 远程会诊 — 可点击入口 */}
        <FeatureCard
          icon={
            <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8">
                <path d="M23 7l-7 5 7 5V7zM14 5H3a2 2 0 00-2 2v10a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          }
          colorClass="red"
          title="远程会诊"
          desc="跨院协同 多学科联合会诊"
          onClick={onRemoteConsult}
          highlight
        />

      </div>
    </main>
  );
}

// ============================================
// 功能卡片
// ============================================
function FeatureCard({
  icon,
  colorClass,
  title,
  desc,
  onClick,
  highlight,
}: {
  icon: React.ReactNode;
  colorClass: string;
  title: string;
  desc: string;
  onClick?: () => void;
  highlight?: boolean;
}) {
  const colorMap: Record<string, { border: string; arrow: string }> = {
    emerald: { border: "border-l-emerald-400", arrow: "#10b981" },
    orange:  { border: "border-l-orange-400", arrow: "#f97316" },
    blue:    { border: "border-l-blue-400",   arrow: "#3b82f6" },
    purple:  { border: "border-l-purple-400", arrow: "#a855f7" },
    red:     { border: "border-l-red-400",    arrow: "#ef4444" },
  };

  const c = colorMap[colorClass] || colorMap.blue;

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border-l-4 ${c.border} active:scale-[0.98] transition-all ${
        highlight ? "ring-2 ring-red-200 bg-red-50/30" : ""
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
    >
      {icon}
      <div className="text-left flex-1 min-w-0">
        <div className={`text-base font-semibold ${highlight ? "text-red-600" : "text-gray-800"}`}>{title}</div>
        <div className={`text-xs mt-0.5 ${highlight ? "text-red-400" : "text-gray-400"}`}>{desc}</div>
      </div>
      {onClick && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c.arrow} strokeWidth="2.2">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

// ============================================
// TTS 在线语音合成（Web Speech API 兜底）
// ============================================
function EmergencyTTSAudio({
  text,
  audioRef,
}: {
  text: string;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}) {
  const [playing, setPlaying] = useState(false);
  const [supported, setSupported] = useState(true);

  const speak = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setSupported(false);
      return;
    }
    window.speechSynthesis.cancel(); // 防重复
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.9;
    u.pitch = 1;
    u.onstart = () => setPlaying(true);
    u.onend = () => setPlaying(false);
    u.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(u);
  };

  return (
    <div className="space-y-3">
      {supported ? (
        <>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
              <path d="M19 10v2a7 7 0 01-14 0v-2" strokeLinecap="round" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            在线语音合成（未上传本地录音文件）
          </div>
          <button
            onClick={speak}
            disabled={playing}
            className={`w-full py-3 rounded-xl font-medium text-sm transition-all active:scale-[0.98] ${
              playing
                ? "bg-emerald-100 text-emerald-600"
                : "bg-gradient-to-r from-emerald-400 to-green-500 text-white shadow-sm"
            }`}
          >
            {playing ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                正在播放...
              </span>
            ) : (
              "🔊 点击播放语音"
            )}
          </button>
        </>
      ) : (
        <p className="text-sm text-gray-400 text-center py-3">
          ⚠️ 当前浏览器不支持语音合成，请上传本地 mp3 文件
        </p>
      )}
    </div>
  );
}


