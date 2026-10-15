"use client";

import { useState } from "react";
import { startConversation } from "../../actions";
import { SubmitButton } from "@/components/pending";
import type { Template } from "@/lib/channels/meta";

/**
 * بدء محادثة مع رقم لم يراسلنا.
 *
 * كان السجل يعرض من راسلنا فقط، ولا طريق لمخاطبة رقم جديد — فيخرج الموظف من
 * اللوحة إلى هاتفه، وتضيع الرسالة من السجل الذي بُني ليكون كاملاً.
 *
 * والنموذج قوالب لا حقل نص: واتساب لا يقبل رسالة حرّة إلا داخل نافذة أربع
 * وعشرين ساعة من آخر رسالة للعميل. ولأن هذا قيد لا يُلتَف عليه، نعرضه
 * صراحةً بدل أن نترك الموظف يكتشفه من رسالة فشل.
 */
export function NewChat({
  slug,
  templates,
  error,
}: {
  slug: string;
  templates: Template[];
  error?: string;
}) {
  const key = (t: Template) => `${t.name}|${t.language}`;
  const [picked, setPicked] = useState(templates[0] ? key(templates[0]) : "");
  const [vars, setVars] = useState<string[]>([]);

  const tpl = templates.find((t) => key(t) === picked);

  const preview = tpl
    ? tpl.body.replace(
        /\{\{\s*(\d+)\s*\}\}/g,
        (_, n) => vars[Number(n) - 1]?.trim() || `⟨${n}⟩`,
      )
    : "";

  return (
    <details className="card">
      <summary>
        <strong>محادثة جديدة</strong>{" "}
        <span className="hint">— راسل رقماً لم يتواصل معك</span>
      </summary>

      <div style={{ marginTop: 14 }}>
        {error ? (
          <p className="hint">تعذّر قراءة القوالب من Meta: {error}</p>
        ) : templates.length === 0 ? (
          <>
            <p className="hint" style={{ marginTop: 0 }}>
              لا يوجد قالب معتمد بعد. واتساب لا يسمح بمراسلة رقم لم يراسلك إلا
              بقالب وافقت عليه Meta مسبقاً.
            </p>
            <p className="hint">
              أنشئ قالباً من{" "}
              <a
                href="https://business.facebook.com/wa/manage/message-templates/"
                target="_blank"
                rel="noreferrer"
              >
                مدير القوالب
              </a>{" "}
              — الموافقة تستغرق من دقائق إلى ساعات، وبعدها يظهر هنا تلقائياً.
            </p>
          </>
        ) : (
          <form action={startConversation}>
            <input type="hidden" name="slug" value={slug} />

            <label>
              <span>رقم الواتساب</span>
              <input
                name="phone"
                required
                dir="ltr"
                inputMode="tel"
                placeholder="9627XXXXXXXX"
                style={{ fontVariantNumeric: "tabular-nums" }}
              />
            </label>
            <p className="hint" style={{ marginTop: -6 }}>
              بمفتاح الدولة. تُقبل كل الصيغ — ‎+962 7 7046 6649 أو 00962… أو
              07… — وتُوحَّد تلقائياً.
            </p>

            <label>
              <span>اسم العميل (اختياري)</span>
              <input name="name" maxLength={100} placeholder="يظهر في السجل بدل الرقم" />
            </label>

            <label>
              <span>القالب</span>
              <select
                name="template"
                value={picked}
                onChange={(e) => {
                  setPicked(e.target.value);
                  setVars([]);
                }}
              >
                {templates.map((t) => (
                  <option key={key(t)} value={key(t)}>
                    {t.name} · {t.language} · {t.category}
                  </option>
                ))}
              </select>
            </label>

            {tpl &&
              Array.from({ length: tpl.variables }, (_, i) => (
                <label key={i}>
                  <span>المتغيّر {i + 1}</span>
                  <input
                    name="var"
                    required
                    maxLength={200}
                    value={vars[i] ?? ""}
                    onChange={(e) => {
                      const next = [...vars];
                      next[i] = e.target.value;
                      setVars(next);
                    }}
                  />
                </label>
              ))}

            {preview && (
              <div style={{ margin: "14px 0" }}>
                <span className="hint">ما سيصل العميل:</span>
                <div className="bubble agent" style={{ marginTop: 6 }}>
                  {preview}
                </div>
              </div>
            )}

            <SubmitButton pendingText="يُرسل…">إرسال وبدء المحادثة</SubmitButton>
            <p className="hint">
              تُفتح المحادثة بحالة «محوّلة لموظف» — نحن من بدأها، فردّ العميل
              جواب على كلامك لا سؤال جديد. أعِدها للوكيل متى شئت.
            </p>
          </form>
        )}
      </div>
    </details>
  );
}
