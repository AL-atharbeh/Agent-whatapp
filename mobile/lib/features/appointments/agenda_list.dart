import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/feedback.dart';
import '../../core/format.dart';
import '../../data/appointments.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import 'appointments_controller.dart';
import 'appt_style.dart';
import 'staff_avatar.dart';

/// اليوم كقائمة بطاقات — العرض الافتراضي على الجوال.
///
/// الخط الزمني بأعمدة لكل مقدّم خدمة يصلح لشاشة واسعة؛ على عرض هاتف تضيق
/// الأعمدة حتى تُقصّ الأسماء ويطغى الفراغ على المواعيد. البطاقة تقول كل شيء
/// بسطر قراءة واحد، وزرّ الخطوة التالية عليها مباشرة.
class AgendaList extends ConsumerStatefulWidget {
  const AgendaList({
    super.key,
    required this.state,
    required this.now,
    required this.bottomInset,
    required this.onTapAppointment,
    required this.onNew,
  });

  final DayState state;
  final DateTime now;
  final double bottomInset;
  final ValueChanged<Appointment> onTapAppointment;
  final VoidCallback onNew;

  @override
  ConsumerState<AgendaList> createState() => _AgendaListState();
}

class _AgendaListState extends ConsumerState<AgendaList> {
  /// null = الكل.
  String? _staffId;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final state = widget.state;
    final items = [
      for (final a in state.items)
        if (_staffId == null || a.staffId == _staffId) a,
    ]..sort((a, b) => a.startAt.compareTo(b.startAt));

    // الحيّ أولاً بترتيب الوقت، والمنتهي والملغى في الأسفل — لم يعد يطلب شيئاً
    final open = items.where((a) => !a.status.isFinal).toList();
    final closed = items.where((a) => a.status.isFinal).toList();

    return ListView(
      padding: EdgeInsets.only(bottom: 120 + widget.bottomInset),
      children: [
        if (state.staff.length > 1)
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                _filter(context, null, 'الكل', state.items.where((a) => !a.status.releasesTime).length),
                for (final s in state.staff)
                  _filter(
                    context,
                    s.id,
                    s.name,
                    state.items.where((a) => a.staffId == s.id && !a.status.releasesTime).length,
                    avatar: StaffAvatar(staff: s, size: 22),
                  ),
              ],
            ),
          ),
        const SizedBox(height: 6),
        if (items.isEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 48, 24, 0),
            child: Column(
              children: [
                Icon(Icons.event_available_outlined, size: 44, color: hc.text3),
                const SizedBox(height: 12),
                Text('لا مواعيد', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: widget.onNew,
                  icon: const Icon(Icons.add_rounded),
                  label: const Text('موعد جديد'),
                ),
              ],
            ),
          ),
        for (final a in open) _AgendaCard(appointment: a, state: state, now: widget.now, onTap: widget.onTapAppointment),
        if (closed.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 4),
            child: SectionLabel('انتهى أو أُلغي · ${arDigits(closed.length)}'),
          ),
          for (final a in closed) _AgendaCard(appointment: a, state: state, now: widget.now, onTap: widget.onTapAppointment),
        ],
      ],
    );
  }

  Widget _filter(BuildContext context, String? id, String label, int count, {Widget? avatar}) {
    final selected = _staffId == id;
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 8),
      child: ChoiceChip(
        key: Key('agenda.filter.${id ?? 'all'}'),
        avatar: avatar,
        label: Text(count == 0 ? label : '$label ${arDigits(count)}'),
        selected: selected,
        showCheckmark: false,
        onSelected: (_) => setState(() => _staffId = id),
      ),
    );
  }
}

class _AgendaCard extends ConsumerWidget {
  const _AgendaCard({required this.appointment, required this.state, required this.now, required this.onTap});

  final Appointment appointment;
  final DayState state;
  final DateTime now;
  final ValueChanged<Appointment> onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final a = appointment;
    final service = state.serviceOf(a);
    final staff = state.staffById(a.staffId);
    final color = statusColor(hc, a.status);
    final faded = a.status.isFinal;
    final pending = state.pending.contains(a.id);
    final currency = ref.watch(currencyProvider);

    // متأخر: بدأ وقته ولم يبدأ — هو ما يسبّب التأخير على من بعده
    final late = !a.status.isFinal && a.status != AppointmentStatus.inProgress && now.isAfter(a.startAt.add(const Duration(minutes: 5)));

    final name = a.customer?.name ?? (a.customer?.phone == null ? 'عميل' : formatPhone(a.customer!.phone!));
    final details = [
      service?.name ?? 'خدمة',
      if (staff != null) staff.name,
      arMinutes(a.actualMinutes ?? a.plannedMinutes),
      if (a.finalPrice != null) money(a.finalPrice!, currency) else if (service != null) priceRange(service, currency),
    ].join(' · ');

    // الخطوة التالية مباشرة على البطاقة؛ «انتهى» يحتاج السعر والملاحظات فيفتح الورقة
    final AppointmentAction? next = switch (a.status) {
      AppointmentStatus.booked || AppointmentStatus.confirmed => AppointmentAction.start,
      AppointmentStatus.inProgress => AppointmentAction.finish,
      _ => null,
    };

    Future<void> quick() async {
      if (next == AppointmentAction.finish) {
        onTap(a);
        return;
      }
      unawaited(HapticFeedback.lightImpact());
      final err = await ref.read(appointmentsDayProvider.notifier).act(a.id, next!);
      if (err != null) showToast(err);
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 6),
      child: Opacity(
        opacity: faded ? 0.6 : 1,
        child: Material(
          color: hc.surface,
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(R.lg),
            side: BorderSide(color: a.status == AppointmentStatus.inProgress ? hc.warn.withValues(alpha: 0.6) : hc.border),
          ),
          child: InkWell(
            key: Key('agenda.${a.id}'),
            onTap: () => onTap(a),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(width: 4, color: color),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 14, 4, 14),
                    child: SizedBox(
                      width: 58,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            clockTime(a.startAt),
                            style: TextStyle(fontFamily: kFont, fontSize: 17, fontWeight: FontWeight.w800, color: hc.text),
                          ),
                          Text(
                            clockTime(a.plannedEnd),
                            style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.text3),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(4, 12, 8, 12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(fontFamily: kFont, fontSize: 15.5, fontWeight: FontWeight.w700, color: hc.text),
                                ),
                              ),
                              const SizedBox(width: 8),
                              _Pill(
                                text: late ? 'متأخر' : a.status.label,
                                color: late ? hc.danger : color,
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            details,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontFamily: kFont, fontSize: 13, color: hc.text2, height: 1.35),
                          ),
                          if (a.notes != null && a.notes!.trim().isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              a.notes!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontFamily: kFont, fontSize: 12.5, color: hc.text3),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  if (next != null)
                    Padding(
                      padding: const EdgeInsetsDirectional.only(end: 12),
                      child: Center(
                        child: pending
                            ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2))
                            : FilledButton.tonal(
                                key: Key('agenda.${a.id}.${next.wire}'),
                                onPressed: quick,
                                style: FilledButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(horizontal: 14),
                                  minimumSize: const Size(0, 38),
                                  backgroundColor: next == AppointmentAction.finish ? hc.warnDim : hc.liveDim,
                                  foregroundColor: next == AppointmentAction.finish ? hc.warn : hc.live,
                                ),
                                child: Text(next == AppointmentAction.finish ? 'انتهى' : 'بدأ'),
                              ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.14),
          borderRadius: BorderRadius.circular(99),
        ),
        child: Text(
          text,
          style: TextStyle(fontFamily: kFont, fontSize: 11.5, fontWeight: FontWeight.w700, color: color),
        ),
      );
}
