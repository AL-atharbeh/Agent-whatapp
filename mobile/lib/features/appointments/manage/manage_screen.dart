import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets/common.dart';
import 'manage_providers.dart';
import 'reports_screen.dart';
import 'services_screen.dart';
import 'team_screen.dart';

/// إدارة النشاط من الجوال: الخدمات والفريق والتقارير — ما كان في اللوحة وحدها.
class ManageScreen extends ConsumerWidget {
  const ManageScreen({super.key});

  static Route<void> route() => MaterialPageRoute(builder: (_) => const ManageScreen());

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final services = ref.watch(manageServicesProvider).value;
    final staff = ref.watch(manageStaffProvider).value;

    Widget tile({
      required Key key,
      required IconData icon,
      required String title,
      required String subtitle,
      required Route<void> Function() route,
    }) =>
        ListTile(
          key: key,
          leading: CircleAvatar(backgroundColor: hc.liveDim, child: Icon(icon, color: hc.live)),
          title: Text(title),
          subtitle: Text(subtitle),
          trailing: const Icon(Icons.chevron_left_rounded),
          onTap: () => Navigator.of(context).push(route()),
        );

    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: const Text('الإدارة')),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 12),
        children: [
          SurfaceCard(
            child: Column(
              children: [
                tile(
                  key: const Key('manage.services'),
                  icon: Icons.design_services_outlined,
                  title: 'الخدمات',
                  subtitle: services == null
                      ? 'الأسعار والمدد ووقت الانتظار'
                      : arCount(services.length, one: 'خدمة', two: 'خدمتان', few: 'خدمات'),
                  route: ServicesManageScreen.route,
                ),
                tile(
                  key: const Key('manage.team'),
                  icon: Icons.groups_2_outlined,
                  title: 'الفريق',
                  subtitle: staff == null
                      ? 'الدوام والخدمات والصور'
                      : arCount(staff.length, one: 'شخص', two: 'شخصان', few: 'أشخاص'),
                  route: TeamManageScreen.route,
                ),
                tile(
                  key: const Key('manage.reports'),
                  icon: Icons.insights_rounded,
                  title: 'التقارير',
                  subtitle: 'الدخل والغياب والعمولات',
                  route: ReportsScreen.route,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
