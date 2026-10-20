import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/feedback.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../data/appointments.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import 'appointments_controller.dart';
import 'appt_style.dart';

/// ملف العميل: الزيارات، المدد المتعلَّمة لكل خدمة، الملاحظات، الغياب،
/// ومقدّم الخدمة المفضّل.
///
/// المدد المتعلَّمة تظهر هنا صراحةً: هي سبب أن الحجز القادم لهذا العميل أطول
/// أو أقصر من غيره، والمالك يجب أن يرى لماذا قبل أن يثق بها.
class CustomerProfileScreen extends ConsumerWidget {
  const CustomerProfileScreen({super.key, required this.customerId});

  final String customerId;

  static Route<void> route(String id) => MaterialPageRoute(
        builder: (_) => CustomerProfileScreen(customerId: id),
        settings: RouteSettings(name: '/customers/$id'),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final profile = ref.watch(customerProfileProvider(customerId));
    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: const Text('ملف العميل')),
      body: profile.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => StateMessage(
          icon: Icons.cloud_off_rounded,
          title: 'تعذّر تحميل الملف',
          body: e is ApiError ? e.message : null,
          actionLabel: 'إعادة المحاولة',
          onAction: () => ref.invalidate(customerProfileProvider(customerId)),
        ),
        data: (p) => _ProfileBody(profile: p),
      ),
    );
  }
}

class _ProfileBody extends ConsumerWidget {
  const _ProfileBody({required this.profile});
  final CustomerProfile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final c = profile.customer;
    final clock = ref.watch(storeClockProvider);
    final currency = ref.watch(currencyProvider);
    final staff = ref.watch(staffProvider).value ?? const <StaffMember>[];
    final preferred = staff.where((s) => s.id == c.preferredStaffId).firstOrNull;

    return ListView(
      padding: EdgeInsets.fromLTRB(0, 8, 0, 32 + MediaQuery.paddingOf(context).bottom),
      children: [
        SurfaceCard(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              InitialsAvatar(seed: c.id, label: c.name ?? c.phone ?? '؟', size: 56),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(c.name ?? 'بدون اسم', key: const Key('profile.name'), style: tt.titleLarge),
                    if (c.phone != null) LtrText(formatPhone(c.phone!), style: tt.bodySmall?.copyWith(color: hc.text3)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              _Stat(label: 'زيارات', value: arDigits(c.visitCount)),
              const SizedBox(width: 8),
              _Stat(
                key: const Key('profile.noShows'),
                label: 'غياب',
                value: arDigits(c.noShowCount),
                color: c.noShowCount > 0 ? hc.danger : null,
              ),
              const SizedBox(width: 8),
              _Stat(label: 'آخر زيارة', value: c.lastVisitAt == null ? '—' : relativeTime(c.lastVisitAt!, DateTime.now())),
            ],
          ),
        ),
        if (preferred != null) ...[
          const SectionLabel('مقدّم الخدمة المفضّل', icon: Icons.favorite_border_rounded),
          SurfaceCard(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                InitialsAvatar(seed: preferred.id, label: preferred.name, size: 30),
                const SizedBox(width: 10),
                Text(preferred.name, style: tt.titleSmall),
              ],
            ),
          ),
        ],
        const SectionLabel('ملاحظات دائمة', icon: Icons.sticky_note_2_outlined),
        _NotesEditor(customer: c),
        if (profile.durations.isNotEmpty) ...[
          const SectionLabel('المدد المتعلَّمة', icon: Icons.insights_rounded),
          SurfaceCard(
            child: Column(
              children: [
                for (var i = 0; i < profile.durations.length; i++) ...[
                  if (i > 0) Divider(indent: 16, color: hc.border),
                  _DurationRow(d: profile.durations[i]),
                ],
              ],
            ),
          ),
        ],
        if (profile.upcoming.isNotEmpty) ...[
          const SectionLabel('القادم', icon: Icons.event_outlined),
          SurfaceCard(
            child: Column(
              children: [
                for (final a in profile.upcoming)
                  ListTile(
                    leading: Icon(statusIcon(a.status), color: statusColor(hc, a.status)),
                    title: Text(a.service?.name ?? 'موعد'),
                    subtitle: Text('${dayTitle(clock.wall(a.startAt))} · ${clockTime(clock.wall(a.startAt))}'),
                  ),
              ],
            ),
          ),
        ],
        const SectionLabel('الزيارات', icon: Icons.history_rounded),
        if (profile.visits.isEmpty)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Center(child: Text('لا زيارات سابقة بعد.')),
          )
        else
          SurfaceCard(
            child: Column(
              children: [
                for (var i = 0; i < profile.visits.length; i++) ...[
                  if (i > 0) Divider(indent: 16, color: hc.border),
                  _VisitRow(v: profile.visits[i], day: dayTitle(clock.wall(profile.visits[i].at)), currency: currency),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({super.key, required this.label, required this.value, this.color});
  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
        decoration: BoxDecoration(
          color: hc.surface,
          borderRadius: BorderRadius.circular(R.md),
          border: Border.all(color: hc.border),
        ),
        child: Column(
          children: [
            Text(value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontFamily: kFont, fontSize: 17, fontWeight: FontWeight.w700, color: color ?? hc.text, height: 1.3)),
            Text(label, style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.text3, height: 1.3)),
          ],
        ),
      ),
    );
  }
}

class _DurationRow extends StatelessWidget {
  const _DurationRow({required this.d});
  final LearnedDuration d;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          Expanded(child: Text(d.serviceName, style: Theme.of(context).textTheme.bodyMedium)),
          Text(arMinutes(d.minutes),
              style: TextStyle(fontFamily: kFont, fontSize: 14, fontWeight: FontWeight.w700, color: hc.live, height: 1.3)),
          if (d.samples > 0) ...[
            const SizedBox(width: 6),
            Text('من ${arCount(d.samples, one: 'زيارة', two: 'زيارتين', few: 'زيارات')}',
                style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.text3, height: 1.3)),
          ],
        ],
      ),
    );
  }
}

class _VisitRow extends StatelessWidget {
  const _VisitRow({required this.v, required this.day, this.currency});
  final CustomerVisit v;
  final String day;
  final String? currency;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final color = statusColor(hc, v.status);
    final details = [
      day,
      if (v.staffName != null) v.staffName!,
      if (v.actualMinutes != null) arMinutes(v.actualMinutes!),
      if (v.finalPrice != null) money(v.finalPrice!, currency),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 2), child: Icon(statusIcon(v.status), size: 18, color: color)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(v.serviceName ?? 'زيارة',
                          style: TextStyle(fontFamily: kFont, fontSize: 14.5, fontWeight: FontWeight.w600, color: hc.text, height: 1.4)),
                    ),
                    if (v.status != AppointmentStatus.done)
                      Text(v.status.label, style: TextStyle(fontFamily: kFont, fontSize: 12, color: color, height: 1.3)),
                  ],
                ),
                Text(details, style: TextStyle(fontFamily: kFont, fontSize: 12.5, color: hc.text3, height: 1.4)),
                if (v.notes != null)
                  Container(
                    margin: const EdgeInsets.only(top: 6),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                    decoration: BoxDecoration(color: hc.surface2, borderRadius: BorderRadius.circular(R.sm)),
                    child: Text(v.notes!, style: TextStyle(fontFamily: kFont, fontSize: 13, color: hc.text2, height: 1.5)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// ملاحظات دائمة (حساسية، تفضيلات) — تُحفظ بزر صريح لا مع كل حرف: كتابة
/// نصف جملة ثم انقطاع لا يجب أن يحفظ نصف معلومة طبية.
class _NotesEditor extends ConsumerStatefulWidget {
  const _NotesEditor({required this.customer});
  final Customer customer;

  @override
  ConsumerState<_NotesEditor> createState() => _NotesEditorState();
}

class _NotesEditorState extends ConsumerState<_NotesEditor> {
  late final TextEditingController _c = TextEditingController(text: widget.customer.notes ?? '');
  bool _saving = false;
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _c.addListener(() {
      final d = _c.text.trim() != (widget.customer.notes ?? '');
      if (d != _dirty) setState(() => _dirty = d);
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ref.read(apiProvider).updateCustomer(widget.customer.id, notes: _c.text.trim());
      unawaited(HapticFeedback.lightImpact());
      showToast('حُفظت الملاحظات.');
      ref.invalidate(customerProfileProvider(widget.customer.id));
    } on ApiError catch (e) {
      showToast(e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('profile.notes'),
            controller: _c,
            minLines: 2,
            maxLines: 6,
            maxLength: 2000,
            decoration: const InputDecoration(
              hintText: 'حساسية، تفضيلات، ما يجب أن يعرفه الفريق قبل كل زيارة…',
              counterText: '',
            ),
          ),
          if (_dirty || _saving)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: FilledButton(
                key: const Key('profile.saveNotes'),
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.2))
                    : const Text('حفظ الملاحظات'),
              ),
            ),
        ],
      ),
    );
  }
}
