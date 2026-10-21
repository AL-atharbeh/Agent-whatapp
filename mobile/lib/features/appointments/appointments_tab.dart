import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/now.dart';
import '../../data/appointments.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../../ui/widgets/glass.dart';
import 'agenda_list.dart';
import 'appointment_sheet.dart';
import 'appointments_controller.dart';
import 'appt_style.dart';
import 'customers_screen.dart';
import 'manage/manage_screen.dart';
import 'date_strip.dart';
import 'new_appointment_screen.dart';
import 'timeline_view.dart';

/// قائمة (الافتراضي) أو خط زمني بأعمدة — اختيار الجلسة.
final agendaListModeProvider = NotifierProvider<AgendaListMode, bool>(AgendaListMode.new);

class AgendaListMode extends Notifier<bool> {
  @override
  bool build() => true;

  void set(bool list) => state = list;
}

/// تبويب «المواعيد» — يظهر فقط حين تكون الوحدة مفعّلة للمتجر.
class AppointmentsTab extends ConsumerWidget {
  const AppointmentsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final state = ref.watch(appointmentsDayProvider);
    final ctrl = ref.read(appointmentsDayProvider.notifier);
    // «الآن» المصحّح بساعة الخادم، بوقت جدار المتجر لا الجهاز.
    final now = ref.watch(storeClockProvider).wall(ref.watch(nowProvider));
    final today = dayOf(now);
    final bottom = MediaQuery.paddingOf(context).bottom;

    final active = state.items.where((a) => !a.status.releasesTime).toList();
    final running = active.where((a) => a.status == AppointmentStatus.inProgress).length;
    final subtitle = active.isEmpty
        ? (state.loading ? '…' : 'لا مواعيد')
        : [
            arCount(active.length, one: 'موعد', two: 'موعدان', few: 'مواعيد'),
            if (running > 0) '${arDigits(running)} جارٍ الآن',
          ].join(' · ');

    void shiftDay(int d) => unawaited(ctrl.selectDate(state.date.add(Duration(days: d))));

    Future<void> openNew({String? staffId, DateTime? start}) async {
      await Navigator.of(context).push(NewAppointmentScreen.route(
        date: start ?? state.date,
        staffId: staffId,
        preferredStart: start,
      ));
    }

    return SafeArea(
      bottom: false,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // العنوان: سحب أفقي عليه ينقل يوماً — أسرع من البحث في الشريط.
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onHorizontalDragEnd: (d) {
              final v = d.primaryVelocity ?? 0;
              if (v.abs() < 250) return;
              HapticFeedback.selectionClick();
              // RTL: السحب نحو اليسار = التالي (اتجاه القراءة).
              final rtl = Directionality.of(context) == TextDirection.rtl;
              shiftDay((v < 0) == rtl ? 1 : -1);
            },
            child: Padding(
              padding: const EdgeInsetsDirectional.fromSTEB(20, 10, 16, 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('المواعيد', style: tt.headlineMedium?.copyWith(fontWeight: FontWeight.w800, height: 1.15)),
                        const SizedBox(height: 2),
                        Text(
                          '${state.date == today ? 'اليوم' : dayTitle(state.date)} · $subtitle',
                          key: const Key('appts.subtitle'),
                          style: tt.bodySmall?.copyWith(color: running > 0 ? hc.warn : hc.text3),
                        ),
                      ],
                    ),
                  ),
                  _GlassAction(
                    key: const Key('appts.manage'),
                    icon: Icons.tune_rounded,
                    label: 'الإدارة',
                    onTap: () => Navigator.of(context).push(ManageScreen.route()),
                  ),
                  const SizedBox(width: 4),
                  _GlassAction(
                    key: const Key('appts.customers'),
                    icon: Icons.people_alt_outlined,
                    label: 'العملاء',
                    onTap: () => Navigator.of(context).push(CustomersScreen.route()),
                  ),
                  const SizedBox(width: 4),
                  _GlassAction(
                    key: const Key('appts.new'),
                    icon: Icons.add_rounded,
                    label: 'موعد جديد',
                    tint: hc.live.withValues(alpha: 0.22),
                    onTap: () => openNew(),
                  ),
                ],
              ),
            ),
          ),
          DateStrip(selected: state.date, today: today, onSelect: (d) => unawaited(ctrl.selectDate(d))),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: SegmentedButton<bool>(
                key: const Key('appts.view'),
                showSelectedIcon: false,
                style: SegmentedButton.styleFrom(visualDensity: VisualDensity.compact),
                segments: const [
                  ButtonSegment(value: true, icon: Icon(Icons.view_agenda_outlined, size: 18), label: Text('قائمة')),
                  ButtonSegment(value: false, icon: Icon(Icons.view_week_outlined, size: 18), label: Text('جدول')),
                ],
                selected: {ref.watch(agendaListModeProvider)},
                onSelectionChanged: (v) => ref.read(agendaListModeProvider.notifier).set(v.first),
              ),
            ),
          ),
          const SizedBox(height: 4),
          Expanded(child: _body(context, ref, state, now, bottom, openNew)),
        ],
      ),
    );
  }

  Widget _body(
    BuildContext context,
    WidgetRef ref,
    DayState state,
    DateTime now,
    double bottom,
    Future<void> Function({String? staffId, DateTime? start}) openNew,
  ) {
    final ctrl = ref.read(appointmentsDayProvider.notifier);
    if (state.loading && state.staff.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.error != null && state.staff.isEmpty) {
      return StateMessage(
        icon: Icons.cloud_off_rounded,
        title: 'تعذّر تحميل المواعيد',
        body: state.error!.message,
        actionLabel: 'إعادة المحاولة',
        onAction: ctrl.refresh,
      );
    }
    if (state.staff.isEmpty) {
      return const StateMessage(
        icon: Icons.groups_2_outlined,
        title: 'لا فريق بعد',
        body: 'أضف الخدمات والفريق وساعات الدوام من زرّ «الإدارة» في الأعلى.',
      );
    }
    void openSheet(Appointment a) {
      HapticFeedback.selectionClick();
      unawaited(showAppointmentSheet(context, a));
    }

    if (ref.watch(agendaListModeProvider)) {
      return RefreshIndicator(
        onRefresh: ctrl.refresh,
        child: AgendaList(
          key: const Key('appts.agenda'),
          state: state,
          now: now,
          bottomInset: bottom,
          onTapAppointment: openSheet,
          onNew: () => openNew(),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: ctrl.refresh,
      notificationPredicate: (n) => n.depth == 0 && n.metrics.axis == Axis.vertical,
      child: DayTimeline(
        key: const Key('appts.timeline'),
        state: state,
        now: now,
        bottomInset: bottom,
        onTapAppointment: openSheet,
        onTapFree: (staff, start) => openNew(staffId: staff.id, start: start),
      ),
    );
  }
}

class _GlassAction extends StatelessWidget {
  const _GlassAction({super.key, required this.icon, required this.label, required this.onTap, this.tint});

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    // أيقونة بلا كلمة كانت لغزاً: ثلاث دوائر لا يُعرف أيها «الإدارة»
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: SizedBox(
          width: 58,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox.square(
                dimension: 42,
                child: Glass(shadow: false, tint: tint, child: Icon(icon, size: 21, color: hc.text)),
              ),
              const SizedBox(height: 3),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.fade,
                softWrap: false,
                style: TextStyle(fontFamily: kFont, fontSize: 11, color: hc.text2),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
