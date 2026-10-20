import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/feedback.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/store_clock.dart';
import '../../data/appointments.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import 'appointments_controller.dart';
import 'appt_style.dart';
import 'customers_screen.dart';
import 'date_strip.dart';

/// حجز من التطبيق — العميل الحاضر أو المتصل (العقد: «حضوري/هاتف»).
///
/// الترتيب مقصود: العميل أولاً، لأن المدة تُقدَّر **له هو** (القاعدة ١)؛
/// الأوقات المعروضة بعده تختلف بين عميل قصّته ١٥ دقيقة وآخر قصّته ساعة.
class NewAppointmentScreen extends ConsumerStatefulWidget {
  const NewAppointmentScreen({super.key, required this.date, this.staffId, this.preferredStart});

  final DateTime date;
  final String? staffId;

  /// من لمسة على «متاح» في الخط الزمني: يُختار هذا الوقت إن كان ضمن المقترح.
  final DateTime? preferredStart;

  static Route<Appointment?> route({required DateTime date, String? staffId, DateTime? preferredStart}) =>
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => NewAppointmentScreen(date: date, staffId: staffId, preferredStart: preferredStart),
      );

  @override
  ConsumerState<NewAppointmentScreen> createState() => _NewAppointmentScreenState();
}

class _NewAppointmentScreenState extends ConsumerState<NewAppointmentScreen> {
  Customer? _customer;
  ServiceOffering? _service;
  String? _staffId; // null = أيّ أحد
  late DateTime _date = dayOf(widget.date);
  SlotOption? _slot;
  AppointmentSource _source = AppointmentSource.walkIn;
  final _notes = TextEditingController();

  SlotsResult? _slots;
  bool _loadingSlots = false;
  String? _slotsError;
  int _slotsSeq = 0;
  bool _booking = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _staffId = widget.staffId;
  }

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  Future<void> _loadSlots() async {
    final svc = _service;
    if (svc == null) return;
    final seq = ++_slotsSeq;
    setState(() {
      _loadingSlots = true;
      _slotsError = null;
      _slot = null;
    });
    try {
      final r = await ref.read(apiProvider).appointmentSlots(
            serviceId: svc.id,
            staffId: _staffId,
            date: isoDay(_date),
            customerId: _customer?.id,
          );
      if (!mounted || seq != _slotsSeq) return;
      final pref = widget.preferredStart;
      final clock = ref.read(storeClockProvider);
      setState(() {
        _slots = r;
        _loadingSlots = false;
        if (pref != null) {
          // الوقت الملموس في الخط الزمني بوقت جدار المتجر؛ المقترح بلحظات الخادم.
          _slot = r.slots
              .where((s) => clock.wall(s.startAt).isAtSameMomentAs(pref) && (_staffId == null || s.staffId == _staffId))
              .firstOrNull;
        }
      });
    } on ApiError catch (e) {
      if (!mounted || seq != _slotsSeq) return;
      setState(() {
        _loadingSlots = false;
        _slotsError = e.message;
      });
    }
  }

  Future<void> _book() async {
    final c = _customer;
    final svc = _service;
    final slot = _slot;
    if (c == null || svc == null || slot == null || _booking) return;
    setState(() {
      _booking = true;
      _error = null;
    });
    try {
      final a = await ref.read(apiProvider).createAppointment(NewAppointment(
            customerId: c.id,
            serviceId: svc.id,
            staffId: slot.staffId,
            startAt: slot.startAt,
            plannedMinutes: _slots?.estimate?.minutes,
            source: _source,
            notes: _notes.text,
          ));
      unawaited(HapticFeedback.mediumImpact());
      ref.read(appointmentsDayProvider.notifier).upsert(a);
      showToast('حُجز الموعد · ${clockTime(ref.read(storeClockProvider).wall(a.startAt))}');
      if (mounted) Navigator.of(context).pop(a);
    } on ApiError catch (e) {
      unawaited(HapticFeedback.vibrate());
      if (!mounted) return;
      setState(() {
        _booking = false;
        _error = AppointmentsDayController.messageFor(e);
      });
      // الوقت أُخذ: نُحدّث المقترح فوراً كي لا يختار المالك وقتاً ميتاً آخر.
      if (e.code == ApiErrorCode.slotTaken) await _loadSlots();
    }
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final services = ref.watch(servicesProvider);
    final staff = ref.watch(staffProvider).value ?? const <StaffMember>[];
    final staffName = {for (final s in staff) s.id: s.name};
    final ready = _customer != null && _service != null && _slot != null;
    final clock = ref.watch(storeClockProvider);
    final currency = ref.watch(currencyProvider);

    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(
        title: const Text('موعد جديد'),
        leading: IconButton(
          tooltip: 'إغلاق',
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, 4, 16, 40 + MediaQuery.paddingOf(context).bottom),
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        children: [
          const _Step(n: 1, title: 'العميل'),
          if (_customer == null)
            CustomerSearch(
              compact: true,
              onPick: (c) {
                setState(() => _customer = c);
                if (_service != null) unawaited(_loadSlots());
              },
            )
          else
            _SelectedCustomer(
              customer: _customer!,
              onClear: () => setState(() {
                _customer = null;
                _slot = null;
              }),
            ),
          const SizedBox(height: 14),
          const _Step(n: 2, title: 'الخدمة'),
          services.when(
            loading: () => const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
            error: (e, _) => StateMessage(
              icon: Icons.cloud_off_rounded,
              title: 'تعذّر تحميل الخدمات',
              body: e is ApiError ? e.message : null,
              actionLabel: 'إعادة المحاولة',
              onAction: () => ref.invalidate(servicesProvider),
            ),
            data: (list) => list.isEmpty
                ? const _WebOnlyNote(text: 'لا خدمات بعد. أضف الخدمات والفريق من لوحة الويب — إدارتهما من التطبيق غير متاحة حالياً.')
                : Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final s in list)
                        ChoiceChip(
                          key: Key('svc.${s.id}'),
                          selected: _service?.id == s.id,
                          onSelected: (_) {
                            setState(() {
                              _service = s;
                              if (_staffId != null && !(staff.where((x) => x.id == _staffId).firstOrNull?.offers(s.id) ?? true)) {
                                _staffId = null;
                              }
                            });
                            unawaited(_loadSlots());
                          },
                          label: Text('${s.name} · ${priceRange(s, currency)}'),
                          selectedColor: hc.liveDim,
                          side: BorderSide(color: _service?.id == s.id ? hc.live : hc.border),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: 14),
          const _Step(n: 3, title: 'مقدّم الخدمة'),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ChoiceChip(
                key: const Key('staff.any'),
                selected: _staffId == null,
                onSelected: (_) {
                  setState(() => _staffId = null);
                  unawaited(_loadSlots());
                },
                label: const Text('أيّ أحد متاح'),
                selectedColor: hc.liveDim,
              ),
              for (final s in staff)
                if (_service == null || s.offers(_service!.id))
                  ChoiceChip(
                    key: Key('staff.${s.id}'),
                    selected: _staffId == s.id,
                    onSelected: (_) {
                      setState(() => _staffId = s.id);
                      unawaited(_loadSlots());
                    },
                    label: Text(s.name),
                    selectedColor: hc.liveDim,
                  ),
            ],
          ),
          const SizedBox(height: 14),
          const _Step(n: 4, title: 'اليوم'),
          DateStrip(
            selected: _date,
            today: dayOf(clock.wallNow()),
            daysBack: 0,
            onSelect: (d) {
              setState(() => _date = d);
              unawaited(_loadSlots());
            },
          ),
          const SizedBox(height: 14),
          const _Step(n: 5, title: 'الوقت'),
          _slotsSection(context, staffName, clock),
          const SizedBox(height: 14),
          const _Step(n: 6, title: 'المصدر'),
          SegmentedButton<AppointmentSource>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(value: AppointmentSource.walkIn, label: Text('حضوري'), icon: Icon(Icons.storefront_outlined)),
              ButtonSegment(value: AppointmentSource.phone, label: Text('هاتف'), icon: Icon(Icons.call_outlined)),
            ],
            selected: {_source},
            onSelectionChanged: (s) => setState(() => _source = s.first),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _notes,
            maxLines: 3,
            minLines: 1,
            maxLength: 500,
            decoration: const InputDecoration(labelText: 'ملاحظة للموعد (اختياري)', counterText: ''),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, key: const Key('new.error'), style: tt.bodyMedium?.copyWith(color: hc.danger)),
          ],
          const SizedBox(height: 18),
          FilledButton.icon(
            key: const Key('new.book'),
            onPressed: ready && !_booking ? _book : null,
            icon: _booking
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2.2))
                : const Icon(Icons.event_available_rounded),
            label: Text(ready
                ? 'احجز ${clockTime(clock.wall(_slot!.startAt))} · ${staffName[_slot!.staffId] ?? ''}'
                : 'اختر العميل والخدمة والوقت'),
          ),
          const SizedBox(height: 14),
          const _WebOnlyNote(text: 'إدارة الخدمات والفريق وساعات الدوام من لوحة الويب حالياً.'),
        ],
      ),
    );
  }

  Widget _slotsSection(BuildContext context, Map<String, String> staffName, StoreClock clock) {
    final hc = context.hc;
    if (_service == null) {
      return Text('اختر الخدمة لعرض الأوقات.', style: TextStyle(fontFamily: kFont, color: hc.text3));
    }
    if (_loadingSlots) {
      return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
    }
    if (_slotsError != null) {
      return StateMessage(icon: Icons.cloud_off_rounded, title: 'تعذّر تحميل الأوقات', body: _slotsError, actionLabel: 'إعادة المحاولة', onAction: _loadSlots);
    }
    final r = _slots;
    if (r == null) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (r.estimate != null)
          Container(
            key: const Key('slots.estimate'),
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            decoration: BoxDecoration(color: hc.liveDim, borderRadius: BorderRadius.circular(R.md)),
            child: Row(
              children: [
                Icon(Icons.insights_rounded, size: 17, color: hc.live),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'المدة المتوقّعة: ${durationBasisText(r.estimate!.minutes, r.estimate)}',
                    style: TextStyle(fontFamily: kFont, fontSize: 13, color: hc.text, height: 1.4),
                  ),
                ),
              ],
            ),
          ),
        if (r.slots.isEmpty)
          Text('لا أوقات متاحة في هذا اليوم. جرّب يوماً آخر أو مقدّم خدمة آخر.',
              key: const Key('slots.empty'), style: TextStyle(fontFamily: kFont, color: hc.text3))
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final s in r.slots.take(60))
                ChoiceChip(
                  key: Key('slot.${s.staffId}.${clock.wall(s.startAt).hour}:${clock.wall(s.startAt).minute}'),
                  selected: _slot == s,
                  onSelected: (_) {
                    HapticFeedback.selectionClick();
                    setState(() => _slot = s);
                  },
                  label: Text(_staffId == null
                      ? '${clockTime(clock.wall(s.startAt))} · ${staffName[s.staffId] ?? ''}'
                      : clockTime(clock.wall(s.startAt))),
                  selectedColor: hc.liveDim,
                  side: BorderSide(color: _slot == s ? hc.live : hc.border),
                ),
            ],
          ),
      ],
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.n, required this.title});
  final int n;
  final String title;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Container(
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: BoxDecoration(color: hc.surface3, shape: BoxShape.circle),
            child: Text(arDigits(n), style: TextStyle(fontFamily: kFont, fontSize: 12, fontWeight: FontWeight.w700, color: hc.text2, height: 1.1)),
          ),
          const SizedBox(width: 8),
          Text(title, style: Theme.of(context).textTheme.titleSmall),
        ],
      ),
    );
  }
}

class _SelectedCustomer extends StatelessWidget {
  const _SelectedCustomer({required this.customer, required this.onClear});
  final Customer customer;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Container(
      key: const Key('new.customer'),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: hc.surface,
        borderRadius: BorderRadius.circular(R.md),
        border: Border.all(color: hc.live.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          InitialsAvatar(seed: customer.id, label: customer.name ?? customer.phone ?? '؟', size: 38),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(customer.name ?? 'بدون اسم', style: Theme.of(context).textTheme.titleSmall),
                if (customer.phone != null) LtrText(formatPhone(customer.phone!), style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.text3)),
                if (customer.notes != null)
                  Text(customer.notes!, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.warn)),
              ],
            ),
          ),
          IconButton(tooltip: 'تغيير', onPressed: onClear, icon: const Icon(Icons.swap_horiz_rounded)),
        ],
      ),
    );
  }
}

class _WebOnlyNote extends StatelessWidget {
  const _WebOnlyNote({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(padding: const EdgeInsets.only(top: 2), child: Icon(Icons.language_rounded, size: 15, color: hc.text3)),
        const SizedBox(width: 6),
        Expanded(child: Text(text, style: TextStyle(fontFamily: kFont, fontSize: 12.5, color: hc.text3, height: 1.5))),
      ],
    );
  }
}
