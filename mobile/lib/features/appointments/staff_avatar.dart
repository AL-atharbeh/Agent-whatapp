import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/appointments.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import 'appointments_controller.dart';

/// صورة مقدّم الخدمة مع بديل الحروف الأولى.
///
/// الصورة تُطلب بترويسة الجلسة (لا رابط عام): صور الفريق ليست للعالم. تُخبّأ
/// في [staffPhotoProvider] فلا تُعاد مع كل استطلاع، والبديل يظهر فوراً فلا
/// «يقفز» رأس العمود حين تصل.
class StaffAvatar extends ConsumerWidget {
  const StaffAvatar({super.key, required this.staff, this.size = 40, this.ring});

  final StaffMember staff;
  final double size;
  final Color? ring;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final fallback = InitialsAvatar(seed: staff.id, label: staff.name, size: size);
    if (!staff.hasPhoto) return _ringed(hc, fallback);
    final photo = ref.watch(staffPhotoProvider(staff.id)).value;
    if (photo == null) return _ringed(hc, fallback);
    return _ringed(
      hc,
      ClipOval(
        child: Image.memory(
          photo,
          width: size,
          height: size,
          fit: BoxFit.cover,
          gaplessPlayback: true,
          // صورة تالفة ⇒ الحروف الأولى، لا مربّع خطأ.
          errorBuilder: (_, _, _) => fallback,
          cacheWidth: (size * MediaQuery.devicePixelRatioOf(context)).round(),
        ),
      ),
    );
  }

  Widget _ringed(HaderColors hc, Widget child) => ring == null
      ? child
      : Container(
          padding: const EdgeInsets.all(2),
          decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: ring!, width: 1.6)),
          child: child,
        );
}
