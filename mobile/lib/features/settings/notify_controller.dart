import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/providers.dart';
import '../../data/models.dart';
import '../profile/profile_controller.dart';

class NotifyState {
  const NotifyState(this.mode, {this.saving = false});
  final NotifyMode mode;
  final bool saving;
}

final notifyProvider = NotifierProvider<NotifyController, NotifyState>(NotifyController.new);

/// وضع الإشعارات لهذا الجهاز — مصدره `/me` (device.notify).
class NotifyController extends Notifier<NotifyState> {
  @override
  NotifyState build() {
    ref.watch(accountKeyProvider);
    final me = ref.watch(meProvider);
    return NotifyState(me?.notify ?? NotifyMode.all);
  }

  /// متفائل: يتغيّر الاختيار فوراً ويُعاد إن رفض الخادم. يعيد رسالة الخطأ.
  Future<String?> set(NotifyMode mode) async {
    final previous = state.mode;
    if (mode == previous || state.saving) return null;
    state = NotifyState(mode, saving: true);
    try {
      await ref.read(apiProvider).updateCurrentDevice(notify: mode);
      ref.read(meProvider.notifier).setNotify(mode);
      if (ref.mounted) state = NotifyState(mode);
      return null;
    } on ApiError catch (e) {
      if (ref.mounted) state = NotifyState(previous);
      return e.message;
    }
  }
}
