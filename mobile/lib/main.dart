import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/error_handling.dart';
import 'core/providers.dart';
import 'data/local/app_database.dart';
import 'data/local/memory_store.dart';
import 'data/local/session_store.dart';
import 'features/push/push_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  installGlobalErrorHandlers();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);

  // كل التهيئة قبل أول إطار، وكلٌّ منها لا يرمي: فشل أي جزء يُنقص ميزة
  // ولا يمنع فتح التطبيق.
  LocalStore db;
  try {
    db = await AppDatabase.open();
  } catch (_) {
    db = InMemoryLocalStore();
  }
  final store = SessionStore(FlutterSecureKeyValue());

  // تثبيت جديد؟ القاعدة (تُحذف مع التطبيق) بلا علامة، بينما Keychain قد
  // يحمل جلسة من تثبيت سابق — نمحوها كي لا يدخل أحد بجلسة لم يسجّلها.
  if (await db.getValue(AppDatabase.installMarkerKey) == null) {
    await store.wipeAll();
    await db.setValue(AppDatabase.installMarkerKey, DateTime.now().toUtc().toIso8601String());
  }

  final session = await store.read();
  final lock = session == null ? const LockSettings() : await store.readLock();
  final push = await PushService.initialize();

  runApp(
    ProviderScope(
      // لا إعادة تلقائية لمزوّدات فاشلة: الإعادة قرار نتخذه نحن (الطابور،
      // الاستطلاع، زر «إعادة المحاولة») — لا حلقة طلبات خفية.
      retry: (_, _) => null,
      overrides: [
        databaseProvider.overrideWithValue(db),
        sessionStoreProvider.overrideWithValue(store),
        initialSessionProvider.overrideWithValue(session),
        initialLockProvider.overrideWithValue(lock),
        pushServiceProvider.overrideWithValue(push),
      ],
      child: const HaderApp(),
    ),
  );
}
