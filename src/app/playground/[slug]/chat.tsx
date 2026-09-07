"use client";

import { useRef, useState } from "react";

type Turn = {
  role: "user" | "agent";
  text: string;
  tools?: { name: string; summary: string }[];
};

export default function Chat({ slug, agentName }: { slug: string; agentName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [handedOff, setHandedOff] = useState(false);
  const sessionId = useRef(`web-${Math.random().toString(36).slice(2)}`);

  function reset() {
    sessionId.current = `web-${Math.random().toString(36).slice(2)}`;
    setTurns([]);
    setHandedOff(false);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || handedOff) return;

    setTurns((t) => [...t, { role: "user", text }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantSlug: slug, sessionId: sessionId.current, text }),
      });
      const data = await res.json();

      if (data.handedOff) {
        setHandedOff(true);
      } else {
        if (data.toolCalls?.some((c: { name: string }) => c.name === "handoff_to_human")) {
          setHandedOff(true);
        }
        setTurns((t) => [
          ...t,
          { role: "agent", text: data.reply ?? data.error ?? "خطأ", tools: data.toolCalls },
        ]);
      }
    } catch {
      setTurns((t) => [...t, { role: "agent", text: "تعذّر الاتصال بالخادم." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card" style={{ minHeight: 280 }}>
        {turns.length === 0 && (
          <p className="sub" style={{ margin: 0 }}>
            اكتب سؤالاً كما لو كنت عميلاً — مثلاً «كم سعر الذهب اليوم؟»
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i}>
            <div className={`bubble ${t.role}`}>{t.text}</div>
            {t.tools && t.tools.length > 0 && (
              <div className="meta">
                ⚙️ {t.tools.map((c) => `${c.name} (${c.summary})`).join("، ")}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="typing">
            <i /><i /><i />
          </div>
        )}

        {handedOff && (
          <div
            className="meta"
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 12,
              marginTop: 12,
              lineHeight: 1.8,
            }}
          >
            🤝 <strong>المحادثة محوّلة لموظف بشري — الوكيل صامت الآن.</strong>
            <br />
            هذا بالضبط ما يحدث على الواتساب: بعد التحويل لا يرد الوكيل حتى يعيدها موظف من
            تبويب «المحادثات» في لوحة التحكم.
          </div>
        )}
      </div>

      <form onSubmit={send} className="row" style={{ flexWrap: "nowrap" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={handedOff ? "المحادثة مع موظف بشري…" : "اكتب رسالتك…"}
          disabled={busy || handedOff}
        />
        {handedOff ? (
          <button type="button" onClick={reset}>
            محادثة جديدة
          </button>
        ) : (
          <button type="submit" disabled={busy || !input.trim()}>
            إرسال
          </button>
        )}
      </form>
    </div>
  );
}
