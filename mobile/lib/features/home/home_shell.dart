import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/feedback.dart';
import '../../core/providers.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../../ui/widgets/glass.dart';
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

    // extendBody: المحتوى يمتد تحت البار العائم فيُرى مطموساً خلف زجاجه،
    // و Scaffold يضيف ارتفاع البار إلى padding.bottom لما تحته — فالقوائم
    // تعرف أين تنتهي دون أن يحسبه كل تبويب بنفسه.
    return Scaffold(
      extendBody: true,
      backgroundColor: hc.bg,
      body: IndexedStack(
        index: _tab,
        children: const [ConversationsTab(), SettingsTab(), ProfileTab()],
      ),
      bottomNavigationBar: _GlassTabBar(
        index: _tab,
        onTap: (i) {
          if (i != _tab) HapticFeedback.selectionClick();
          setState(() => _tab = i);
        },
        tabs: [
          _TabSpec(Icons.chat_bubble_outline_rounded, Icons.chat_bubble_rounded, 'المحادثات', badge: handoffTotal),
          const _TabSpec(Icons.tune_rounded, Icons.tune_rounded, 'الإعدادات'),
          const _TabSpec(Icons.person_outline_rounded, Icons.person_rounded, 'الملف'),
        ],
      ),
    );
  }
}

class _TabSpec {
  const _TabSpec(this.icon, this.selectedIcon, this.label, {this.badge = 0});
  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final int badge;
}

/// البار السفلي: كبسولة زجاجية عائمة.
///
/// شريط ملتصق بالحافة يقتطع من الشاشة ويفصلها عن المحتوى. الكبسولة تطفو
/// بهامش من الأطراف، والمحتوى يمرّ خلفها مطموساً — القائمة تبدو أطول، والبار
/// أخفّ، والمختار يُعلَّم بكبسولة داخلية تنزلق بين الخانات.
class _GlassTabBar extends StatelessWidget {
  const _GlassTabBar({required this.index, required this.onTap, required this.tabs});

  final int index;
  final ValueChanged<int> onTap;
  final List<_TabSpec> tabs;

  @override
  Widget build(BuildContext context) {
    final safe = MediaQuery.paddingOf(context).bottom;
    return Padding(
      // فوق مؤشر الرجوع للشاشة الرئيسية لا عليه، وبهامش ثابت حين لا يوجد
      padding: EdgeInsets.fromLTRB(18, 0, 18, safe > 0 ? safe - 8 : 14),
      child: Glass(
        radius: 36,
        padding: const EdgeInsets.all(6),
        child: SizedBox(
          height: 60,
          child: Row(
            children: [
              for (var i = 0; i < tabs.length; i++)
                Expanded(
                  child: _TabButton(
                    key: Key('tab.$i'),
                    spec: tabs[i],
                    selected: i == index,
                    onTap: () => onTap(i),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  const _TabButton({super.key, required this.spec, required this.selected, required this.onTap});

  final _TabSpec spec;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final color = selected ? hc.text : hc.text3;
    return Semantics(
      button: true,
      selected: selected,
      label: spec.badge > 0 ? '${spec.label}، ${spec.badge} تنتظرك' : spec.label,
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOutCubic,
          decoration: BoxDecoration(
            color: selected ? hc.text.withValues(alpha: 0.10) : Colors.transparent,
            borderRadius: BorderRadius.circular(30),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _TabIcon(selected ? spec.selectedIcon : spec.icon, badge: spec.badge, color: color),
              const SizedBox(height: 3),
              AnimatedDefaultTextStyle(
                duration: const Duration(milliseconds: 200),
                style: TextStyle(
                  fontFamily: kFont,
                  fontSize: 12,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: color,
                  height: 1.2,
                ),
                child: Text(spec.label, maxLines: 1),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TabIcon extends StatelessWidget {
  const _TabIcon(this.icon, {required this.badge, required this.color});

  final IconData icon;
  final int badge;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final glyph = Icon(icon, color: color, size: 25);
    if (badge <= 0) return glyph;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        glyph,
        PositionedDirectional(
          top: -6,
          end: -12,
          child: CountBadge(count: badge, color: hc.handoff, textColor: Colors.white, size: 18),
        ),
      ],
    );
  }
}
