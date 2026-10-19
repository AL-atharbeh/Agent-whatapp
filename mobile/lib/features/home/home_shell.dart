import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/feedback.dart';
import '../../core/providers.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../chat/chat_screen.dart';
import '../chat/outbox_controller.dart';
import '../conversations/conversations_tab.dart';
import '../conversations/inbox_controller.dart';
import '../lock/app_lock_controller.dart';
import '../profile/profile_controller.dart';
import '../profile/profile_tab.dart';
import '../push/push_service.dart';
import '../settings/settings_tab.dart';

/// الهيكل بعد الدخول: ثلاث تبويبات + كل ما يعمل «في الخلفية» ما دام
/// التطبيق في المقدّمة (استطلاع، طابور، إشعارات).
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  int _tab = 0;
  late final AppLifecycleListener _lifecycle;
  final List<StreamSubscription<Object?>> _subs = [];
  bool _wasOffline = false;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(
      onResume: _onResume,
      onHide: _onBackground,
      onPause: _onBackground,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ref.read(inboxProvider.notifier).start();
      ref.read(meProvider);
      unawaited(_setupPush());
      _setupConnectivity();
    });
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    for (final s in _subs) {
      unawaited(s.cancel());
    }
    super.dispose();
  }

  void _onResume() {
    ref.read(appLockProvider.notifier).onForeground();
    ref.read(inboxProvider.notifier).start();
    unawaited(ref.read(outboxProvider.notifier).flush());
  }

  void _onBackground() {
    ref.read(appLockProvider.notifier).onBackground();
    ref.read(inboxProvider.notifier).stop();
  }

  void _setupConnectivity() {
    try {
      _subs.add(Connectivity().onConnectivityChanged.listen((r) {
        final offline = r.every((x) => x == ConnectivityResult.none);
        if (_wasOffline && !offline) {
          // عادت الشبكة: الطابور أولاً (رسائل تنتظر)، ثم الملخّص.
          unawaited(ref.read(outboxProvider.notifier).flush());
          unawaited(ref.read(inboxProvider.notifier).refresh());
        }
        _wasOffline = offline;
      }, onError: (_) {}));
    } catch (_) {
      // بلا مراقبة اتصال يبقى الاستطلاع والعودة للمقدّمة كافيين.
    }
  }

  Future<void> _setupPush() async {
    final push = ref.read(pushServiceProvider);
    if (!push.available) return;
    final api = ref.read(apiProvider);
    Future<void> register(String? token) async {
      if (token == null) return;
      try {
        await api.updateCurrentDevice(pushToken: token);
      } catch (_) {}
    }

    await register(await push.token());
    _subs
      ..add(push.onTokenRefresh.listen((t) => unawaited(register(t))))
      ..add(push.onOpened.listen((p) => ref.read(pendingDeepLinkProvider.notifier).set(p.conversationId)))
      ..add(push.onForeground.listen(_onForegroundPush));
    final initial = await push.initialMessage();
    if (initial?.conversationId != null) {
      ref.read(pendingDeepLinkProvider.notifier).set(initial!.conversationId);
    }
  }

  void _onForegroundPush(PushPayload p) {
    unawaited(ref.read(inboxProvider.notifier).refresh());
    final id = p.conversationId;
    if (id == null || id == ref.read(openConversationProvider)) return;
    final title = p.title ?? (p.type == 'handoff' ? 'محادثة تحتاجك' : 'رسالة جديدة');
    showToast(
      p.body == null ? title : '$title\n${p.body}',
      action: SnackBarAction(label: 'فتح', onPressed: () => _openChat(id)),
    );
  }

  void _openChat(String id) {
    final nav = appNavigatorKey.currentState;
    if (nav == null) return;
    nav.push(ChatScreen.route(id));
  }

  @override
  Widget build(BuildContext context) {
    // فتح محادثة من إشعار — فقط بعد زوال القفل، وإلا ظهرت المحادثة خلفه
    // ثم انكشفت لحظة فتحه.
    ref.listen(pendingDeepLinkProvider, (_, id) {
      if (id != null && !ref.read(appLockProvider).locked) {
        ref.read(pendingDeepLinkProvider.notifier).set(null);
        _openChat(id);
      }
    });
    ref.listen(appLockProvider.select((s) => s.locked), (_, locked) {
      final id = ref.read(pendingDeepLinkProvider);
      if (!locked && id != null) {
        ref.read(pendingDeepLinkProvider.notifier).set(null);
        _openChat(id);
      }
    });

    final hc = context.hc;
    final handoffTotal = ref.watch(
      inboxProvider.select((s) => s.summary.channels.values.fold<int>(0, (a, c) => a + c.handoff)),
    );

    return Scaffold(
      body: IndexedStack(
        index: _tab,
        children: const [ConversationsTab(), SettingsTab(), ProfileTab()],
      ),
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: hc.border))),
        child: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: [
            NavigationDestination(
              icon: _TabIcon(Icons.chat_bubble_outline_rounded, badge: handoffTotal),
              selectedIcon: _TabIcon(Icons.chat_bubble_rounded, badge: handoffTotal),
              label: 'المحادثات',
            ),
            const NavigationDestination(
              icon: Icon(Icons.tune_rounded),
              selectedIcon: Icon(Icons.tune_rounded),
              label: 'الإعدادات',
            ),
            const NavigationDestination(
              icon: Icon(Icons.person_outline_rounded),
              selectedIcon: Icon(Icons.person_rounded),
              label: 'الملف',
            ),
          ],
        ),
      ),
    );
  }
}

class _TabIcon extends StatelessWidget {
  const _TabIcon(this.icon, {required this.badge});

  final IconData icon;
  final int badge;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    if (badge <= 0) return Icon(icon);
    return Stack(
      clipBehavior: Clip.none,
      children: [
        Icon(icon),
        PositionedDirectional(
          top: -6,
          end: -12,
          child: CountBadge(count: badge, color: hc.handoff, textColor: Colors.white, size: 18),
        ),
      ],
    );
  }
}
