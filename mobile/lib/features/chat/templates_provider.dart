import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../data/models.dart';

/// القوالب المعتمدة — تُجلب مرة لكل جلسة (Meta لا تغيّرها كل دقيقة)،
/// و«أعد المحاولة» في الورقة تُبطل هذا المزوّد.
final templatesProvider = FutureProvider<List<MessageTemplate>>((ref) async {
  ref.watch(accountKeyProvider);
  return ref.read(apiProvider).templates();
}, retry: (_, _) => null);
