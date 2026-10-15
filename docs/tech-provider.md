# التقديم كـ Tech Provider

ملف تشغيلي لتحويل حاضر من «تطبيق بزنس واحد» إلى **مزوّد خدمات فنية** عند Meta،
وهو ما يفتح **Embedded Signup**: ربط عميل جديد بواتساب في خمس دقائق، يعملها
العميل بنفسه، بلا لوحة Meta ولا توكنات تُنسَخ باليد.

> **لماذا الآن:** بدونه كل عميل يحتاج نصف يوم عمل منّا + توثيق نشاط خاص به.
> هذا مقبول لعشرة عملاء ومستحيل لمئة. والمراجعة تأخذ أسابيع، فالتأخير يُدفَع
> مرتين: مرة انتظاراً، ومرة عملاءَ رُبطوا بالطريقة الصعبة ويجب نقلهم لاحقاً.

---

## المسار في لوحة Meta

```
Use cases ← WhatsApp ← Customize (✏️)
   └── Tech Provider onboarding      ← بالعربية: الانضمام كموفر خدمات فنية
         ├── الخطوة ١: توثيق النشاط التجاري
         └── الخطوة ٢: مراجعة التطبيق
```

اضغط **Onboard without a partner** (الانضمام بدون شريك) — نحن مزوّد مباشر،
لا نمرّ عبر Solution Partner.

---

## ما هو منجَز ✅

| المتطلب | الحالة |
|---|---|
| توثيق النشاط التجاري | ✅ تمت الموافقة |
| أيقونة التطبيق | ✅ شعار ١٠٨٠×١٠٨٠ |
| سياسة الخصوصية | ✅ `/privacy` |
| شروط الاستخدام | ✅ `/terms` |
| حذف البيانات | ✅ `/data-deletion` |
| فئة التطبيق | ✅ أنشطة تجارية وصفحات |
| Webhook يعمل فعلياً | ✅ رسائل حقيقية وصلت وردّ عليها الوكيل |
| رقم مسجَّل ويعمل | ✅ `+962 7 7046 6649` |

## ما هو ناقص ⬜

| المتطلب | ما يلزم |
|---|---|
| Advanced Access على `whatsapp_business_messaging` | طلب الترقية — الحالة الآن «جاهز للاختبار» |
| Advanced Access على `whatsapp_business_management` | نفسه |
| فيديو ١ — إرسال رسالة | تسجيل شاشة |
| فيديو ٢ — إنشاء قالب | تسجيل شاشة |
| نصوص تبرير الصلاحيات | جاهزة أدناه — انسخها |

---

## الفيديوهان

Meta تطلب اثنين. الأصل أن يُظهرا **تطبيقنا**، وتقبل بديلاً مُعلناً في وثائقها.

### فيديو ١ — رسالة تُرسَل من حاضر وتصل واتساب

الأفضل تصويره من حاضر نفسه، وهو **متاح عندنا اليوم**:

1. سجّل الشاشة والهاتف معاً (أو شاشة فيها واتساب ويب بجانب حاضر).
2. افتح `/admin/shifra-code/conversations`.
3. افتح محادثة حالتها **محوّلة لموظف**.
4. اكتب رسالة في «ردّك كموظف» واضغط **إرسال للعميل**.
5. أظهِر الرسالة وهي تصل على واتساب.

> لا تقصّ الفيديو بين الإرسال والوصول — المراجع يريد أن يرى السلسلة متصلة.

**البديل المقبول:** تسجيل سكربت cURL من صفحة API Setup يرسل رسالة لرقم تجريبي.
استخدمه فقط لو تعذّر الأول.

### فيديو ٢ — إنشاء قالب رسالة

حاضر لا يملك واجهة إنشاء قوالب بعد، ووثائق Meta تقبل البديل صراحةً:

> *A recording of WhatsApp Manager creating a template can replace Video 2.*

فسجّل إنشاء قالب من `business.facebook.com/wa/manage/message-templates/` —
وهي خطوة نفّذناها فعلاً عند إنشاء `tawasol_awwali`.

**لاحقاً:** بناء واجهة قوالب داخل حاضر مفيد للمنتج نفسه (كل متجر يحتاج قوالبه)
ويقوّي أي مراجعة قادمة. ليس شرطاً الآن.

---

## نصوص التبرير — انسخها كما هي

المراجعون يقرؤون بالإنجليزية. الصياغة تصف ما يفعله النظام فعلاً، بلا مبالغة:
المبالغة تُكتشف من الفيديو فتُسقِط الطلب كله.

### `whatsapp_business_messaging`

```
HADER is a multi-tenant SaaS platform that provides AI-powered customer
service agents for small and medium businesses in Jordan and the wider
Arab region.

We need whatsapp_business_messaging to send messages on behalf of our
business clients. Each client connects their own WhatsApp Business
Account to our platform. When an end customer messages that client's
number, our webhook receives the message, our AI agent generates a reply
grounded strictly in that client's own catalog, FAQs and policies, and we
send that reply back through the Cloud API using the client's credentials.

Our staff-handoff feature also uses this permission: when the agent cannot
answer, the conversation is transferred to a human employee of the client,
who replies to the end customer from our dashboard.

Message data is isolated per client at the database level. One client's
agent can never access another client's data.
```

### `whatsapp_business_management`

```
We need whatsapp_business_management to manage the WhatsApp Business
Accounts that our clients connect to our platform through Embedded Signup.

Specifically we use it to:
- Subscribe our app to each client's WABA so we receive their webhooks.
- Read the client's registered phone numbers and their display-name status,
  so our dashboard can show them whether their number is ready.
- Read the client's approved message templates, so they can select one when
  starting a conversation with a customer outside the 24-hour window.

Without Advanced Access, API calls against WABAs not owned by our own
business return error code 200, which makes onboarding any client
impossible.
```

### وصف التطبيق العام (إن طُلب)

```
HADER (حاضر) is a customer-service automation platform for small businesses.
Each business connects its own WhatsApp Business Account and configures its
catalog, FAQs and policies. Our AI agent then answers that business's
customers automatically, 24/7, in Arabic — and hands the conversation to a
human employee when it cannot answer confidently.

Website: https://agent-whatapp.vercel.app
Privacy policy: https://agent-whatapp.vercel.app/privacy
Terms: https://agent-whatapp.vercel.app/terms
Data deletion: https://agent-whatapp.vercel.app/data-deletion
```

---

## بعد الموافقة — ما يجب بناؤه

الموافقة تفتح الباب ولا تعبره. يبقى في الكود:

1. **Embedded Signup v4**
   نسختا v2 و v3 أُوقفتا في ١٥ تشرين الأول ٢٠٢٦ — نبني على v4 مباشرة.

2. **استقبال التوكن تلقائياً**
   اليوم `accessToken` يُلصَق يدوياً في صفحة القنوات. بعد Embedded Signup
   يصل عبر تبادل الرمز، ويُخزَّن مشفّراً كما هو الآن.

3. **اشتراك تلقائي في WABA العميل**
   `POST /{waba-id}/subscribed_apps` فور انتهاء التسجيل، بدل زر «اشترك الآن».

4. **حقول webhook إضافية**
   `history` و `smb_app_state_sync` و `smb_message_echoes` — لمزامنة بيانات
   من كان يستخدم تطبيق واتساب بزنس قبل الانضمام.

5. **بطاقة دفع لكل عميل**
   Meta تطلب أن يضيف كل عميل بطاقته على حسابه. يجب أن تظهر هذه الخطوة في
   مسار التسجيل عندنا، وإلا توقّفت رسائله بلا سبب مفهوم له.
