# عقد API تطبيق الجوال — v1

هذه الوثيقة هي **الحدّ بين الخادم والتطبيق**. يُبنى الطرفان عليها بالتوازي،
فأي اختلاف بينها وبين الكود يُعدّ خطأً في الكود لا فيها. تغييرها يكون هنا
أولاً، ثم في الطرفين.

```
Base URL:  https://agent-whatapp.vercel.app/api/mobile/v1
           (التطبيق يقرؤه من --dart-define=API_BASE)
Auth:      Authorization: Bearer <token>
Content:   application/json; charset=utf-8
```

---

## لماذا جلسات أجهزة لا توقيع HMAC

جلسة الويب الحالية توقيع بلا حالة: لا يمكن سحبها إلا بتغيير مفتاح المنصة
كلها. مقبول لمتصفح على مكتب، وغير مقبول لجوال قد يُسرَق أو يُباع.

فجلسة الجوال **صفّ في قاعدة البيانات**:

- الرمز ٣٢ بايت عشوائية (base64url)، يُعطى للجهاز مرة واحدة عند الدخول.
- يُخزَّن **هاش SHA-256 فقط** — تسريب القاعدة لا يعطي رمزاً صالحاً.
- صلاحية منزلقة ٣٠ يوماً من آخر استخدام، وسقف مطلق ٩٠ يوماً من الإنشاء.
- تُسحَب فردياً (من «أجهزتي») أو جماعياً (عند تغيير كلمة السر).

---

## شكل الخطأ — موحّد في كل النقاط

```json
{ "error": { "code": "WINDOW_CLOSED", "message": "انتهت نافذة الرد…" } }
```

`code` ثابت بالإنجليزية يبني عليه التطبيق منطقه. `message` عربي جاهز للعرض.

| HTTP | code | المعنى |
|---|---|---|
| 400 | `INVALID_INPUT` | مُدخَل لا يطابق المخطط |
| 401 | `UNAUTHENTICATED` | رمز مفقود/منتهٍ/مسحوب ⇒ التطبيق يعود لشاشة الدخول |
| 401 | `INVALID_CREDENTIALS` | بريد أو كلمة سر خاطئة (رسالة واحدة للحالتين) |
| 403 | `ADMIN_NOT_SUPPORTED` | حساب مالك المنصة — التطبيق لأصحاب المتاجر |
| 404 | `NOT_FOUND` | غير موجود **أو** لمتجر آخر — لا نكشف الفرق |
| 403 | `TENANT_INACTIVE` | المتجر موقوف أو اشتراكه منتهٍ — **القراءة تعمل، الإرسال لا** |
| 409 | `WINDOW_CLOSED` | نافذة الرد الحرّ مغلقة ⇒ قالب فقط |
| 409 | `IN_PROGRESS` | إرسال بنفس `clientId` ما زال جارياً — انتظر، لا تُعِد |
| 409 | `DELIVERY_UNKNOWN` | Meta لم تؤكّد ولم ترفض (انقطاع) — **قد تكون وصلت العميل** |
| 409 | `CHANNEL_NOT_CONNECTED` | القناة غير مربوطة لهذا المتجر |
| 422 | `TEMPLATE_INVALID` | القالب غير معتمد أو متغيّراته ناقصة |
| 429 | `RATE_LIMITED` | محاولات كثيرة — الرأس `Retry-After` بالثواني |
| 502 | `SEND_FAILED` | Meta **رفضت صراحةً** — لم تصل العميل، وإعادتها بنفس `clientId` آمنة |
| 500 | `INTERNAL` | خطأ غير متوقّع — لا تفاصيل داخلية في الرد |

---

## الكائنات

```ts
type Channel = "WHATSAPP" | "MESSENGER" | "INSTAGRAM";   // WEB و VOICE لا يظهران
type Status  = "BOT" | "HUMAN" | "CLOSED";
type Role    = "USER" | "AGENT" | "HUMAN" | "SYSTEM";

type Window = {
  open: boolean;
  closesAt: string | null;   // ISO — null إن كانت مغلقة أو لم يراسلنا العميل قط
};

type ConversationItem = {
  id: string;
  channel: Channel;
  customerName: string | null;   // null إن كان الاسم بلا حرف ولا رقم («.»)
  externalUserId: string;
  displayId: string;             // واتساب: "+962770466649"، غيره: المعرّف كما هو
  status: Status;
  handoffReason: string | null;
  lastMessage: { text: string; role: Role; at: string } | null;
  unreadCount: number;           // رسائل USER بعد آخر قراءة لهذا المستخدم
  window: Window;
};

type Message = {
  id: string;
  role: Role;
  text: string;
  at: string;
  clientId: string | null;       // يُعاد كما أرسله الجهاز — لمطابقة الإرسال المتفائل
};

type Template = {
  name: string;
  language: string;
  category: string;
  body: string;                  // بعلامات {{1}}
  variables: number;
};
```

### نافذة الرد

تُحسب من **آخر رسالة USER** في المحادثة، على الخادم لا الجهاز (ساعة الجهاز
قد تكون خاطئة):

```
open = lastInboundAt != null && now < lastInboundAt + 24h
```

**٢٤ ساعة للقنوات الثلاث.** ماسنجر وانستقرام يسمحان بسبعة أيام عبر وسم
`HUMAN_AGENT`، لكنه صلاحية تتطلب موافقة Meta لا نملكها بعد — فلا نَعِد بها.

---

## النقاط

### المصادقة

#### `POST /auth/login`
```json
{ "email": "x@y.com", "password": "…", "device": { "name": "iPhone 17", "platform": "ios" } }
```
→ `200`
```json
{
  "token": "…",
  "expiresAt": "2026-11-15T…Z",
  "user":   { "id": "…", "email": "…", "name": "…" },
  "tenant": { "id": "…", "slug": "shifra-code", "name": "Shifra Code", "agentName": "…" }
}
```
- `PLATFORM_ADMIN` ⇒ `403 ADMIN_NOT_SUPPORTED`.
- خمس محاولات فاشلة لنفس البريد، أو عشرون من نفس الشبكة (IPv6 بالـ /64)،
  خلال ١٥ دقيقة ⇒ `429`. العدّاد في القاعدة لا في الذاكرة — Vercel يشغّل نسخاً
  متعددة بلا ذاكرة مشتركة — ويُسجَّل قبل فحص كلمة السر، فالطلبات المتزامنة
  لا تتجاوزه. **الويب والجوال يتقاسمان العدّاد نفسه.**
- رسالة واحدة للبريد غير الموجود ولكلمة السر الخاطئة، وزمن متقارب للحالتين.
- يُحدِّث `User.lastLoginAt`.

#### `POST /auth/logout` → `204`
يسحب جلسة هذا الجهاز ويمحو رمز الإشعارات.

### الجهاز

#### `GET /me` → `200`
```json
{
  "user": {…}, "tenant": {…},
  "channels": [{ "channel": "WHATSAPP", "connected": true }, …],
  "device": { "id": "…", "notify": "all" }
}
```

#### `PUT /devices/current` → `204`
```json
{ "pushToken": "fcm…", "notify": "handoff" }
```
الحقلان اختياريان. `notify ∈ "all" | "handoff" | "off"`.

#### `GET /devices` → `200`
```json
{ "items": [{ "id": "…", "name": "iPhone 17", "platform": "ios",
              "lastSeenAt": "…", "createdAt": "…", "current": true }] }
```

#### `DELETE /devices/:id` → `204`
يسحب جهازاً آخر **لنفس المستخدم فقط**. جهاز مستخدم آخر ⇒ `404`.

### الصندوق

#### `GET /inbox/summary` → `200`
```json
{
  "channels": [
    { "channel": "WHATSAPP",  "unread": 3, "handoff": 1 },
    { "channel": "INSTAGRAM", "unread": 0, "handoff": 0 },
    { "channel": "MESSENGER", "unread": 0, "handoff": 0 }
  ],
  "version": "1760622400000"
}
```
- `unread`: عدد **المحادثات** التي فيها رسائل غير مقروءة — رمادي في الشريط.
- `handoff`: عدد المحادثات بحالة `HUMAN` — أحمر في الشريط.
- `version`: يتغيّر مع أي رسالة جديدة في المتجر. التطبيق يسأل هذه النقطة
  كل ٨ ثوانٍ وهو في المقدّمة (احتياط إن تعطّل الإشعار)، ويعيد التحميل حين
  يتغيّر.

#### `GET /conversations?channel=WHATSAPP&cursor=…&limit=30` → `200`
```json
{ "pinned": [ConversationItem…], "items": [ConversationItem…], "nextCursor": "…" | null }
```
- `pinned`: محادثات `HUMAN` في القناة، **في الصفحة الأولى فقط** (بلا cursor)،
  حتى ٢٠٠، الأحدث أولاً.
- `items`: الباقي (`BOT` و`CLOSED`)، الأحدث أولاً، بترقيم cursor مبهم.
- `limit` من ١ إلى ٥٠، الافتراضي ٣٠.

#### `GET /conversations/:id` → `200` `{ "conversation": ConversationItem }`

#### `GET /conversations/:id/messages?before=<messageId>&limit=50` → `200`
```json
{ "items": [Message…], "hasMore": true }
```
داخل الصفحة **من الأقدم للأحدث**. بلا `before` ⇒ آخر الرسائل. مع `before` ⇒
الأقدم منها (التمرير لأعلى).

#### `POST /conversations/:id/read` → `204`
يسجّل القراءة حتى الآن لهذا المستخدم وحده — قراءة موظف لا تُخفي العدّاد عن زميله.

### الإرسال

#### `POST /conversations/:id/messages`
```json
{ "text": "…", "clientId": "uuid-v4" }
```
→ `201` `{ "message": Message, "conversation": ConversationItem }`

- **الرد يعني الاستلام:** محادثة `BOT` تتحوّل إلى `HUMAN` في نفس العملية.
  الموظف الذي ردّ يتولّاها، ولا يردّ الوكيل فوقه.
- **قابل للتكرار بأمان:** الخادم **يحجز** `clientId` قبل أن يكلّم Meta، فالطلب
  الثاني بنفس المعرّف لا يصل Meta أبداً، أيّاً كان توقيته. ما يرجع للثاني:

  | حالة الحجز | الرد للطلب المكرّر |
  |---|---|
  | أُرسلت وخُزّنت | `201` بنفس الرسالة |
  | ما زالت جارية | `409 IN_PROGRESS` — ستظهر في `messages` حين تكتمل، طابقها بـ `clientId` |
  | انقطاع بلا جواب من Meta | `409 DELIVERY_UNKNOWN` — مرة بعد مرة، **لا تُرسَل ثانيةً** |
  | رفض صريح من Meta | تُعاد المحاولة فعلاً — الرفض الصريح يعني أنها لم تصل |

- **ما يفعله الجهاز:** شبكة انقطعت قبل أي رد ⇒ يعيد بنفس `clientId` (آمن دائماً).
  `SEND_FAILED` ⇒ «فشل» مع زر إعادة بنفس `clientId`. `DELIVERY_UNKNOWN` ⇒
  «غير مؤكّد — ربما وصلت»، **بلا إعادة تلقائية**، وزر «أرسل مرة أخرى» يولّد
  `clientId` **جديداً** عن قصد: المستخدم وحده يقرّر أن احتمال التكرار مقبول.
- `clientId` لعملية لا يُعاد لعملية أخرى: نفس المعرّف بنص أو مستلم مختلف ⇒
  `400 INVALID_INPUT`.
- النافذة مغلقة ⇒ `409 WINDOW_CLOSED`. المتجر غير نشط ⇒ `403 TENANT_INACTIVE`.
- `text` من ١ إلى ٤٠٩٦ حرفاً بعد القصّ.

#### `POST /conversations/:id/takeover` → `200` `{ "conversation": … }`
#### `POST /conversations/:id/release` → `200` `{ "conversation": … }`
`HUMAN` ⇄ `BOT`. `release` يمحو `handoffReason`.

### القوالب

#### `GET /templates` → `200` `{ "items": [Template…] }`
المعتمدة فقط، من Meta مباشرة. القناة غير مربوطة ⇒ `409 CHANNEL_NOT_CONNECTED`.

#### `POST /conversations/:id/template`
```json
{ "name": "mutabaa_talab", "language": "ar", "variables": ["أحمد", "…"], "clientId": "uuid" }
```
→ `201` `{ "message": Message, "conversation": ConversationItem }`
للمحادثة القائمة المغلقة نافذتها. واتساب فقط. النص المخزَّن **بعد تعبئة
المتغيّرات**. يحوّل المحادثة إلى `HUMAN`.

#### `POST /conversations/start`
```json
{ "phone": "0770466649", "name": "خالد",
  "template": { "name": "…", "language": "ar", "variables": […] }, "clientId": "uuid" }
```
→ `201` `{ "conversation": ConversationItem }`
واتساب فقط. الرقم يُوحَّد كما في `startConversation` بالويب.

### العملاء المحتملون

#### `GET /leads?cursor=…&limit=30` → `200`
```json
{ "items": [{ "id": "…", "name": "…", "phone": "…", "channel": "WHATSAPP",
              "interest": "…", "notes": "…", "at": "…" }], "nextCursor": null }
```
`name` و`phone` يُكمَّلان من المحادثة حين يغيبان، كما في صفحة الويب.

---

## الإشعارات

FCM HTTP v1، رسالة **data + notification** معاً:

```json
{
  "notification": { "title": "أحمد العطاربة · واتساب", "body": "بدي أسعار المواقع" },
  "data": { "type": "message" | "handoff", "conversationId": "…", "channel": "WHATSAPP" }
}
```

| الحدث | `notify = all` | `handoff` | `off` |
|---|---|---|---|
| رسالة عميل جديدة | ✅ | — | — |
| تحويل لموظف | ✅ | ✅ | — |

- العنوان عند التحويل: `«يحتاجك الآن · أحمد العطاربة»`، والنص سبب التحويل.
- النص مقصوص إلى ١٢٠ حرفاً.
- يُرسَل لكل أجهزة مستخدمي **هذا المتجر** فقط، غير المسحوبة، ولها رمز.
- رمز مرفوض من FCM (`UNREGISTERED`) ⇒ يُمحى من الجهاز.
- الإرسال **بعد الرد** (`after()`) — بطء FCM لا يؤخّر رد الوكيل.
- بلا إعداد FCM ⇒ لا إرسال وسطر تحذير واحد، والتطبيق يعيش على الاستطلاع.
