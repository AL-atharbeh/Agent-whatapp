import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../../core/errors.dart';
import '../../core/providers.dart';
import '../../data/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import '../../ui/widgets/glyphs.dart';
import '../chat/chat_screen.dart';
import '../chat/template_sheet.dart';
import '../chat/templates_provider.dart';

/// محادثة واتساب جديدة: رقم + اسم اختياري + قالب ⇒ POST /conversations/start.
class NewConversationScreen extends ConsumerStatefulWidget {
  const NewConversationScreen({super.key});

  static Route<void> route() => MaterialPageRoute(
        builder: (_) => const NewConversationScreen(),
        fullscreenDialog: true,
      );

  @override
  ConsumerState<NewConversationScreen> createState() => _NewConversationScreenState();
}

class _NewConversationScreenState extends ConsumerState<NewConversationScreen> {
  final _phone = TextEditingController();
  final _name = TextEditingController();
  MessageTemplate? _template;
  bool _busy = false;
  String? _error;

  /// clientId واحد لهذه الشاشة: ضغط «ابدأ» مرتين، أو إعادة بعد انقطاع، لا
  /// تُرسل القالب للعميل مرتين. يتجدد فقط إن غيّر المستخدم المُدخلات.
  String _clientId = const Uuid().v4();
  String? _lastPayloadKey;
  bool _forceNewId = false;

  @override
  void dispose() {
    _phone.dispose();
    _name.dispose();
    super.dispose();
  }

  String? _validatePhone(String raw) {
    final digits = raw.replaceAll(RegExp(r'[^\d]'), '');
    if (digits.length < 8 || digits.length > 15) return 'أدخل رقم هاتف صحيحاً، مثل 0770466649 أو ‎+962770466649.';
    return null;
  }

  Future<void> _start(TemplateSelection sel) async {
    final phoneError = _validatePhone(_phone.text);
    if (phoneError != null) {
      setState(() => _error = phoneError);
      return;
    }
    final key = '${_phone.text.trim()}|${_name.text.trim()}|${sel.template.name}|${sel.variables.join('|')}';
    // معرّف جديد فقط إن تغيّر المحتوى (الخادم يرفض نفس المعرّف لمحتوى آخر)،
    // أو إن قرّر المستخدم الإرسال مجدداً بعد «غير مؤكّد».
    if ((_lastPayloadKey != null && _lastPayloadKey != key) || _forceNewId) {
      _clientId = const Uuid().v4();
      _forceNewId = false;
    }
    _lastPayloadKey = key;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final conv = await ref.read(apiProvider).startConversation(
            phone: _phone.text,
            name: _name.text,
            template: sel,
            clientId: _clientId,
          );
      ref.read(conversationPatchProvider.notifier).publish(conv);
      await ref.read(databaseProvider).upsertConversations([conv]);
      unawaited(HapticFeedback.mediumImpact());
      if (!mounted) return;
      unawaited(Navigator.of(context).pushReplacement(ChatScreen.route(conv.id, initial: conv)));
    } on ApiError catch (e) {
      if (e.code == ApiErrorCode.tenantInactive) ref.read(tenantInactiveProvider.notifier).mark();
      final uncertain = e.code == ApiErrorCode.deliveryUnknown || e.code == ApiErrorCode.internal;
      // غير مؤكّد: الضغطة التالية قرار واعٍ بالإرسال مجدداً ⇒ معرّف جديد.
      if (uncertain) _forceNewId = true;
      if (!mounted) return;
      setState(() => _error = switch (e.code) {
            ApiErrorCode.inProgress => 'الإرسال ما زال جارياً. انتظر لحظة ثم تحقّق من قائمة المحادثات.',
            _ when uncertain =>
              'غير مؤكّد — ربما وصل القالب للعميل. تحقّق من قائمة المحادثات؛ الضغط مجدداً يرسله مرة ثانية.',
            _ => e.message,
          });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final templates = ref.watch(templatesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('محادثة جديدة'),
        leading: IconButton(
          tooltip: 'إغلاق',
          icon: const Icon(Icons.close_rounded),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          children: [
            Row(
              children: [
                const ChannelGlyph(Channel.whatsapp, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'تبدأ المحادثة بقالب معتمد، ثم تُفتح نافذة الرد الحر حين يرد العميل.',
                    style: tt.bodySmall,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            TextField(
              key: const Key('new.phone'),
              controller: _phone,
              enabled: !_busy,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              textAlign: TextAlign.left,
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d+ ]')), LengthLimitingTextInputFormatter(18)],
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(
                labelText: 'رقم الهاتف',
                hintText: '0770466649',
                prefixIcon: Icon(Icons.phone_outlined),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('new.name'),
              controller: _name,
              enabled: !_busy,
              textInputAction: TextInputAction.done,
              maxLength: 80,
              decoration: const InputDecoration(
                labelText: 'اسم العميل (اختياري)',
                prefixIcon: Icon(Icons.person_outline_rounded),
                counterText: '',
              ),
            ),
            const SizedBox(height: 20),
            Text('القالب', style: tt.titleSmall),
            const SizedBox(height: 8),
            templates.when(
              loading: () => const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator())),
              error: (e, _) => StateMessage(
                icon: Icons.cloud_off_rounded,
                title: 'تعذّر تحميل القوالب',
                body: e is ApiError ? e.message : null,
                actionLabel: 'إعادة المحاولة',
                onAction: () => ref.invalidate(templatesProvider),
              ),
              data: (list) => Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final t in list)
                    ChoiceChip(
                      key: Key('new.tpl.${t.name}'),
                      label: LtrText(t.name),
                      selected: _template?.name == t.name,
                      onSelected: _busy ? null : (_) => setState(() => _template = t),
                      selectedColor: hc.liveDim,
                      side: BorderSide(color: _template?.name == t.name ? hc.live : hc.border),
                    ),
                ],
              ),
            ),
            if (_template != null) ...[
              const SizedBox(height: 16),
              SurfaceCard(
                padding: const EdgeInsets.all(14),
                child: TemplateForm(
                  key: ValueKey(_template!.name),
                  template: _template!,
                  embedded: true,
                  busy: _busy,
                  prefill: [if (_name.text.trim().isNotEmpty) _name.text.trim()],
                  actionLabel: 'ابدأ المحادثة',
                  onSubmit: _start,
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 14),
              Text(_error!, key: const Key('new.error'), style: tt.bodyMedium?.copyWith(color: hc.danger)),
            ],
          ],
        ),
      ),
    );
  }
}
