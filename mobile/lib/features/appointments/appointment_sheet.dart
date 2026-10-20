import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/feedback.dart';
import '../../core/format.dart';
import '../../data/appointments.dart';
import '../../data/schedule.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import 'appointments_controller.dart';
import 'appt_style.dart';
import 'customer_profile_screen.dart';
import 'staff_avatar.dart';

Future<void> showAppointmentSheet(BuildContext context, Appointment a) => showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => AppointmentSheet(initial: a),
    );

/// تفاصيل موعد وإجراءاته.
///
/// تقرأ الموعد من مزوّد اليوم لا من نسخة ثابتة: بعد «بدأت» تتغيّر الأزرار في
/// الورقة نفسها فوراً (متفائلاً)، وتعود إن رفض الخادم — بلا إغلاق وإعادة فتح.
class AppointmentSheet extends ConsumerWidget {
  const AppointmentSheet({super.key, required this.initial});

  final Appointment initial;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final day = ref.watch(appointmentsDayProvider);
    final a = day.items.where((x) => x.id == initial.id).firstOrNull ?? initial;
    final service = day.serviceOf(a);
    final staff = day.staffById(a.staffId);
    final color = statusColor(hc, a.status);
    final pending = day.pending.contains(a.id);
    // الموعد هنا من مزوّد اليوم — بوقت جدار المتجر، فـ«الآن» كذلك.
    final span = displaySpan(a, ref.watch(storeClockProvider).wallNow());
    final currency = ref.watch(currencyProvider);
    final phone = a.customer?.phone;

    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(customerLabel(a.customer), key: const Key('sheet.customer'), style: tt.titleLarge),
                    if (phone != null && a.customer?.name != null)
                      LtrText(formatPhone(phone), style: tt.bodySmall?.copyWith(color: hc.text3)),
                  ],
                ),
              ),
              _StatusChip(status: a.status, color: color),
            ],
          ),
          const SizedBox(height: 16),
          SurfaceCardInline(
            children: [
              _InfoLine(icon: Icons.design_services_outlined, label: 'الخدمة', value: service?.name ?? '—'),
              _InfoLine(
                icon: Icons.schedule_rounded,
                label: 'الوقت',
                value: timeRange(span.start, span.end),
              ),
              _InfoLine(
                key: const Key('sheet.duration'),
                icon: Icons.hourglass_bottom_rounded,
                label: 'المدة المحجوزة',
                value: durationBasisText(a.plannedMinutes, a.estimate),
              ),
              if (a.actualMinutes != null)
                _InfoLine(icon: Icons.timer_outlined, label: 'المدة الفعلية', value: arMinutes(a.actualMinutes!)),
              if (service != null && service.hasProcessing)
                _InfoLine(
                  icon: Icons.texture_rounded,
                  label: 'وقت انتظار',
                  value: '${arMinutes(service.processingMinutes)} بعد ${arMinutes(service.processingAfterMinutes)} — مقدّم الخدمة حرّ خلاله',
                ),
              if (staff != null)
                _InfoLine(
                  icon: Icons.person_outline_rounded,
                  label: 'مقدّم الخدمة',
                  value: staff.name,
                  leading: StaffAvatar(staff: staff, size: 22),
                ),
              _InfoLine(
                icon: Icons.payments_outlined,
                label: a.finalPrice != null ? 'المدفوع' : 'السعر',
                value: a.finalPrice != null ? money(a.finalPrice!, currency) : (service == null ? '—' : priceRange(service, currency)),
              ),
              if (a.source != AppointmentSource.unknown)
                _InfoLine(icon: Icons.call_received_rounded, label: 'المصدر', value: a.source.label),
              if (a.notes != null) _InfoLine(icon: Icons.sticky_note_2_outlined, label: 'ملاحظات الزيارة', value: a.notes!),
            ],
          ),
          const SizedBox(height: 16),
          ..._actions(context, ref, a, service, pending),
          const SizedBox(height: 6),
          TextButton.icon(
            key: const Key('sheet.profile'),
            onPressed: a.customerId.isEmpty
                ? null
                : () => Navigator.of(context).push(CustomerProfileScreen.route(a.customerId)),
            icon: const Icon(Icons.badge_outlined),
            label: const Text('ملف العميل والزيارات السابقة'),
          ),
        ],
      ),
    );
  }

  List<Widget> _actions(BuildContext context, WidgetRef ref, Appointment a, ServiceOffering? service, bool pending) {
    final hc = context.hc;
    final allowed = AppointmentAction.allowedFor(a.status);
    if (allowed.isEmpty) return const [];
    final primary = allowed.first;
    final rest = allowed.skip(1).toList();

    Future<void> run(AppointmentAction action) async {
      if (action == AppointmentAction.finish) {
        final r = await showFinishSheet(context, a, service, ref.read(currencyProvider));
        if (r == null) return;
        unawaited(HapticFeedback.mediumImpact());
        final err = await ref
            .read(appointmentsDayProvider.notifier)
            .act(a.id, action, finalPrice: r.price, notes: r.notes);
        if (err != null) showToast(err);
        return;
      }
      if (action == AppointmentAction.cancel || action == AppointmentAction.noShow) {
        final ok = await _confirm(context, action);
        if (ok != true) return;
      }
      unawaited(action == AppointmentAction.cancel || action == AppointmentAction.noShow
          ? HapticFeedback.heavyImpact()
          : HapticFeedback.mediumImpact());
      final err = await ref.read(appointmentsDayProvider.notifier).act(a.id, action);
      if (err != null) {
        unawaited(HapticFeedback.vibrate());
        showToast(err);
      }
    }

    return [
      FilledButton.icon(
        key: Key('action.${primary.wire}'),
        onPressed: pending ? null : () => run(primary),
        icon: Icon(actionIcon(primary)),
        label: Text(primary.label),
      ),
      if (rest.isNotEmpty) ...[
        const SizedBox(height: 10),
        Row(
          children: [
            for (var i = 0; i < rest.length; i++) ...[
              if (i > 0) const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  key: Key('action.${rest[i].wire}'),
                  onPressed: pending ? null : () => run(rest[i]),
                  style: rest[i] == AppointmentAction.cancel || rest[i] == AppointmentAction.noShow
                      ? OutlinedButton.styleFrom(foregroundColor: hc.danger, side: BorderSide(color: hc.danger.withValues(alpha: 0.4)))
                      : null,
                  icon: Icon(actionIcon(rest[i]), size: 18),
                  label: Text(rest[i].label),
                ),
              ),
            ],
          ],
        ),
      ],
    ];
  }

  Future<bool?> _confirm(BuildContext context, AppointmentAction action) => showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(action == AppointmentAction.cancel ? 'إلغاء الموعد؟' : 'تسجيل غياب؟'),
          content: Text(action == AppointmentAction.cancel
              ? 'يتحرّر الوقت فوراً لحجز آخر.'
              : 'يُسجَّل في ملف العميل ويتحرّر الوقت. استخدمه فقط إن لم يحضر.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('تراجع')),
            TextButton(
              key: const Key('confirm.yes'),
              onPressed: () => Navigator.pop(ctx, true),
              style: TextButton.styleFrom(foregroundColor: ctx.hc.danger),
              child: Text(action.label),
            ),
          ],
        ),
      );
}

typedef FinishResult = ({double? price, String? notes});

/// «خلصت»: السعر النهائي (مقترح مسبقاً) وملاحظات الزيارة.
///
/// الملاحظات هي ذاكرة النشاط: «شو اللي عملتولي آخر مرة؟» يُجاب منها —
/// رقم لون، جرعة، قطعة غيار. لذا تُطلب هنا لحظة انتهاء الجلسة، لا لاحقاً.
Future<FinishResult?> showFinishSheet(BuildContext context, Appointment a, ServiceOffering? service, [String? currency]) =>
    showModalBottomSheet<FinishResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _FinishSheet(appointment: a, service: service, currency: currency),
    );

class _FinishSheet extends StatefulWidget {
  const _FinishSheet({required this.appointment, required this.service, this.currency});

  final Appointment appointment;
  final ServiceOffering? service;
  final String? currency;

  @override
  State<_FinishSheet> createState() => _FinishSheetState();
}

class _FinishSheetState extends State<_FinishSheet> {
  late final TextEditingController _price;
  late final TextEditingController _notes;
  String? _error;

  @override
  void initState() {
    super.initState();
    final suggested = widget.appointment.suggestedPrice ?? widget.service?.priceMin;
    _price = TextEditingController(text: suggested == null ? '' : _plain(suggested));
    _notes = TextEditingController(text: widget.appointment.notes ?? '');
  }

  static String _plain(double v) => v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(2);

  @override
  void dispose() {
    _price.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _submit() {
    final raw = arToAsciiDigits(_price.text.trim()).replaceAll('٫', '.').replaceAll(',', '.');
    double? p;
    if (raw.isNotEmpty) {
      p = double.tryParse(raw);
      if (p == null || p < 0 || p > 1000000) {
        setState(() => _error = 'أدخل سعراً صحيحاً.');
        return;
      }
    }
    final notes = _notes.text.trim();
    Navigator.of(context).pop((price: p, notes: notes.isEmpty ? null : notes));
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final hc = context.hc;
    final s = widget.service;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('إنهاء الزيارة', style: tt.titleLarge),
          const SizedBox(height: 4),
          Text(
            s == null ? 'السعر النهائي وملاحظات الزيارة.' : '${s.name} · السعر عادةً ${priceRange(s, widget.currency)}',
            style: tt.bodySmall,
          ),
          const SizedBox(height: 16),
          TextField(
            key: const Key('finish.price'),
            controller: _price,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            textInputAction: TextInputAction.next,
            decoration: InputDecoration(
              labelText: 'السعر النهائي',
              suffixText: currencyLabel(widget.currency),
              prefixIcon: const Icon(Icons.payments_outlined),
              errorText: _error,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            key: const Key('finish.notes'),
            controller: _notes,
            minLines: 2,
            maxLines: 5,
            maxLength: 1000,
            decoration: const InputDecoration(
              labelText: 'ملاحظات الزيارة (اختياري)',
              hintText: 'ما يفيد في المرة القادمة: المواد، الأرقام، التفضيلات…',
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 8),
          Text('تظهر في ملف العميل، ويستعين بها الوكيل حين يسأل عن زيارته السابقة.',
              style: tt.bodySmall?.copyWith(color: hc.text3)),
          const SizedBox(height: 16),
          FilledButton.icon(
            key: const Key('finish.submit'),
            onPressed: _submit,
            icon: const Icon(Icons.flag_rounded),
            label: const Text('خلصت'),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status, required this.color});
  final AppointmentStatus status;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        key: const Key('sheet.status'),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(20)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(statusIcon(status), size: 15, color: color),
            const SizedBox(width: 5),
            Text(status.label,
                style: TextStyle(fontFamily: kFont, fontSize: 12.5, fontWeight: FontWeight.w700, color: color, height: 1.2)),
          ],
        ),
      );
}

/// بطاقة معلومات داخل ورقة (بلا هامش أفقي — الورقة لها هامشها).
class SurfaceCardInline extends StatelessWidget {
  const SurfaceCardInline({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Container(
      decoration: BoxDecoration(
        color: hc.surface2,
        borderRadius: BorderRadius.circular(R.lg),
        border: Border.all(color: hc.border),
      ),
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(children: children),
    );
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({super.key, required this.icon, required this.label, required this.value, this.leading});

  final IconData icon;
  final String label;
  final String value;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 2), child: Icon(icon, size: 17, color: hc.text3)),
          const SizedBox(width: 10),
          SizedBox(
            width: 96,
            child: Text(label, style: TextStyle(fontFamily: kFont, fontSize: 13, color: hc.text2, height: 1.45)),
          ),
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (leading != null) ...[leading!, const SizedBox(width: 6)],
                Expanded(
                  child: Text(
                    value,
                    style: TextStyle(fontFamily: kFont, fontSize: 13.5, fontWeight: FontWeight.w600, color: hc.text, height: 1.45),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
