import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/providers.dart';
import '../../core/store_clock.dart';
import '../../data/appointments.dart';
import '../auth/session_controller.dart';
import '../profile/profile_controller.dart';

class DayState {
  const DayState({
    required this.date,
    this.staff = const [],
    this.items = const [],
    this.services = const {},
    this.loading = true,
    this.error,
    this.pending = const {},
  });

  /// منتصف ليل اليوم المعروض (محلي).
  final DateTime date;
  final List<StaffMember> staff;
  final List<Appointment> items;
  final Map<String, ServiceOffering> services;
  final bool loading;
  final ApiError? error;

  /// مواعيد عليها إجراء لم يردّ عليه الخادم بعد — أزرارها معطّلة.
  final Set<String> pending;

  ServiceOffering? serviceOf(Appointment a) => services[a.serviceId] ?? a.service;

  StaffMember? staffById(String id) => staff.where((s) => s.id == id).firstOrNull;

  DayState copyWith({
    DateTime? date,
    List<StaffMember>? staff,
    List<Appointment>? items,
    Map<String, ServiceOffering>? services,
    bool? loading,
    ApiError? error,
    bool clearError = false,
    Set<String>? pending,
  }) =>
      DayState(
        date: date ?? this.date,
        staff: staff ?? this.staff,
        items: items ?? this.items,
        services: services ?? this.services,
        loading: loading ?? this.loading,
        error: clearError ? null : (error ?? this.error),
        pending: pending ?? this.pending,
      );
}

/// ساعة المتجر من `tenant.timezone` (في /me، أو في رد الدخول قبل وصول /me).
/// يُراقَب الاسم وحده: تغيّر وضع الإشعارات في /me لا يعيد بناء المواعيد.
final storeClockProvider = Provider<StoreClock>((ref) {
  final tzName = ref.watch(meProvider.select((m) => m?.tenant.timezone)) ??
      ref.watch(sessionProvider.select((s) => s?.tenant.timezone));
  return StoreClock(tzName);
});

/// عملة المتجر (`tenant.currency`) أو null.
final currencyProvider = Provider<String?>((ref) =>
    ref.watch(meProvider.select((m) => m?.tenant.currency)) ??
    ref.watch(sessionProvider.select((s) => s?.tenant.currency)));

DateTime dayOf(DateTime t) {
  final l = t.toLocal();
  return DateTime(l.year, l.month, l.day);
}

/// التبويب ظاهر والتطبيق في المقدّمة؟ يضبطه HomeShell. الاستطلاع يعمل فقط
/// حينها — جدول لا يراه أحد لا يستحق طلباً كل ١٠ ثوانٍ.
final appointmentsVisibleProvider = NotifierProvider<AppointmentsVisible, bool>(AppointmentsVisible.new);

class AppointmentsVisible extends Notifier<bool> {
  @override
  bool build() => false;

  void set(bool v) {
    if (v != state) state = v;
  }
}

final appointmentsDayProvider = NotifierProvider<AppointmentsDayController, DayState>(AppointmentsDayController.new);

/// يوم المواعيد المعروض: تحميل، استطلاع، وإجراءات متفائلة.
class AppointmentsDayController extends Notifier<DayState> {
  static const pollEvery = Duration(seconds: 10);

  Timer? _timer;
  Future<void>? _loading;

  /// رقم الطلب الأحدث: ردّ يوم قديم (المستخدم سحب ليوم آخر أثناء التحميل)
  /// لا يكتب فوق اليوم الجديد.
  int _requestSeq = 0;

  StoreClock _clock = const StoreClock.device();

  /// «الآن» بوقت جدار المتجر. يُحقن في الاختبارات.
  late DateTime Function() now = () => _clock.wallNow();

  @override
  DayState build() {
    ref.watch(accountKeyProvider);
    // منطقة المتجر وصلت أو تغيّرت ⇒ يُعاد البناء: الكتل المحوّلة بمنطقة
    // سابقة لا تبقى على الشاشة.
    _clock = ref.watch(storeClockProvider);
    ref.onDispose(_stop);
    ref.listen(appointmentsVisibleProvider, (_, visible) => visible ? _start() : _stop());
    // ظاهر قبل أن يُبنى المزوّد؟ نبدأ بعد البناء — لا قراءة لـstate داخله.
    if (ref.read(appointmentsVisibleProvider)) Future.microtask(_start);
    return DayState(date: dayOf(now()));
  }

  void _start() {
    _timer?.cancel();
    _timer = Timer.periodic(pollEvery, (_) => unawaited(refresh(silent: true)));
    unawaited(refresh(silent: true));
  }

  void _stop() {
    _timer?.cancel();
    _timer = null;
  }

  bool get isPolling => _timer != null;

  Future<void> selectDate(DateTime day) async {
    final d = dayOf(day);
    if (d == state.date && !state.loading) return;
    // يوم جديد: لا نُبقي كتل اليوم السابق تحت عنوان اليوم الجديد ولو لحظة.
    state = DayState(date: d, staff: state.staff, services: state.services);
    _loading = null;
    await refresh();
  }

  /// [silent]: استطلاع خلفي — خطؤه لا يمسح ما على الشاشة.
  Future<void> refresh({bool silent = false}) => _loading ??= _fetch(silent).whenComplete(() => _loading = null);

  Future<void> _fetch(bool silent) async {
    final seq = ++_requestSeq;
    final date = state.date;
    final api = ref.read(apiProvider);
    try {
      final day = await api.appointmentsDay(isoDay(date));
      var services = state.services;
      if (day.services.isNotEmpty) {
        services = {for (final s in day.services) s.id: s};
      } else if (services.isEmpty) {
        try {
          services = {for (final s in await api.services()) s.id: s};
        } on ApiError {
          // الخدمات تكمّل الرسم (وقت الانتظار)؛ غيابها لا يمنع عرض اليوم.
        }
      }
      if (!ref.mounted || seq != _requestSeq || date != state.date) return;
      // إجراء متفائل لم يُحسم بعد يبقى كما هو — الاستطلاع لا يعيد الزر لحالته القديمة.
      final optimistic = {for (final a in state.items) if (state.pending.contains(a.id)) a.id: a};
      state = state.copyWith(
        staff: (day.staff.where((s) => s.active).toList()..sort((a, b) => a.sortOrder.compareTo(b.sortOrder))),
        items: [for (final a in day.items) optimistic[a.id] ?? a.mapTimes(_clock.wall)],
        services: services,
        loading: false,
        clearError: true,
      );
    } on ApiError catch (e) {
      if (!ref.mounted || seq != _requestSeq) return;
      state = silent && state.items.isNotEmpty ? state.copyWith(loading: false) : state.copyWith(loading: false, error: e);
    }
  }

  /// إجراء متفائل: الحالة تتغيّر فوراً وتُعاد إن رفض الخادم. يعيد رسالة الخطأ.
  Future<String?> act(String id, AppointmentAction action, {double? finalPrice, String? notes}) async {
    final before = state.items.where((a) => a.id == id).firstOrNull;
    if (before == null || state.pending.contains(id)) return null;
    final t = now();
    final optimistic = before.copyWith(
      status: action.target,
      startedAt: action == AppointmentAction.start ? t : null,
      finishedAt: action == AppointmentAction.finish ? t : null,
      finalPrice: finalPrice,
      notes: notes,
    );
    _replace(optimistic, pendingAdd: id);
    try {
      final server = await ref.read(apiProvider).appointmentAction(id, action, finalPrice: finalPrice, notes: notes);
      if (!ref.mounted) return null;
      _replace(server.mapTimes(_clock.wall), pendingRemove: id);
      return null;
    } on ApiError catch (e) {
      if (!ref.mounted) return e.message;
      _replace(before, pendingRemove: id);
      return messageFor(e);
    }
  }

  /// بعد إنشاء موعد أو تعديله من شاشة أخرى — [server] بلحظات الخادم.
  void upsert(Appointment server) {
    final a = server.mapTimes(_clock.wall);
    if (dayOf(a.startAt) != state.date) return;
    final exists = state.items.any((x) => x.id == a.id);
    state = state.copyWith(items: exists ? [for (final x in state.items) x.id == a.id ? a : x] : [...state.items, a]);
  }

  void _replace(Appointment a, {String? pendingAdd, String? pendingRemove}) {
    final pending = {...state.pending};
    if (pendingAdd != null) pending.add(pendingAdd);
    if (pendingRemove != null) pending.remove(pendingRemove);
    state = state.copyWith(items: [for (final x in state.items) x.id == a.id ? a : x], pending: pending);
  }

  /// رسائل الإجراءات بلغة المالك — رمز الخادم يحدّد المعنى لا نصّه.
  static String messageFor(ApiError e) => switch (e.code) {
        ApiErrorCode.slotTaken => 'أُخذ هذا الوقت للتو. اختر وقتاً آخر.',
        ApiErrorCode.notFound => 'هذا الموعد لم يعد موجوداً — حدّث الصفحة.',
        ApiErrorCode.network || ApiErrorCode.timeout => 'لا اتصال — لم يُحفظ الإجراء. حاول مرة أخرى.',
        _ => e.message,
      };
}

/// الخدمات (للحجز الجديد). تُجلب مرة لكل جلسة.
final servicesProvider = FutureProvider<List<ServiceOffering>>((ref) async {
  ref.watch(accountKeyProvider);
  final list = await ref.read(apiProvider).services();
  return list.where((s) => s.active).toList();
}, retry: (_, _) => null);

/// الفريق — من يوم المواعيد إن حُمّل، وإلا من GET /staff.
final staffProvider = FutureProvider<List<StaffMember>>((ref) async {
  ref.watch(accountKeyProvider);
  final fromDay = ref.read(appointmentsDayProvider).staff;
  if (fromDay.isNotEmpty) return fromDay;
  final list = await ref.read(apiProvider).staff();
  return list.where((s) => s.active).toList()..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
}, retry: (_, _) => null);

/// صورة مقدّم الخدمة — تُجلب مرة وتبقى في الذاكرة (المزوّد غير مؤقّت)،
/// فلا يُعاد تنزيلها مع كل استطلاع أو تمرير. خطأ الشبكة ⇒ null (الحروف الأولى).
final staffPhotoProvider = FutureProvider.family<Uint8List?, String>((ref, id) async {
  ref.watch(accountKeyProvider);
  try {
    return await ref.read(apiProvider).staffPhoto(id);
  } on ApiError {
    return null;
  }
}, retry: (_, _) => null);

final customerProfileProvider =
    FutureProvider.autoDispose.family<CustomerProfile, String>((ref, id) => ref.read(apiProvider).customerProfile(id), retry: (_, _) => null);
