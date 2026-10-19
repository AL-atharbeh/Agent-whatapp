import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hader/core/feedback.dart';
import 'package:hader/core/providers.dart';
import 'package:hader/data/api/fake_api.dart';
import 'package:hader/data/local/memory_store.dart';
import 'package:hader/data/local/session_store.dart';
import 'package:hader/data/models.dart';
import 'package:hader/ui/theme.dart';

/// حاوية اختبار: خادم وهمي بلا تأخير، ذاكرة في RAM، تخزين آمن في RAM.
ProviderContainer testContainer(FakeHaderApi api, {Session? session}) => ProviderContainer(
      retry: (_, _) => null,
      overrides: [
        apiProvider.overrideWithValue(api),
        databaseProvider.overrideWithValue(InMemoryLocalStore()),
        sessionStoreProvider.overrideWithValue(SessionStore(InMemorySecureKeyValue())),
        initialSessionProvider.overrideWithValue(session),
      ],
    );

const demoSession = Session(
  token: 'fake_test',
  user: UserInfo(id: 'u_1', email: FakeHaderApi.demoEmail, name: 'بشار'),
  tenant: TenantInfo(id: 't_1', slug: 'shifra-code', name: 'شيفرة كود', agentName: 'ريم'),
);

Widget testApp(ProviderContainer c, Widget home) => UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        theme: buildTheme(Brightness.dark),
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        scaffoldMessengerKey: appMessengerKey,
        home: home,
      ),
    );
