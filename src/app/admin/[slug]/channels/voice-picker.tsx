"use client";

import { useEffect, useRef, useState } from "react";
import type { LibraryVoice } from "@/app/api/admin/voices/route";

/**
 * اختيار صوت المتجر بالاستماع: أصوات عربية من مكتبة ElevenLabs، تشغيل عيّنة
 * لكل صوت، و«اختر» يضعه في النموذج. الحفظ نفسه في saveVoiceSettings، وهو
 * الذي يضيف الصوت لحساب ElevenLabs إن لم يكن فيه.
 */

const ACCENTS = [
  { value: "", label: "كل اللهجات" },
  { value: "jordanian", label: "أردني" },
  { value: "levantine", label: "شامي" },
  { value: "gulf", label: "خليجي" },
  { value: "egyptian", label: "مصري" },
  { value: "standard", label: "فصحى" },
];

export function VoicePicker({ initialId, initialName }: { initialId: string | null; initialName: string | null }) {
  const [selected, setSelected] = useState<{ id: string; name: string; ownerId: string | null } | null>(
    initialId ? { id: initialId, name: initialName ?? initialId, ownerId: null } : null,
  );
  const [open, setOpen] = useState(false);
  const [gender, setGender] = useState("");
  const [accent, setAccent] = useState("jordanian");
  const [search, setSearch] = useState("");
  const [voices, setVoices] = useState<LibraryVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ gender, accent, search });
      const r = await fetch(`/api/admin/voices?${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "تعذّر جلب الأصوات");
      setVoices(j.voices);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر جلب الأصوات");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gender, accent]);

  function play(v: LibraryVoice) {
    if (!v.previewUrl) return;
    if (playing === v.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    const a = new Audio(v.previewUrl);
    a.onended = () => setPlaying(null);
    audio.current = a;
    void a.play();
    setPlaying(v.id);
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <input type="hidden" name="voiceId" value={selected?.id ?? ""} />
      <input type="hidden" name="voiceName" value={selected?.name ?? ""} />
      <input type="hidden" name="voiceOwnerId" value={selected?.ownerId ?? ""} />

      <div className="row" style={{ alignItems: "center", gap: 10 }}>
        <div>
          <span className="hint" style={{ margin: 0 }}>الصوت المختار: </span>
          <strong>{selected ? selected.name : "صوت المساعد الافتراضي"}</strong>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "إخفاء الأصوات" : "تصفّح الأصوات واستمع"}
          </button>
          {selected && (
            <button type="button" className="btn ghost" onClick={() => setSelected(null)}>
              الافتراضي
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="card" style={{ marginTop: 12, padding: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">أنثى وذكر</option>
              <option value="female">أنثى</option>
              <option value="male">ذكر</option>
            </select>
            <select value={accent} onChange={(e) => setAccent(e.target.value)}>
              {ACCENTS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void load();
                }
              }}
              placeholder="بحث بالاسم أو الوصف (Enter)"
              style={{ flex: 1, minWidth: 160 }}
            />
          </div>

          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          {loading && <p className="hint">جارٍ التحميل…</p>}
          {!loading && !error && voices.length === 0 && <p className="hint">لا أصوات بهذه الفلاتر.</p>}

          <div style={{ display: "grid", gap: 8 }}>
            {voices.map((v) => {
              const isSel = selected?.id === v.id;
              return (
                <div
                  key={v.id}
                  className="row"
                  style={{
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${isSel ? "var(--live)" : "var(--border)"}`,
                  }}
                >
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => play(v)}
                    disabled={!v.previewUrl}
                    aria-label={`استمع إلى ${v.name}`}
                    style={{ padding: "6px 12px", minWidth: 44 }}
                  >
                    {playing === v.id ? "⏸" : "▶"}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{v.name}</strong>
                    <div className="hint" style={{ margin: 0 }}>
                      {[
                        v.gender === "female" ? "أنثى" : v.gender === "male" ? "ذكر" : null,
                        v.accent,
                        v.age,
                        v.uses ? `${v.uses.toLocaleString("ar")} استخدام` : null,
                        v.inAccount ? "في حسابك" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {v.description && (
                      <div className="hint" style={{ margin: 0, opacity: 0.8 }}>
                        {v.description}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className={isSel ? "btn" : "btn ghost"}
                    onClick={() => setSelected({ id: v.id, name: v.name, ownerId: v.inAccount ? null : v.ownerId })}
                  >
                    {isSel ? "✓ مختار" : "اختر"}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            بعد الاختيار اضغط «حفظ صوت المكالمات» — حاضر يضيف الصوت لحساب ElevenLabs إن لم يكن فيه.
          </p>
        </div>
      )}
    </div>
  );
}
