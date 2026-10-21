import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors.dart';
import '../../../core/format.dart';
import '../../../core/now.dart';
import '../../../core/providers.dart';
import '../../../data/appointments.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets/common.dart';
import '../appointments_controller.dart';
import '../appt_style.dart';

enum ReportPeriod {
  today('اليوم'),
  week('آخر ٧ أيام'),
  month('هذا الشهر'),
  lastMonth('الشهر الماضي');

  const ReportPeriod(this.label);
  final String label;

  /// الفترة بتاريخ المتجر لا الجهاز.
  ({DateTime from, DateTime to}) range(DateTime today) => switch (this) {
        ReportPeriod.today => (from: today, to: today),
        ReportPeriod.week => (from: today.subtract(const Duration(days: 6)), to: today),
        ReportPeriod.month => (from: DateTime(today.year, today.month), to: today),
        ReportPeriod.lastMonth => (
            from: DateTime(today.year, today.month - 1),
            to: DateTime(today.year, today.month).subtract(const Duration(days: 1)),
          ),
      };
}

final _reportProvider = FutureProvider.autoDispose.family<AppointmentReport, ({String from, String to})>(
  (ref, p) => ref.read(apiProvider).appointmentReport(from: p.from, to: p.to),
  retry: (_, _) => null,
);

/// الدخل والزيارات والغياب، وحصة كل مقدّم خدمة وعمولته، وأكثر الخدمات طلباً.
class ReportsScreen extends ConsumerStatefulWidget {
  const ReportsScreen({super.key});

  static Route<void> route() => MaterialPageRoute(builder: (_) => const ReportsScreen());

  @override
  ConsumerState<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends ConsumerState<ReportsScreen> {
  ReportPeriod _period = ReportPeriod.today;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final today = dayOf(ref.watch(storeClockProvider).wall(ref.watch(nowProvider)));
    final r = _period.range(today);
    final key = (from: isoDay(r.from), to: isoDay(r.to));
    final async = ref.watch(_reportProvider(key));
    final currency = ref.watch(currencyProvider);

    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: const Text('التقارير')),
      body: ListView(
        padding: EdgeInsets.only(top: 8, bottom: 32 + MediaQuery.paddingOf(context).bottom),
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                for (final p in ReportPeriod.values)
                  Padding(
                    padding: const EdgeInsetsDirectional.only(end: 8),
                    child: ChoiceChip(
                      key: Key('reports.${p.name}'),
                      label: Text(p.label),
                      selected: p == _period,
                      onSelected: (_) => setState(() => _period = p),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          async.when(
            loading: () => const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator())),
            error: (e, _) => StateMessage(
              icon: Icons.cloud_off_rounded,
              title: 'تعذّر تحميل التقرير',
              body: e is ApiError ? e.message : null,
              actionLabel: 'إعادة المحاولة',
              onAction: () => ref.invalidate(_reportProvider(key)),
            ),
            data: (rep) => _ReportBody(report: rep, currency: currency),
          ),
        ],
      ),
    );
  }
}

class _ReportBody extends StatelessWidget {
  const _ReportBody({required this.report, required this.currency});

  final AppointmentReport report;
  final String? currency;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final rep = report;
    Widget stat(String label, String value, {Color? color}) => Expanded(
          child: SurfaceCard(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(value,
                    style: TextStyle(fontFamily: kFont, fontSize: 22, fontWeight: FontWeight.w800, color: color ?? hc.text)),
                const SizedBox(height: 2),
                Text(label, style: TextStyle(fontFamily: kFont, fontSize: 12.5, color: hc.text3)),
              ],
            ),
          ),
        );

    final pad = const EdgeInsets.symmetric(horizontal: 8);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: pad,
          child: Row(children: [
            stat('الدخل', money(rep.revenue, currency), color: hc.live),
            stat('زيارات منتهية', arDigits(rep.visits)),
          ]),
        ),
        const SizedBox(height: 10),
        Padding(
          padding: pad,
          child: Row(children: [
            stat('غياب بلا إلغاء', '${arDigits(rep.noShows)} · ${arDigits((rep.noShowRate * 100).round())}٪',
                color: rep.noShows > 0 ? hc.danger : null),
            stat('وقت وفّره النظام', arMinutes(rep.minutesSaved)),
          ]),
        ),
        if (rep.staff.isNotEmpty) ...[
          const SizedBox(height: 20),
          const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: SectionLabel('حسب الفريق')),
          SurfaceCard(
            child: Column(
              children: [
                for (final s in rep.staff)
                  ListTile(
                    title: Text(s.name),
                    subtitle: Text(arCount(s.visits, one: 'زيارة', two: 'زيارتان', few: 'زيارات')),
                    trailing: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(money(s.revenue, currency), style: const TextStyle(fontFamily: kFont, fontWeight: FontWeight.w700)),
                        if (s.commission > 0)
                          Text('عمولة ${money(s.commission, currency)}',
                              style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.text3)),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
        if (rep.topServices.isNotEmpty) ...[
          const SizedBox(height: 20),
          const Padding(padding: EdgeInsets.symmetric(horizontal: 16), child: SectionLabel('أكثر الخدمات طلباً')),
          SurfaceCard(
            child: Column(
              children: [
                for (final s in rep.topServices)
                  ListTile(
                    title: Text(s.name),
                    subtitle: Text(arCount(s.visits, one: 'زيارة', two: 'زيارتان', few: 'زيارات')),
                    trailing: Text(money(s.revenue, currency), style: const TextStyle(fontFamily: kFont)),
                  ),
              ],
            ),
          ),
        ],
        if (rep.visits == 0 && rep.noShows == 0)
          Padding(
            padding: const EdgeInsets.all(32),
            child: Text('لا زيارات منتهية في هذه الفترة.',
                textAlign: TextAlign.center, style: TextStyle(fontFamily: kFont, color: hc.text3)),
          ),
      ],
    );
  }
}
