import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/feedback.dart';
import '../../core/format.dart';
import '../../core/now.dart';
import '../../core/providers.dart';
import '../../data/models.dart';
import '../../data/outbox/outbox_entry.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../../ui/widgets/glyphs.dart';
import '../auth/session_controller.dart';
import 'chat_controller.dart';
import 'message_bubble.dart';
import 'outbox_controller.dart';
import 'template_sheet.dart';

class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.conversationId, this.initial});

  final String conversationId;

  /// الصف كما كان في القائمة — يُعرض فوراً قبل أي تحميل.
  final ConversationItem? initial;

  static Route<void> route(String id, {ConversationItem? initial}) => MaterialPageRoute(
        builder: (_) => ChatScreen(conversationId: id, initial: initial),
        settings: RouteSettings(name: '/chat/$id'),
      );

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _scroll = ScrollController();
  late final OpenConversation _open;

  @override
  void initState() {
    super.initState();
    _open = ref.read(openConversationProvider.notifier);
    WidgetsBinding.instance.addPostFrameCallback((_) => _open.set(widget.conversationId));
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll.dispose();
    // بعد الإطار: تعديل مزوّد أثناء تفكيك الشجرة ممنوع في Riverpod.
    final open = _open;
    final id = widget.conversationId;
    Future.microtask(() {
      try {
        open.clearIf(id);
      } catch (_) {}
    });
    super.dispose();
  }

  void _onScroll() {
    // القائمة معكوسة: «الأعلى» = maxScrollExtent.
    if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 400) {
      unawaited(ref.read(chatProvider(widget.conversationId).notifier).loadOlder());
    }
  }

  ChatController get _ctrl => ref.read(chatProvider(widget.conversationId).notifier);

  Future<void> _toggleOwnership(ConversationItem c) async {
    unawaited(HapticFeedback.selectionClick());
    final err = c.isHuman ? await _ctrl.release() : await _ctrl.takeover();
    if (err != null) {
      showToast(err.message);
    } else {
      showToast(c.isHuman ? 'عادت المحادثة للوكيل' : 'استلمت المحادثة — الوكيل متوقّف هنا');
    }
  }

  /// خيارات رسالة لم تُؤكَّد. فشل صريح ⇒ «إعادة» بنفس المعرّف (آمن).
  /// غير مؤكّد ⇒ «أرسل مرة أخرى» بمعرّف جديد، مع تحذير صريح من التكرار.
  Future<void> _failedOptions(OutboxEntry e) async {
    final hc = context.hc;
    final outbox = ref.read(outboxProvider.notifier);
    final uncertain = e.state == OutboxState.uncertain;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Text(
                uncertain
                    ? 'لم تؤكّد Meta وصول الرسالة ولم ترفضها — ربما وصلت العميل. إن أرسلتها مرة أخرى فقد تصله مرتين.'
                    : (e.errorMessage ?? 'لم تُرسل الرسالة.'),
                textAlign: TextAlign.center,
                style: Theme.of(ctx).textTheme.bodyMedium?.copyWith(color: hc.text2),
              ),
            ),
            if (uncertain)
              ListTile(
                key: const Key('failed.sendAgain'),
                leading: Icon(Icons.send_rounded, color: hc.warn),
                title: const Text('أرسل مرة أخرى'),
                subtitle: const Text('قد تصل العميل نسختان'),
                onTap: () => Navigator.pop(ctx, 'again'),
              )
            else
              ListTile(
                key: const Key('failed.retry'),
                leading: Icon(Icons.refresh_rounded, color: hc.live),
                title: const Text('إعادة المحاولة'),
                onTap: () => Navigator.pop(ctx, 'retry'),
              ),
            ListTile(
              key: const Key('failed.delete'),
              leading: Icon(Icons.delete_outline_rounded, color: hc.danger),
              title: Text(uncertain ? 'إخفاء من هنا' : 'حذف الرسالة', style: TextStyle(color: hc.danger)),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    switch (choice) {
      case 'retry':
        await outbox.retry(e.clientId);
      case 'again':
        unawaited(HapticFeedback.mediumImpact());
        await outbox.sendAgain(e.clientId);
      case 'delete':
        await outbox.discard(e.clientId);
    }
  }

  Future<void> _sendTemplate() async {
    final c = ref.read(chatProvider(widget.conversationId)).conversation ?? widget.initial;
    final sel = await showTemplateSheet(
      context,
      prefill: [if (c?.customerName != null) c!.customerName!],
    );
    if (sel == null) return;
    unawaited(HapticFeedback.mediumImpact());
    await _ctrl.sendTemplate(sel);
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final state = ref.watch(chatProvider(widget.conversationId));
    final conv = state.conversation ?? widget.initial;
    final pending = ref.watch(outboxProvider.select(
      (list) => list.where((e) => e.conversationId == widget.conversationId).toList(),
    ));
    final now = ref.watch(nowProvider);
    final agentName = ref.watch(sessionProvider.select((s) => s?.tenant.agentName)) ?? 'الوكيل';
    final inactive = ref.watch(tenantInactiveProvider);

    return Scaffold(
      appBar: _appBar(context, conv, state.busy),
      body: Column(
        children: [
          if (conv != null && conv.isHuman) _HandoffBanner(conv: conv),
          Expanded(
            child: _messages(context, state, pending, agentName, now),
          ),
          if (conv != null && inactive)
            _ClosedPanel(
              key: const Key('composer.inactive'),
              bottom: MediaQuery.paddingOf(context).bottom,
              icon: Icons.storefront_outlined,
              text: 'المتجر غير نشط — الإرسال متوقّف. القراءة متاحة، والرسائل المعلّقة تبقى محفوظة.',
              action: 'تحقّق مجدداً',
              actionIcon: Icons.refresh_rounded,
              onAction: () {
                ref.read(tenantInactiveProvider.notifier).clear();
                unawaited(ref.read(outboxProvider.notifier).retryTenantBlocked());
              },
            )
          else if (conv != null)
            Composer(
              conversation: conv,
              now: now,
              onSend: (text) async {
                unawaited(HapticFeedback.mediumImpact());
                await _ctrl.sendText(text);
                if (_scroll.hasClients) {
                  unawaited(_scroll.animateTo(0, duration: const Duration(milliseconds: 250), curve: Curves.easeOutCubic));
                }
              },
              onTemplate: _sendTemplate,
            )
          else
            SizedBox(height: MediaQuery.paddingOf(context).bottom + 12),
        ],
      ),
      backgroundColor: hc.bg,
    );
  }

  PreferredSizeWidget _appBar(BuildContext context, ConversationItem? c, bool busy) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final name = c == null ? '' : displayName(c);
    return AppBar(
      titleSpacing: 0,
      shape: Border(bottom: BorderSide(color: hc.border)),
      title: c == null
          ? const SizedBox.shrink()
          : Row(
              children: [
                InitialsAvatar(
                  seed: c.id,
                  label: name,
                  size: 38,
                  badge: Container(
                    padding: const EdgeInsets.all(2),
                    decoration: BoxDecoration(color: hc.bg, shape: BoxShape.circle),
                    child: ChannelGlyph(c.channel, size: 14),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      c.customerName == null
                          ? LtrText(name, style: tt.titleMedium)
                          : Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: tt.titleMedium),
                      if (c.customerName != null)
                        LtrText(
                          c.channel == Channel.whatsapp ? formatPhone(c.displayId) : c.displayId,
                          style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.text3, height: 1.3),
                        ),
                    ],
                  ),
                ),
              ],
            ),
      actions: [
        if (c != null && c.status != ConversationStatus.closed)
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 10),
            child: _OwnershipButton(conv: c, busy: busy, onPressed: () => _toggleOwnership(c)),
          ),
      ],
    );
  }

  Widget _messages(BuildContext context, ChatState state, List<OutboxEntry> pending, String agentName, DateTime now) {
    final hc = context.hc;
    if (state.loading && state.messages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (state.messages.isEmpty && pending.isEmpty) {
      return state.error != null
          ? StateMessage(
              icon: Icons.wifi_off_rounded,
              title: 'تعذّر تحميل الرسائل',
              body: state.error!.message,
              actionLabel: 'إعادة المحاولة',
              onAction: () => unawaited(_ctrl.refresh()),
            )
          : const StateMessage(icon: Icons.chat_outlined, title: 'لا رسائل بعد');
    }

    // ما أكّده الخادم يُسقط نسخته المتفائلة — لا تكرار حتى قبل حذفها من الطابور.
    final confirmed = state.messages.map((m) => m.clientId).whereType<String>().toSet();
    final rows = <_Row>[
      for (final m in state.messages) _Row.message(m),
      for (final e in pending)
        if (!confirmed.contains(e.clientId)) _Row.pending(e),
    ];
    // من الأحدث للأقدم مع فواصل الأيام (القائمة معكوسة: الأحدث في الأسفل).
    final display = <Object>[];
    for (var i = rows.length - 1; i >= 0; i--) {
      display.add(rows[i]);
      final older = i > 0 ? rows[i - 1] : null;
      if (older == null || !isSameLocalDay(older.at, rows[i].at)) {
        display.add(dateSeparator(rows[i].at, now));
      }
    }
    if (state.hasMore) display.add(state.loadingOlder ? const _LoadingOlder() : const SizedBox(height: 24));

    return ListView.builder(
      controller: _scroll,
      reverse: true,
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
      itemCount: display.length,
      itemBuilder: (context, i) {
        final item = display[i];
        if (item is String) return DateChip(item);
        if (item is Widget) return item;
        final row = item as _Row;
        final newer = i > 0 && display[i - 1] is _Row ? display[i - 1] as _Row : null;
        final grouped = newer != null && newer.role == row.role && newer.at.difference(row.at).inMinutes < 3;
        final m = row.message;
        if (m != null) return MessageBubble.fromMessage(m, agentName: agentName, groupedWithNext: grouped);
        final e = row.entry!;
        return MessageBubble.fromOutbox(e, agentName: agentName, onFailedTap: () => _failedOptions(e));
      },
    ).withBackground(hc);
  }
}

extension on Widget {
  Widget withBackground(HaderColors hc) => ColoredBox(color: hc.bg, child: this);
}

class _Row {
  _Row.message(Message this.message) : entry = null;
  _Row.pending(OutboxEntry this.entry) : message = null;

  final Message? message;
  final OutboxEntry? entry;

  DateTime get at => message?.at ?? entry!.createdAt;
  Role get role => message?.role ?? Role.human;
}

class _LoadingOlder extends StatelessWidget {
  const _LoadingOlder();

  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))),
      );
}

class _OwnershipButton extends StatelessWidget {
  const _OwnershipButton({required this.conv, required this.busy, required this.onPressed});

  final ConversationItem conv;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final human = conv.isHuman;
    return TextButton.icon(
      key: const Key('chat.ownership'),
      onPressed: busy ? null : onPressed,
      style: TextButton.styleFrom(
        foregroundColor: human ? hc.text2 : hc.onLive,
        backgroundColor: human ? hc.surface2 : hc.live,
        minimumSize: const Size(0, 38),
        padding: const EdgeInsets.symmetric(horizontal: 12),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: human ? BorderSide(color: hc.border2) : BorderSide.none,
        ),
        textStyle: const TextStyle(fontFamily: kFont, fontSize: 13.5, fontWeight: FontWeight.w600),
      ),
      icon: busy
          ? SizedBox.square(dimension: 14, child: CircularProgressIndicator(strokeWidth: 2, color: hc.text3))
          : Icon(human ? Icons.smart_toy_outlined : Icons.pan_tool_alt_outlined, size: 17),
      label: Text(human ? 'أعِد للوكيل' : 'استلم'),
    );
  }
}

class _HandoffBanner extends StatelessWidget {
  const _HandoffBanner({required this.conv});
  final ConversationItem conv;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final reason = conv.handoffReason;
    return Container(
      key: const Key('chat.handoff'),
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      decoration: BoxDecoration(
        color: reason != null ? hc.handoff.withValues(alpha: 0.08) : hc.surface,
        border: Border(bottom: BorderSide(color: reason != null ? hc.handoff.withValues(alpha: 0.2) : hc.border)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(
              reason != null ? Icons.front_hand_outlined : Icons.person_outline_rounded,
              size: 18,
              color: reason != null ? hc.handoff : hc.text2,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  reason != null ? 'حوّلها الوكيل إليك' : 'أنت تتولّى هذه المحادثة',
                  style: TextStyle(
                    fontFamily: kFont,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: reason != null ? hc.handoff : hc.text,
                    height: 1.4,
                  ),
                ),
                Text(
                  reason ?? 'الوكيل لن يرد هنا حتى تعيدها له.',
                  style: TextStyle(fontFamily: kFont, fontSize: 13, color: hc.text2, height: 1.45),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// المحرّر — أو بديله حين تُغلق النافذة.
class Composer extends StatefulWidget {
  const Composer({
    super.key,
    required this.conversation,
    required this.now,
    required this.onSend,
    required this.onTemplate,
  });

  final ConversationItem conversation;
  final DateTime now;
  final Future<void> Function(String text) onSend;
  final VoidCallback onTemplate;

  @override
  State<Composer> createState() => _ComposerState();
}

class _ComposerState extends State<Composer> {
  final _text = TextEditingController();
  bool _hasText = false;

  static const maxLength = 4096;

  @override
  void initState() {
    super.initState();
    _text.addListener(() {
      final has = _text.text.trim().isNotEmpty;
      if (has != _hasText) setState(() => _hasText = has);
    });
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final t = _text.text.trim();
    if (t.isEmpty) return;
    // التفريغ قبل الإرسال: الرسالة صارت في الطابور، ونقرة ثانية سريعة لا
    // تجد نصاً تكرّره.
    _text.clear();
    await widget.onSend(t.length > maxLength ? t.substring(0, maxLength) : t);
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final c = widget.conversation;
    final w = c.window;
    final open = w.isOpenAt(widget.now);
    final bottom = MediaQuery.paddingOf(context).bottom;

    if (c.status == ConversationStatus.closed && !open) {
      return _ClosedPanel(
        bottom: bottom,
        icon: Icons.inventory_2_outlined,
        text: 'المحادثة مغلقة.',
        action: c.channel.supportsTemplates ? 'أرسل قالب' : null,
        onAction: widget.onTemplate,
      );
    }

    if (!open) {
      return _ClosedPanel(
        key: const Key('composer.closed'),
        bottom: bottom,
        icon: Icons.lock_clock_outlined,
        text: c.channel.supportsTemplates
            ? 'انتهت نافذة الـ٢٤ ساعة. يمكنك المراسلة بقالب معتمد فقط.'
            : 'انتهت نافذة الرد على ${c.channel.label}. تُفتح من جديد حين يراسلك العميل.',
        action: c.channel.supportsTemplates ? 'أرسل قالب' : null,
        onAction: widget.onTemplate,
      );
    }

    final label = windowRemainingLabel(w, widget.now);
    final urgency = windowUrgency(w, widget.now);
    final urgencyColor = switch (urgency) {
      WindowUrgency.critical => hc.danger,
      WindowUrgency.soon => hc.warn,
      WindowUrgency.calm => hc.text3,
    };

    return Container(
      key: const Key('composer.open'),
      decoration: BoxDecoration(color: hc.bg2, border: Border(top: BorderSide(color: hc.border))),
      padding: EdgeInsets.fromLTRB(10, 6, 10, 8 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (label != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(6, 0, 6, 6),
              child: Row(
                children: [
                  Icon(Icons.schedule_rounded, size: 14, color: urgencyColor),
                  const SizedBox(width: 5),
                  Text(
                    label,
                    key: const Key('composer.remaining'),
                    style: TextStyle(fontFamily: kFont, fontSize: 12, fontWeight: FontWeight.w500, color: urgencyColor, height: 1.3),
                  ),
                  const Spacer(),
                  if (!c.isHuman)
                    Text(
                      'ردّك يوقف الوكيل هنا',
                      style: TextStyle(fontFamily: kFont, fontSize: 11.5, color: hc.text3, height: 1.3),
                    ),
                ],
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  key: const Key('composer.input'),
                  controller: _text,
                  minLines: 1,
                  maxLines: 6,
                  maxLength: maxLength,
                  textCapitalization: TextCapitalization.sentences,
                  keyboardType: TextInputType.multiline,
                  style: TextStyle(fontFamily: kFont, fontSize: 15.5, color: hc.text, height: 1.45),
                  decoration: InputDecoration(
                    hintText: 'اكتب ردّك…',
                    counterText: '',
                    isDense: true,
                    fillColor: hc.surface,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide(color: hc.border)),
                    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide(color: hc.border)),
                    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide(color: hc.border2)),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              AnimatedScale(
                scale: _hasText ? 1 : 0.9,
                duration: const Duration(milliseconds: 160),
                child: Material(
                  color: _hasText ? hc.live : hc.surface3,
                  shape: const CircleBorder(),
                  child: InkWell(
                    key: const Key('composer.send'),
                    customBorder: const CircleBorder(),
                    onTap: _hasText ? _send : null,
                    child: SizedBox.square(
                      dimension: 48,
                      child: Icon(
                        // سهم الإرسال يشير لجهة القراءة: يساراً في RTL.
                        Icons.send_rounded,
                        color: _hasText ? hc.onLive : hc.text3,
                        size: 22,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ClosedPanel extends StatelessWidget {
  const _ClosedPanel({
    super.key,
    required this.bottom,
    required this.icon,
    required this.text,
    this.action,
    required this.onAction,
    this.actionIcon = Icons.description_outlined,
  });

  final IconData actionIcon;

  final double bottom;
  final IconData icon;
  final String text;
  final String? action;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Container(
      decoration: BoxDecoration(color: hc.bg2, border: Border(top: BorderSide(color: hc.border))),
      padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(padding: const EdgeInsets.only(top: 2), child: Icon(icon, size: 17, color: hc.text3)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(text, style: TextStyle(fontFamily: kFont, fontSize: 13, color: hc.text2, height: 1.5)),
              ),
            ],
          ),
          if (action != null) ...[
            const SizedBox(height: 10),
            FilledButton.icon(
              key: const Key('composer.template'),
              onPressed: onAction,
              icon: Icon(actionIcon, size: 20),
              label: Text(action!),
            ),
          ],
        ],
      ),
    );
  }
}
