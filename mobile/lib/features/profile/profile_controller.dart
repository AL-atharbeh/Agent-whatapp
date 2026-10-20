import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/providers.dart';
import '../../data/models.dart';

final meProvider = NotifierProvider<MeController, MeInfo?>(MeController.new);

/// `/me` مع نسخة محلية: الملف والقنوات تظهر بلا اتصال.
class MeController extends Notifier<MeInfo?> {
  static const _cacheKey = 'me';

  @override
  MeInfo? build() {
    final account = ref.watch(accountKeyProvider);
    if (account == null) return null;
    unawaited(_load());
    return null;
  }

  Future<void> _load() async {
    final db = ref.read(databaseProvider);
    final cached = await db.getJson(_cacheKey);
    if (cached != null && ref.mounted && state == null) state = MeInfo.fromJson(cached);
    await refresh();
  }

  Future<void> refresh() async {
    try {
      final me = await ref.read(apiProvider).me();
      if (!ref.mounted) return;
      state = me;
      unawaited(ref.read(databaseProvider).setJson(_cacheKey, me.toJson()));
    } on ApiError {
      // نبقي النسخة المحلية.
    }
  }

  /// بعد تغيير وضع الإشعارات بنجاح.
  void setNotify(NotifyMode mode) {
    final me = state;
    if (me == null) return;
    state = MeInfo(
      user: me.user,
      tenant: me.tenant,
      channels: me.channels,
      deviceId: me.deviceId,
      notify: mode,
      appointmentsEnabled: me.appointmentsEnabled,
    );
    unawaited(ref.read(databaseProvider).setJson(_cacheKey, state!.toJson()));
  }
}

final devicesProvider =
    AsyncNotifierProvider<DevicesController, List<DeviceInfo>>(DevicesController.new, retry: (_, _) => null);

class DevicesController extends AsyncNotifier<List<DeviceInfo>> {
  @override
  Future<List<DeviceInfo>> build() async {
    ref.watch(accountKeyProvider);
    final list = await ref.read(apiProvider).devices();
    // هذا الجهاز أولاً — هو ما يبحث عنه المستخدم ليتأكد أنه «أنا».
    return [...list.where((d) => d.current), ...list.where((d) => !d.current)];
  }

  /// يرمي ApiError ليعرضه الحوار.
  Future<void> revoke(String id) async {
    await ref.read(apiProvider).revokeDevice(id);
    final cur = state.value ?? const <DeviceInfo>[];
    state = AsyncData(cur.where((d) => d.id != id).toList());
  }
}
