"use client";

import { useState } from "react";
import { newTemplate } from "../../actions";
import { SubmitButton } from "@/components/pending";

/**
 * إنشاء قالب رسالة وإرساله لمراجعة Meta.
 *
 * القالب شرط لمخاطبة رقم لم يراسلنا، وكان إنشاؤه يتطلب فتح مدير Meta:
 * لوحة بلغة أخرى، بحقول تقنية، وبقواعد تُكتشَف بالرفض لا بالقراءة. ذلك
 * مقبول حين ندير متجراً واحداً، ومستحيل حين يصير لكل متجر قوالبه.
 *
 * فنعرض هنا ما يحتاجه صاحب المحل فقط، ونفرض قواعد Meta قبل الإرسال بدل
 * أن يكتشفها من رفضٍ بعد يوم: الاسم بحروف صغيرة، وكل متغيّر بمثال.
 */
export function NewTemplate({ slug }: { slug: string }) {
  const [body, setBody] = useState("");
  const [examples, setExamples] = useState<string[]>([]);

  // عدد المتغيّرات من أكبر رقم لا من عدد المرات — المتغيّر قد يتكرر
  let count = 0;
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    count = Math.max(count, Number(m[1]));
  }

  const preview = body.replace(
    /\{\{\s*(\d+)\s*\}\}/g,
    (_, n) => examples[Number(n) - 1]?.trim() || `⟨${n}⟩`,
  );

  return (
    <details className="card">
      <summary>
        <strong>قالب جديد</strong>{" "}
        <span className="hint">— لمخاطبة أرقام لم تتواصل معك</span>
      </summary>

      <div style={{ marginTop: 14 }}>
        <p className="hint" style={{ marginTop: 0 }}>
          واتساب لا يسمح برسالة حرّة لرقم لم يراسلك خلال ٢٤ ساعة. القالب
          يُرسَل لمراجعة Meta، وتستغرق من دقائق إلى ساعات، ويظهر هنا تلقائياً
          بعد الموافقة.
        </p>

        <form action={newTemplate}>
          <input type="hidden" name="slug" value={slug} />

          <label>
            <span>اسم القالب</span>
            <input
              name="name"
              required
              dir="ltr"
              pattern="[a-z0-9_]+"
              maxLength={60}
              placeholder="tawasol_awwali"
            />
          </label>
          <p className="hint" style={{ marginTop: -6 }}>
            حروف إنجليزية صغيرة وأرقام وشرطة سفلية فقط. لا عربي ولا مسافات —
            هذا اسم داخلي لا يراه العميل.
          </p>

          <label>
            <span>التصنيف</span>
            <select name="category" defaultValue="UTILITY">
              <option value="UTILITY">متابعة خدمة — أرخص وأسرع موافقة</option>
              <option value="MARKETING">تسويق — عروض ودعوات</option>
            </select>
          </label>
          <p className="hint" style={{ marginTop: -6 }}>
            «متابعة خدمة» لطلب أو معاملة قائمة فعلاً. أي دعوة مفتوحة لعميل جديد
            هي تسويق — ووضعها تحت «متابعة» يُرفض، فمُصنِّف Meta يقرأ النص.
          </p>

          <label>
            <span>اللغة</span>
            <select name="language" defaultValue="ar">
              <option value="ar">العربية</option>
              <option value="en_US">English</option>
            </select>
          </label>

          <label>
            <span>متن الرسالة</span>
            <textarea
              name="body"
              required
              rows={4}
              maxLength={1024}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"مرحباً {{1}} 👋 معك متجرنا.\nتواصلنا معك بخصوص {{2}}."}
            />
          </label>
          <p className="hint" style={{ marginTop: -6 }}>
            اكتب <code>{"{{1}}"}</code> و <code>{"{{2}}"}</code> مكان ما يتغيّر
            من عميل لآخر.
          </p>

          {Array.from({ length: count }, (_, i) => (
            <label key={i}>
              <span>قيمة مثال للمتغيّر {`{{${i + 1}}}`}</span>
              <input
                name="example"
                required
                maxLength={200}
                value={examples[i] ?? ""}
                onChange={(e) => {
                  const next = [...examples];
                  next[i] = e.target.value;
                  setExamples(next);
                }}
                placeholder={i === 0 ? "أحمد" : "طلبك لتطوير موقع إلكتروني"}
              />
            </label>
          ))}
          {count > 0 && (
            <p className="hint" style={{ marginTop: -6 }}>
              Meta ترفض أي قالب فيه متغيّر بلا مثال — المراجع يحتاج أن يرى
              الجملة مكتملة ليحكم عليها.
            </p>
          )}

          <label>
            <span>التذييل (اختياري)</span>
            <input name="footer" maxLength={60} placeholder="اسم المتجر · المدينة" />
          </label>

          {body.trim() && (
            <div style={{ margin: "14px 0" }}>
              <span className="hint">ما سيصل العميل:</span>
              <div className="bubble agent" style={{ marginTop: 6 }}>
                {preview}
              </div>
            </div>
          )}

          <SubmitButton pendingText="يُرسل…">إرسال لمراجعة Meta</SubmitButton>
        </form>
      </div>
    </details>
  );
}
