import '../models.dart';

/// بيانات عيّنة للخادم الوهمي — محادثات واقعية لمتجر يبيع خدمات مواقع.
///
/// الأزمنة نسبية إلى «الآن» كي تبقى النافذة مفتوحة/مغلقة كما صُمّمت مهما
/// كان يوم التشغيل: محادثة أحمد مثلاً تُظهر دائماً «باقي ٦ ساعات للرد».

/// سطر في سيناريو: (الدور، النص، قبل كم دقيقة).
typedef ScriptLine = (Role, String, int);

class FakeSeed {
  const FakeSeed({
    required this.id,
    required this.channel,
    required this.name,
    required this.externalUserId,
    required this.displayId,
    required this.status,
    this.handoffReason,
    this.unread = 0,
    required this.script,
  });

  final String id;
  final Channel channel;
  final String? name;
  final String externalUserId;
  final String displayId;
  final ConversationStatus status;
  final String? handoffReason;
  final int unread;
  final List<ScriptLine> script;
}

const _h = 60;
const _d = 24 * 60;

const fakeSeeds = <FakeSeed>[
  // ───────────── واتساب ─────────────
  FakeSeed(
    id: 'c_wa_ahmad',
    channel: Channel.whatsapp,
    name: 'أحمد العطاربة',
    externalUserId: '962770466649',
    displayId: '+962770466649',
    status: ConversationStatus.human,
    handoffReason: 'طلب التحدث مع موظف بخصوص سعر متجر إلكتروني مخصّص',
    unread: 2,
    script: [
      (Role.user, 'مرحبا، بدي أسأل عن أسعار المواقع', 2 * _d + 3 * _h),
      (Role.agent, 'أهلاً أحمد 👋 عنا ثلاث باقات: موقع تعريفي يبدأ من ٢٥٠ دينار، متجر إلكتروني من ٦٠٠، وتطبيق مخصّص حسب المتطلبات. شو نوع مشروعك؟', 2 * _d + 3 * _h - 1),
      (Role.user, 'متجر ملابس، تقريباً ٣٠٠ منتج', 2 * _d + 2 * _h),
      (Role.agent, 'ممتاز! باقة المتجر بتشمل رفع المنتجات، الدفع الإلكتروني، وربط التوصيل. بتحب أرسلك أمثلة من شغلنا؟', 2 * _d + 2 * _h - 1),
      (Role.user, 'اه ياريت', 1 * _d + 20 * _h),
      (Role.agent, 'هاي ثلاث متاجر عملناها مؤخراً: shifra.store/demo1 و demo2 و demo3', 1 * _d + 20 * _h - 1),
      (Role.user, 'حلوين. بس السعر ٦٠٠ كتير علي، في مجال خصم؟', 17 * _h + 45),
      (Role.agent, 'الخصومات بيقرّرها الفريق مباشرة. حوّلتك لموظف رح يرد عليك بأقرب وقت 🙏', 17 * _h + 44),
      (Role.user, 'تمام بستنى', 17 * _h + 40),
    ],
  ),
  FakeSeed(
    id: 'c_wa_sara',
    channel: Channel.whatsapp,
    name: 'سارة الخطيب',
    externalUserId: '962791234567',
    displayId: '+962791234567',
    status: ConversationStatus.human,
    handoffReason: 'شكوى: تأخّر تسليم الموقع عن الموعد المتفق عليه',
    unread: 1,
    script: [
      (Role.user, 'السلام عليكم، الموقع كان المفروض يتسلّم الخميس الماضي', 3 * _h),
      (Role.agent, 'وعليكم السلام سارة، بعتذر عن التأخير. خليني أتأكد من حالة مشروعك.', 3 * _h - 1),
      (Role.agent, 'المشروع حالياً بمرحلة المراجعة النهائية. بحوّلك لمدير المشروع ليعطيك موعد دقيق.', 3 * _h - 2),
      (Role.human, 'أهلاً سارة، معك يزن. التسليم بكرة الساعة ١٢ إن شاء الله، وبنعتذر مرة ثانية.', 2 * _h),
      (Role.user, 'طيب بس بدي تأكيد مكتوب لو سمحت', 40),
    ],
  ),
  FakeSeed(
    id: 'c_wa_farah',
    channel: Channel.whatsapp,
    name: 'فرح منصور',
    externalUserId: '962781112244',
    displayId: '+962781112244',
    status: ConversationStatus.human,
    handoffReason: 'تريد عرض سعر رسمي على البريد الإلكتروني',
    script: [
      (Role.user, 'مرحبا، ممكن عرض سعر رسمي لموقع شركة؟', 2 * _d),
      (Role.agent, 'أكيد فرح! العرض الرسمي بيطلع من الفريق. حوّلتك لموظف 🙏', 2 * _d - 1),
      (Role.user, 'إيميلي farah@company.jo', 31 * _h),
    ],
  ),
  FakeSeed(
    id: 'c_wa_unknown',
    channel: Channel.whatsapp,
    name: null,
    externalUserId: '966501234567',
    displayId: '+966501234567',
    status: ConversationStatus.bot,
    unread: 1,
    script: [
      (Role.user, 'هل تشتغلون مع عملاء من السعودية؟', 4),
      (Role.agent, 'أكيد! نشتغل عن بعد مع عملاء بالخليج كله، والدفع بالريال متاح. شو المشروع اللي ببالك؟', 3),
    ],
  ),
  FakeSeed(
    id: 'c_wa_layan',
    channel: Channel.whatsapp,
    name: 'ليان حداد',
    externalUserId: '971501112233',
    displayId: '+971501112233',
    status: ConversationStatus.bot,
    script: [
      (Role.user, 'كم مدة تنفيذ الموقع التعريفي؟', 2 * _h + 10),
      (Role.agent, 'عادةً من أسبوعين لثلاثة حسب المحتوى. إذا المحتوى جاهز ممكن أسرع.', 2 * _h + 9),
      (Role.user, 'تمام شكراً', 2 * _h),
      (Role.agent, 'العفو ليان، أي وقت 🌷', 2 * _h - 1),
    ],
  ),
  FakeSeed(
    id: 'c_wa_rana',
    channel: Channel.whatsapp,
    name: 'رنا القيسي',
    externalUserId: '962777889900',
    displayId: '+962777889900',
    status: ConversationStatus.bot,
    script: [
      (Role.user, 'بتعملوا تصميم شعارات؟', 20 * _h + 30),
      (Role.agent, 'حالياً تركيزنا على المواقع والمتاجر والتطبيقات، بس ممكن نرشحلك مصممين موثوقين 👌', 20 * _h + 29),
      (Role.user, 'ياريت', 20 * _h),
      (Role.agent, 'رح يتواصل معك الفريق بأسماء مقترحة.', 20 * _h - 1),
    ],
  ),
  FakeSeed(
    id: 'c_wa_mohammad',
    channel: Channel.whatsapp,
    name: 'محمد يوسف',
    externalUserId: '962785551234',
    displayId: '+962785551234',
    status: ConversationStatus.bot,
    script: [
      (Role.user, 'عندكم استضافة؟', 2 * _d + 5 * _h),
      (Role.agent, 'نعم، الاستضافة السنوية ضمن كل باقاتنا للسنة الأولى مجاناً.', 2 * _d + 5 * _h - 1),
    ],
  ),
  FakeSeed(
    id: 'c_wa_khaled',
    channel: Channel.whatsapp,
    name: 'خالد العمري',
    externalUserId: '962796665544',
    displayId: '+962796665544',
    status: ConversationStatus.closed,
    script: [
      (Role.user, 'وصلني الموقع، شكراً إلكم', 5 * _d),
      (Role.human, 'الشكر إلك خالد، بالتوفيق 🎉', 5 * _d - 30),
    ],
  ),
  FakeSeed(
    id: 'c_wa_omar',
    channel: Channel.whatsapp,
    name: 'عمر الشريف',
    externalUserId: '201001234567',
    displayId: '+201001234567',
    status: ConversationStatus.bot,
    script: [
      (Role.user, 'عايز أعرف تكلفة تطبيق توصيل', 9 * _d),
      (Role.agent, 'تطبيقات التوصيل تختلف حسب المزايا. ممكن تقولي عدد المطاعم المتوقّع وهل في تتبّع مباشر؟', 9 * _d - 1),
    ],
  ),
  FakeSeed(
    id: 'c_wa_hala',
    channel: Channel.whatsapp,
    name: 'هلا البدور',
    externalUserId: '962790001122',
    displayId: '+962790001122',
    status: ConversationStatus.bot,
    script: [
      (Role.user, 'بدي أضيف بوابة دفع لموقعي الحالي', 6 * _h),
      (Role.agent, 'ممكن! بندعم البطاقات وCliQ وApple Pay. موقعك مبني على أي منصة؟', 6 * _h - 1),
    ],
  ),
  FakeSeed(
    id: 'c_wa_tareq',
    channel: Channel.whatsapp,
    name: 'طارق',
    externalUserId: '962799998877',
    displayId: '+962799998877',
    status: ConversationStatus.bot,
    script: [
      (Role.user, '؟', 3 * _d),
      (Role.agent, 'أهلاً طارق! كيف بقدر أساعدك؟', 3 * _d - 1),
    ],
  ),

  // ───────────── إنستغرام ─────────────
  FakeSeed(
    id: 'c_ig_nour',
    channel: Channel.instagram,
    name: 'نور | Nour',
    externalUserId: '17841400123456789',
    displayId: '17841400123456789',
    status: ConversationStatus.bot,
    unread: 1,
    script: [
      (Role.user, 'شفت إعلانكم 😍 السعر بيشمل التصوير؟', 12),
      (Role.agent, 'أهلاً نور! التصوير مش ضمن الباقة، بس عنا شريك تصوير بخصم ١٥٪ لعملائنا.', 11),
    ],
  ),
  FakeSeed(
    id: 'c_ig_dana',
    channel: Channel.instagram,
    name: 'dana.designs',
    externalUserId: '17841400987654321',
    displayId: '17841400987654321',
    status: ConversationStatus.bot,
    script: [
      (Role.user, 'Do you speak English?', 5 * _h),
      (Role.agent, 'Of course! How can we help you today?', 5 * _h - 1),
    ],
  ),
  FakeSeed(
    id: 'c_ig_noname',
    channel: Channel.instagram,
    name: null,
    externalUserId: '17841400555000111',
    displayId: '17841400555000111',
    status: ConversationStatus.bot,
    script: [
      (Role.user, 'كم سعر المتجر؟', 30 * _h),
      (Role.agent, 'باقة المتجر تبدأ من ٦٠٠ دينار وتشمل الدفع والتوصيل.', 30 * _h - 1),
    ],
  ),
  FakeSeed(
    id: 'c_ig_yazan',
    channel: Channel.instagram,
    name: 'يزن 🎧',
    externalUserId: '17841400222333444',
    displayId: '17841400222333444',
    status: ConversationStatus.closed,
    script: [
      (Role.user, 'شكراً على المساعدة', 4 * _d),
    ],
  ),

  // ───────────── ماسنجر ─────────────
  FakeSeed(
    id: 'c_ms_ali',
    channel: Channel.messenger,
    name: 'علي الزعبي',
    externalUserId: '6123456789012345',
    displayId: '6123456789012345',
    status: ConversationStatus.human,
    handoffReason: 'طلب استرجاع دفعة مقدّمة',
    unread: 1,
    script: [
      (Role.user, 'دفعت عربون وبدي ألغي المشروع', 50),
      (Role.agent, 'وصلني طلبك علي. الاسترجاع بيتم عن طريق الفريق المالي، حوّلتك لموظف.', 49),
      (Role.user, 'متى برجعلي المبلغ؟', 15),
    ],
  ),
  FakeSeed(
    id: 'c_ms_mais',
    channel: Channel.messenger,
    name: 'ميس',
    externalUserId: '6123456789099999',
    displayId: '6123456789099999',
    status: ConversationStatus.bot,
    unread: 2,
    script: [
      (Role.user, 'مرحبا', 8),
      (Role.agent, 'أهلاً ميس! كيف بقدر أساعدك؟', 7),
      (Role.user, 'بدي موقع لعيادتي', 6),
      (Role.user, 'مع حجز مواعيد', 6),
      (Role.agent, 'رائع! عنا نظام حجز مواعيد جاهز مع تذكير تلقائي للمرضى. بتحبي أرسلك مثال؟', 5),
    ],
  ),
  FakeSeed(
    id: 'c_ms_basel',
    channel: Channel.messenger,
    name: 'باسل',
    externalUserId: '6123456789077777',
    displayId: '6123456789077777',
    status: ConversationStatus.bot,
    script: [
      (Role.user, 'وين مكانكم؟', 3 * _d),
      (Role.agent, 'مكتبنا بعمّان - الشميساني، وبنشتغل كمان عن بعد.', 3 * _d - 1),
    ],
  ),
];

const fakeTemplates = <MessageTemplate>[
  MessageTemplate(
    name: 'mutabaa_talab',
    language: 'ar',
    category: 'UTILITY',
    body: 'مرحباً {{1}}، نتابع معك بخصوص طلبك رقم {{2}}. هل تحتاج أي مساعدة؟',
    variables: 2,
  ),
  MessageTemplate(
    name: 'ahlan_bik',
    language: 'ar',
    category: 'MARKETING',
    body: 'أهلاً {{1}} 👋 شكراً لتواصلك مع شيفرة كود. كيف نقدر نساعدك اليوم؟',
    variables: 1,
  ),
  MessageTemplate(
    name: 'tadhkeer_mawid',
    language: 'ar',
    category: 'UTILITY',
    body: 'تذكير: موعدك معنا يوم {{1}} الساعة {{2}}. للتأجيل ردّ على هذه الرسالة.',
    variables: 2,
  ),
  MessageTemplate(
    name: 'ard_khas',
    language: 'ar',
    category: 'MARKETING',
    body: 'عرض خاص هذا الأسبوع: خصم ٢٠٪ على باقات المتاجر الإلكترونية. ردّ بكلمة «نعم» لنرسل التفاصيل.',
    variables: 0,
  ),
];

/// رسائل «تصل» دورياً في الوضع الوهمي، مع رد الوكيل عليها.
const fakeLiveLines = <(String, String)>[
  ('بتقدروا تبدأوا الشغل الأسبوع الجاي؟', 'أكيد! بنحتاج بس نثبّت المتطلبات ونبدأ مباشرة.'),
  ('في تقسيط؟', 'نعم، الدفع على ثلاث دفعات حسب مراحل المشروع.'),
  ('شو الفرق بين الباقة الأساسية والمتقدمة؟', 'المتقدمة بتضيف لوحة تحكم كاملة وتقارير مبيعات وربط مع أنظمة المحاسبة.'),
  ('ممكن رقم حدا من الفريق؟', 'أكيد، بحوّلك لموظف يتواصل معك مباشرة.'),
];
