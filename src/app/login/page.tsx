"use client";

import { useState, useEffect, useCallback } from "react";

interface Hospital {
  id: string; name: string; shortName: string; departments: { id: string; name: string }[];
}

interface Department {
  id: string; name: string;
}

interface Staff {
  id: string; name: string; title: string; avatar: string; department: string; hospitalId: string; deptId: string; hospitalName?: string;
}

type StaffStep = "hospital" | "department" | "doctor";

export default function LoginPage() {
  // --- 医护 (三级选择) ---
  const [step, setStep] = useState<StaffStep>("hospital");
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedHospital, setSelectedHospital] = useState<{ id: string; name: string } | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState<{ id: string; name: string } | null>(null);
  const [doctors, setDoctors] = useState<Staff[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 加载医院列表
  useEffect(() => {
    fetch("/api/auth?list=hospitals")
      .then((r) => r.json())
      .then((d) => {
        if (d.hospitals) setHospitals(d.hospitals);
      })
      .catch(() => setError("加载数据失败"));
  }, []);

  // 选择医院后加载科室
  useEffect(() => {
    if (!selectedHospital) return;
    fetch(`/api/auth?list=departments&hospitalId=${selectedHospital.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.departments) setDepartments(d.departments);
      })
      .catch(() => setError("加载科室失败"));
  }, [selectedHospital]);

  // 选择科室后加载医生
  useEffect(() => {
    if (!selectedHospital || !selectedDept) return;
    fetch(`/api/auth?list=staff&hospitalId=${selectedHospital.id}&deptId=${selectedDept.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.staff) setDoctors(d.staff);
      })
      .catch(() => setError("加载医生列表失败"));
  }, [selectedHospital, selectedDept]);

  const selectHospital = (h: Hospital) => {
    setSelectedHospital({ id: h.id, name: h.name });
    setSelectedDept(null);
    setSelectedDoctor("");
    setStep("department");
    setError("");
  };

  const selectDept = (d: Department) => {
    setSelectedDept({ id: d.id, name: d.name });
    setSelectedDoctor("");
    setStep("doctor");
    setError("");
  };

  const backToHospital = () => {
    setSelectedHospital(null);
    setSelectedDept(null);
    setSelectedDoctor("");
    setStep("hospital");
    setError("");
  };

  const backToDept = () => {
    setSelectedDept(null);
    setSelectedDoctor("");
    setStep("department");
    setError("");
  };

  const login = useCallback(async () => {
    if (!selectedDoctor) { setError("请选择医生身份"); return; }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", role: "staff", userId: selectedDoctor }),
      });
      const data = await res.json();

      if (!data.success || !data.token) {
        setError(data.error || "登录失败");
        setLoading(false);
        return;
      }

      localStorage.setItem("auth_token", data.token);
      localStorage.setItem("auth_user", JSON.stringify(data.user));

      // 医护登录后进主页（可直接呼叫其他医生）
      window.location.href = "/";
    } catch {
      setError("登录服务异常");
      setLoading(false);
    }
  }, [selectedDoctor]);

  const canLogin = step === "doctor" && !!selectedDoctor;

  return (
    <main className="h-screen bg-gradient-to-b from-gray-900 via-gray-950 to-black text-white flex flex-col items-center justify-center px-5 overflow-auto py-6">
      {/* Logo */}
      <div className="mb-8 text-center shrink-0">
        <div className="w-16 h-16 rounded-2xl bg-blue-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/20">
          <span className="text-2xl font-bold">H</span>
        </div>
        <h1 className="text-xl font-semibold">Hospeech</h1>
        <p className="text-gray-400 text-sm mt-1">医院医护语音呼叫系统</p>
      </div>

      {/* 卡片 */}
      <div className="w-full max-w-sm">

        {/* ---- 医护三级选择 ---- */}
        <div className="space-y-3 mb-6">

          {/* 步骤指示器 */}
          <div className="flex items-center justify-center gap-2 mb-2">
            {(["hospital", "department", "doctor"] as StaffStep[]).map((s, i) => {
              const completed = (s === "hospital" && step !== "hospital") ||
                                (s === "department" && step === "doctor") ||
                                (s === "doctor" && selectedDoctor);
              const active = s === step;
              return (
                <div key={s} className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                    completed ? "bg-blue-500 text-white" : active ? "bg-blue-500/30 text-blue-400 ring-2 ring-blue-500/50" : "bg-white/10 text-gray-500"
                  }`}>
                    {completed ? "✓" : i + 1}
                  </div>
                  <span className={`text-[11px] ${active ? "text-blue-400" : completed ? "text-gray-400" : "text-gray-600"}`}>
                    {s === "hospital" ? "选医院" : s === "department" ? "选科室" : "选医生"}
                  </span>
                  {i < 2 && <div className={`w-4 h-px ${i < (step === "doctor" ? 2 : step === "department" ? 1 : 0) ? "bg-blue-500" : "bg-white/10"}`} />}
                </div>
              );
            })}
          </div>

          {/* 面包屑导航 */}
          {step !== "hospital" && (
            <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
              <button onClick={backToHospital} className="hover:text-blue-400 transition-colors">
                全部医院
              </button>
              {selectedHospital && (
                <>
                  <span>&gt;</span>
                  {step === "doctor" ? (
                    <button onClick={backToDept} className="hover:text-blue-400 transition-colors">
                      {selectedHospital.name}
                    </button>
                  ) : (
                    <span className="text-white">{selectedHospital.name}</span>
                  )}
                </>
              )}
              {selectedDept && step === "doctor" && (
                <>
                  <span>&gt;</span>
                  <span className="text-white">{selectedDept.name}</span>
                </>
              )}
            </div>
          )}

          {/* Step 1: 选医院 */}
          {step === "hospital" && (
            <>
              <p className="text-sm text-gray-400 text-center">请选择所属医院</p>
              {hospitals.length === 0 && <p className="text-sm text-gray-500 text-center">加载中...</p>}
              {hospitals.map((h) => (
                <button
                  key={h.id}
                  onClick={() => selectHospital(h)}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border border-white/10 bg-white/5 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-left"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-xs">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      <polyline points="9,22 9,12 15,12 15,22" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">{h.name}</div>
                    <div className="text-xs text-gray-400">{h.departments.length} 个科室</div>
                  </div>
                  <div className="ml-auto text-gray-500">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Step 2: 选科室 */}
          {step === "department" && (
            <>
              <p className="text-sm text-gray-400 text-center">
                已选：<span className="text-blue-400 font-medium">{selectedHospital?.name}</span> · 请选择科室
              </p>
              {departments.length === 0 && <p className="text-sm text-gray-500 text-center">加载中...</p>}
              {departments.map((d) => (
                <button
                  key={d.id}
                  onClick={() => selectDept(d)}
                  className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-white/10 bg-white/5 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-xs">
                    {d.name.slice(0, 2)}
                  </div>
                  <div className="text-sm font-medium text-white">{d.name}</div>
                  <div className="ml-auto text-gray-500">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                  </div>
                </button>
              ))}
            </>
          )}

          {/* Step 3: 选医生 */}
          {step === "doctor" && (
            <>
              <p className="text-sm text-gray-400 text-center">
                已选：<span className="text-blue-400 font-medium">{selectedHospital?.name}</span> · <span className="text-indigo-400">{selectedDept?.name}</span>
              </p>
              {doctors.length === 0 ? (
                <p className="text-sm text-gray-500 text-center">该科室暂无医生</p>
              ) : (
                doctors.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => { setSelectedDoctor(d.id); setError(""); }}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                      selectedDoctor === d.id ? "border-blue-500 bg-blue-500/10" : "border-white/10 bg-white/5 hover:border-white/20"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-sm">
                      {d.avatar}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">{d.name}</div>
                      <div className="text-xs text-gray-400">{d.title}</div>
                    </div>
                    <div className="ml-auto">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        selectedDoctor === d.id ? "border-blue-500" : "border-white/20"
                      }`}>
                        {selectedDoctor === d.id && <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>

        {/* 错误提示 */}
        {error && <div className="text-red-400 text-sm text-center mb-4">{error}</div>}

        {/* 登录按钮 */}
        <button
          onClick={login}
          disabled={loading || !canLogin}
          className={`w-full py-3.5 rounded-xl text-sm font-semibold transition-all ${
            !canLogin || loading
              ? "bg-white/10 text-gray-500 cursor-not-allowed"
              : "bg-blue-500 hover:bg-blue-600 text-white shadow-lg shadow-blue-500/20"
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              登录中...
            </span>
          ) : (
            "登录系统"
          )}
        </button>
      </div>
    </main>
  );
}
