import Link from "next/link";
import {
  AppointmentError,
  addDays,
  canTransition,
  dayBounds,
  dayView,
  findSlots,
  isDateStr,
  loadApptTenant,
  parseWorkingHours,
  suggestedPrice,
  toLocal,
  workingWindows,
  type AppointmentView,
  type Slot,
  type StaffView,
} from "@/lib/appointments";
import { appointmentAction, bookFromDashboard } from "@/app/admin/appointments-actions";
import { SubmitButton } from "@/components/pending";
import { Avatar, Ctx, SOURCE, STATUS, minutesLabel, money, type ViewProps } from "./shared";

/**
 * «اليوم» — عمود لكل مقدّم خدمة، المواعيد كتل بطول مدتها، وفترة الانتظار
 * مخطّطة، والوقت الحرّ ظاهر، وخط «الآن».
 *
 * اللوحة ترسم ما تحسبه المكتبة ولا تعيد حسابه: الأوقات المتاحة من findSlots،
 * والانتقالات المسموحة من canTransition — زرٌّ يظهر هنا ثم يرفضه الخادم
 * أسوأ من غيابه.
 */

const PX_PER_MIN = 1.1;
const MIN = 60_000;

type Block = { a: AppointmentView; start: number; end: number; proc: { start: number; end: number } | null };

/** الفترة المرسومة: الفعلي لما انتهى، والممتد للآن لما طال، والمخطّط لغيرهما. */
function blockOf(a: AppointmentView, dayStart: number, now: number): Block {
  const off = (iso: string) => (new Date(iso).getTime() - dayStart) / MIN;
  let start = off(a.startAt);
  let end = off(a.endAt);
  if (a.status === "DONE" && a.startedAt && a.finishedAt) {
    start = off(a.startedAt);
    end = off(a.finishedAt);
  } else if (a.status === "IN_PROGRESS" && a.startedAt) {
    start = off(a.startedAt);
    end = Math.max(start + a.plannedMinutes, (now - dayStart) / MIN);
  }
  const proc = a.processing ? { start: off(a.processing.startAt), end: off(a.processing.endAt) } : null;
  return { a, start, end: Math.max(end, start + 10), proc };
}

export default async function DayView({ tenantId, slug, base, sp }: ViewProps) {
  const t = await loadApptTenant(tenantId);
  const nowDate = new Date();
  const today = toLocal(nowDate, t.timezone).date;
  const date = sp.date && isDateStr(sp.date) ? sp.date : today;
  const back = `${base}?date=${date}`;

  const day = await dayView(tenantId, date);
  const dayStart = dayBounds(date, t.timezone).start.getTime();
  const now = nowDate.getTime();

  // ── الشريط الزمني: من أبكر دوام أو موعد إلى أبعدهما، بساعات كاملة ──
  const windows = new Map(
    day.staff.map((s) => [
      s.id,
      workingWindows(parseWorkingHours(s.workingHours), date, t.timezone).map((w) => ({
        start: (w.start.getTime() - dayStart) / MIN,
        end: (w.end.getTime() - dayStart) / MIN,
      })),
    ]),
  );
  const blocks = day.items.map((a) => blockOf(a, dayStart, now));
  const edges = [
    ...[...windows.values()].flat().flatMap((w) => [w.start, w.end]),
    ...blocks.flatMap((b) => [b.start, b.end]),
  ];
  const from = edges.length ? Math.max(0, Math.floor(Math.min(...edges) / 60) * 60) : 8 * 60;
  const to = edges.length ? Math.min(24 * 60, Math.ceil(Math.max(...edges) / 60) * 60) : 20 * 60;
  const height = Math.max(60, to - from) * PX_PER_MIN;
  const y = (m: number) => (m - from) * PX_PER_MIN;
  const nowMin = (now - dayStart) / MIN;
  const showNow = date === today && nowMin >= from && nowMin <= to;

  // موظّف أُطفئ وله موعد اليوم ما زال يحتاج عموده
  const columns: StaffView[] = [
    ...day.staff,
    ...[...new Set(day.items.map((a) => a.staffId))]
      .filter((id) => !day.staff.some((s) => s.id === id))
      .map((id) => {
        const a = day.items.find((x) => x.staffId === id)!;
        return { id, name: a.staff.name, phone: null, photoVersion: null, workingHours: {}, commissionPercent: null, active: false, sortOrder: 0, serviceIds: [] };
      }),
  ];

  const suggested = new Map(
    await Promise.all(
      day.items
        .filter((a) => a.status === "IN_PROGRESS")
        .map(async (a) => [a.id, await suggestedPrice(tenantId, { customerId: a.customerId, serviceId: a.serviceId })] as const),
    ),
  );

  // ── الحجز: الخطوة الثانية تظهر حين تُختار خدمة ──
  const bdate = sp.bdate && isDateStr(sp.bdate) ? sp.bdate : date;
  let slots: Slot[] | null = null;
  let slotsError: string | null = null;
  if (sp.svc) {
    try {
      slots = await findSlots(tenantId, { serviceId: sp.svc, date: bdate, staffId: sp.prov || null });
    } catch (err) {
      slotsError = err instanceof AppointmentError ? err.message : "تعذّر حساب الأوقات";
    }
  }
  const byStaff = new Map<string, Slot[]>();
  for (const s of slots ?? []) byStaff.set(s.staffId, [...(byStaff.get(s.staffId) ?? []), s]);

  const counts = {
    total: day.items.filter((a) => a.status !== "CANCELLED").length,
    live: day.items.filter((a) => a.status === "IN_PROGRESS").length,
    done: day.items.filter((a) => a.status === "DONE").length,
  };

  return (
    <>
      {/* ── التاريخ ── */}
      <div className="row" style={{ marginBottom: 16 }}>
        <form method="get" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link className="btn ghost" href={`${base}?date=${addDays(date, -1)}`} aria-label="اليوم السابق">
            →
          </Link>
          <input type="date" name="date" defaultValue={date} aria-label="التاريخ" style={{ width: "auto" }} />
          <Link className="btn ghost" href={`${base}?date=${addDays(date, 1)}`} aria-label="اليوم التالي">
            ←
          </Link>
          <button type="submit" className="ghost">
            اعرض
          </button>
          {date !== today && (
            <Link className="btn ghost" href={base}>
              اليوم
            </Link>
          )}
        </form>
        <span className="sub" style={{ margin: 0 }}>
          {counts.total} موعد · {counts.live} جارٍ · {counts.done} انتهى · بتوقيت {t.timezone}
        </span>
      </div>

      {/* ── الشريط الزمني ── */}
      {columns.length === 0 ? (
        <div className="card">
          لا أحد في الفريق بعد. أضف مقدّمي الخدمة من <Link href={`${base}/team`}>الفريق</Link> والخدمات
          من <Link href={`${base}/services`}>الخدمات</Link>.
        </div>
      ) : (
        <div className="appt-board" role="region" aria-label="جدول اليوم">
          <div className="appt-hours">
            <div className="appt-col-head" />
            <div style={{ position: "relative", height }}>
              {Array.from({ length: Math.floor((to - from) / 60) + 1 }, (_, i) => from + i * 60).map((m) => (
                <span key={m} className="appt-hour" style={{ top: y(m) }}>
                  {String(Math.floor(m / 60) % 24).padStart(2, "0")}:00
                </span>
              ))}
            </div>
          </div>

          {columns.map((s) => (
            <div className="appt-col" key={s.id}>
              <div className="appt-col-head">
                <Avatar staff={s} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
              </div>
              <div className="appt-track" style={{ height }}>
                {(windows.get(s.id) ?? []).map((w, i) => (
                  <div key={i} className="appt-open" style={{ top: y(w.start), height: (w.end - w.start) * PX_PER_MIN }} />
                ))}
                {Array.from({ length: Math.floor((to - from) / 60) + 1 }, (_, i) => from + i * 60).map((m) => (
                  <div key={m} className="appt-grid-line" style={{ top: y(m) }} />
                ))}
                {blocks
                  .filter((b) => b.a.staffId === s.id)
                  .map((b) => (
                    <a
                      key={b.a.id}
                      href={`#a-${b.a.id}`}
                      className={`appt-block s-${b.a.status}`}
                      style={{ top: y(b.start), height: Math.max(18, (b.end - b.start) * PX_PER_MIN - 2) }}
                      title={`${b.a.local.time} · ${b.a.customer.name ?? b.a.customer.phone ?? ""} · ${b.a.service.name}`}
                    >
                      {b.proc && (
                        <span
                          className="appt-proc"
                          style={{ top: (b.proc.start - b.start) * PX_PER_MIN, height: (b.proc.end - b.proc.start) * PX_PER_MIN }}
                          aria-hidden
                        />
                      )}
                      <strong>{b.a.local.time}</strong> {b.a.customer.name ?? b.a.customer.phone ?? "عميل"}
                      <br />
                      <span style={{ color: "var(--text-2)" }}>{b.a.service.name}</span>
                    </a>
                  ))}
                {showNow && <div className="appt-now" style={{ top: y(nowMin) }} aria-label="الآن" />}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── حجز جديد ── */}
      <details className="card" open={!!sp.svc}>
        <summary>حجز جديد</summary>
        <div style={{ marginTop: 16 }}>
          <form method="get">
            <input type="hidden" name="date" value={date} />
            <div className="grid3">
              <label>
                <span>الخدمة *</span>
                <select name="svc" defaultValue={sp.svc ?? ""} required>
                  <option value="" disabled>
                    اختر خدمة
                  </option>
                  {day.services.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>مقدّم الخدمة</span>
                <select name="prov" defaultValue={sp.prov ?? ""}>
                  <option value="">أي أحد متاح</option>
                  {day.staff.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>اليوم</span>
                <input type="date" name="bdate" defaultValue={bdate} />
              </label>
            </div>
            <button type="submit" className="ghost">
              اعرض الأوقات المتاحة
            </button>
          </form>

          {slotsError && (
            <div className="alert warn" style={{ marginTop: 16 }}>
              {slotsError}
            </div>
          )}
          {slots && slots.length === 0 && (
            <div className="alert warn" style={{ marginTop: 16 }}>
              لا أوقات متاحة في هذا اليوم — جرّب يوماً آخر أو مقدّم خدمة آخر.
            </div>
          )}

          {slots && slots.length > 0 && (
            <form action={bookFromDashboard} style={{ marginTop: 20 }}>
              <Ctx slug={slug} back={`${base}?date=${date}&svc=${sp.svc}&prov=${sp.prov ?? ""}&bdate=${bdate}`} />
              <input type="hidden" name="serviceId" value={sp.svc} />
              <input type="hidden" name="date" value={bdate} />

              {[...byStaff.entries()].map(([staffId, list]) => (
                <div key={staffId} style={{ marginBottom: 6 }}>
                  <div className="hint" style={{ marginBottom: 8 }}>
                    {list[0].staffName} · {minutesLabel(list[0].minutes)}
                  </div>
                  <div className="slot-grid">
                    {list.map((x) => (
                      <label key={x.startAt.toISOString()} className="slot-chip">
                        <input type="radio" name="slot" value={`${staffId}|${x.startAt.toISOString()}`} required />
                        <span>{x.local.slice(11)}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}

              <div className="grid3">
                <label>
                  <span>رقم العميل</span>
                  <input type="tel" name="phone" dir="ltr" placeholder="07XXXXXXXX" />
                </label>
                <label>
                  <span>اسم العميل</span>
                  <input type="text" name="name" />
                </label>
                <label>
                  <span>طريقة الحجز</span>
                  <select name="source" defaultValue="WALK_IN">
                    <option value="WALK_IN">حضوري</option>
                    <option value="PHONE">هاتف</option>
                    <option value="DASHBOARD">من اللوحة</option>
                  </select>
                </label>
              </div>
              <p className="hint" style={{ marginTop: -6 }}>
                الرقم أو الاسم على الأقل. رقم مسجّل ⇒ يُربط الموعد بالعميل نفسه وتاريخه.
              </p>
              <label>
                <span>ملاحظة</span>
                <input type="text" name="notes" />
              </label>
              <SubmitButton>احجز</SubmitButton>
            </form>
          )}
        </div>
      </details>

      {/* ── مواعيد اليوم وإجراءاتها ── */}
      <h2>مواعيد اليوم ({day.items.length})</h2>
      {day.items.length === 0 && <div className="card">لا مواعيد في هذا اليوم.</div>}
      {day.items.map((a) => (
        <AppointmentCard
          key={a.id}
          a={a}
          slug={slug}
          back={back}
          base={base}
          currency={t.currency}
          suggested={suggested.get(a.id) ?? null}
        />
      ))}
    </>
  );
}

function AppointmentCard({
  a,
  slug,
  back,
  base,
  currency,
  suggested,
}: {
  a: AppointmentView;
  slug: string;
  back: string;
  base: string;
  currency: string;
  suggested: number | null;
}) {
  const st = STATUS[a.status] ?? STATUS.BOOKED;

  const act = (action: string, label: string, cls = "ghost") => (
    <form action={appointmentAction} key={action}>
      <Ctx slug={slug} back={back} />
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton className={cls} style={{ padding: "7px 14px" }}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <div className="card" id={`a-${a.id}`} style={{ scrollMarginTop: 80 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>{a.local.time}</strong>
            <span className={`pill ${st.cls}`}>{st.label}</span>
            <span className="pill">{SOURCE[a.source] ?? a.source}</span>
          </div>
          <div style={{ marginTop: 6 }}>
            <Link href={`${base}/customers/${a.customerId}`}>{a.customer.name ?? "عميل بلا اسم"}</Link>
            {a.customer.phone && (
              <span dir="ltr" style={{ unicodeBidi: "isolate", color: "var(--text-3)", marginInlineStart: 8 }}>
                +{a.customer.phone}
              </span>
            )}
          </div>
          <div className="hint" style={{ margin: "4px 0 0" }}>
            {a.service.name} · {a.staff.name} · {minutesLabel(a.plannedMinutes)}
            {a.processing && " · فيه وقت انتظار"}
            {a.actualMinutes != null && ` · فعلياً ${minutesLabel(a.actualMinutes)}`}
            {a.finalPrice != null && ` · ${money(a.finalPrice, currency)}`}
          </div>
          {a.notes && (
            <p className="hint" style={{ margin: "6px 0 0" }}>
              ملاحظات الزيارة: {a.notes}
            </p>
          )}
        </div>

        <div className="inline-forms">
          {a.status === "BOOKED" && canTransition("confirm", a.status) && act("confirm", "تأكيد")}
          {canTransition("start", a.status) && act("start", "بدأ", "")}
          {canTransition("noShow", a.status) && act("noShow", "غياب", "danger")}
          {canTransition("cancel", a.status) && act("cancel", "إلغاء", "danger")}
        </div>
      </div>

      {canTransition("finish", a.status) && (
        <details style={{ marginTop: 12 }} open={a.status === "IN_PROGRESS"}>
          <summary className="hint" style={{ cursor: "pointer" }}>
            انتهى — السعر وملاحظات الزيارة
          </summary>
          <form action={appointmentAction} style={{ marginTop: 12 }}>
            <Ctx slug={slug} back={back} />
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="action" value="finish" />
            <div className="grid2">
              <label>
                <span>السعر النهائي</span>
                <input
                  type="text"
                  inputMode="decimal"
                  name="finalPrice"
                  defaultValue={suggested ?? a.service.priceMin}
                />
              </label>
              <label>
                <span>ملاحظات الزيارة</span>
                <input type="text" name="notes" defaultValue={a.notes ?? ""} placeholder="ما الذي عُمل؟ ما يلزم تذكّره للمرة القادمة" />
              </label>
            </div>
            <SubmitButton>انتهى</SubmitButton>
          </form>
        </details>
      )}
    </div>
  );
}
