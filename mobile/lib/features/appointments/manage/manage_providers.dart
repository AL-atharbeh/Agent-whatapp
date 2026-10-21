import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../data/appointments.dart';
import '../appointments_controller.dart';

/// قوائم الإدارة — بالموقوف منها، خلافاً لقوائم الحجز التي تخفيه.
final manageServicesProvider = FutureProvider.autoDispose<List<ServiceOffering>>(
  (ref) => ref.read(apiProvider).allServices(),
  retry: (_, _) => null,
);

final manageStaffProvider = FutureProvider.autoDispose<List<StaffMember>>(
  (ref) async {
    final list = await ref.read(apiProvider).allStaff();
    return list..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
  },
  retry: (_, _) => null,
);

/// بعد أي حفظ: الجدول وشاشة الحجز يقرآن الخدمات والفريق من مزوّداتهما، وما
/// لم يُبطَل يبقى يعرض النسخة القديمة حتى إعادة فتح التطبيق.
void refreshAfterManage(WidgetRef ref) {
  ref.invalidate(manageServicesProvider);
  ref.invalidate(manageStaffProvider);
  ref.invalidate(servicesProvider);
  ref.invalidate(staffProvider);
  unawaited(ref.read(appointmentsDayProvider.notifier).refresh(silent: true));
}
