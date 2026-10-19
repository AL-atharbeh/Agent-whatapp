import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/format.dart';
import '../../data/models.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import 'templates_provider.dart';

/// يفتح منتقي القوالب ويعيد الاختيار (أو null إن أُغلق).
Future<TemplateSelection?> showTemplateSheet(
  BuildContext context, {
  String actionLabel = 'إرسال القالب',
  List<String> prefill = const [],
}) =>
    showModalBottomSheet<TemplateSelection>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _TemplateSheet(actionLabel: actionLabel, prefill: prefill),
    );

class _TemplateSheet extends ConsumerStatefulWidget {
  const _TemplateSheet({required this.actionLabel, required this.prefill});

  final String actionLabel;
  final List<String> prefill;

  @override
  ConsumerState<_TemplateSheet> createState() => _TemplateSheetState();
}

class _TemplateSheetState extends ConsumerState<_TemplateSheet> {
  MessageTemplate? _selected;

  @override
  Widget build(BuildContext context) {
    final templates = ref.watch(templatesProvider);
    final height = MediaQuery.sizeOf(context).height;
    return AnimatedPadding(
      duration: const Duration(milliseconds: 120),
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: height * 0.86),
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 200),
          child: _selected == null
              ? _picker(templates)
              : TemplateForm(
                  key: ValueKey(_selected!.name),
                  template: _selected!,
                  actionLabel: widget.actionLabel,
                  prefill: widget.prefill,
                  onBack: () => setState(() => _selected = null),
                  onSubmit: (sel) => Navigator.of(context).pop(sel),
                ),
        ),
      ),
    );
  }

  Widget _picker(AsyncValue<List<MessageTemplate>> templates) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    return Column(
      key: const ValueKey('picker'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
          child: Text('اختر قالباً', style: tt.titleLarge),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: Text(
            'خارج نافذة الـ٢٤ ساعة لا تسمح Meta إلا بقوالب معتمدة.',
            style: tt.bodySmall,
          ),
        ),
        Flexible(
          child: templates.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(40),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (e, _) => StateMessage(
              icon: Icons.cloud_off_rounded,
              title: 'تعذّر تحميل القوالب',
              body: e is ApiError ? e.message : null,
              actionLabel: 'إعادة المحاولة',
              onAction: () => ref.invalidate(templatesProvider),
            ),
            data: (list) => list.isEmpty
                ? const StateMessage(
                    icon: Icons.description_outlined,
                    title: 'لا قوالب معتمدة',
                    body: 'أنشئ قالباً في WhatsApp Manager وانتظر اعتماده من Meta.',
                  )
                : ListView.separated(
                    shrinkWrap: true,
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    itemCount: list.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (_, i) {
                      final t = list[i];
                      return Material(
                        color: hc.surface2,
                        borderRadius: BorderRadius.circular(R.md),
                        child: InkWell(
                          key: Key('tpl.${t.name}'),
                          borderRadius: BorderRadius.circular(R.md),
                          onTap: () => setState(() => _selected = t),
                          child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: LtrText(
                                        t.name,
                                        style: TextStyle(fontFamily: kFont, fontSize: 13, fontWeight: FontWeight.w600, color: hc.text2),
                                      ),
                                    ),
                                    _Tag(_categoryLabel(t.category)),
                                    if (t.variables > 0) ...[
                                      const SizedBox(width: 6),
                                      _Tag('${arDigits(t.variables)} متغيّر'),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 6),
                                Text(t.body, maxLines: 3, overflow: TextOverflow.ellipsis, style: tt.bodyMedium),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ),
      ],
    );
  }

  static String _categoryLabel(String c) => switch (c.toUpperCase()) {
        'MARKETING' => 'تسويق',
        'UTILITY' => 'خدمة',
        'AUTHENTICATION' => 'تحقق',
        _ => c.isEmpty ? 'قالب' : c,
      };
}

class _Tag extends StatelessWidget {
  const _Tag(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: hc.surface3, borderRadius: BorderRadius.circular(R.xs)),
      child: Text(text, style: TextStyle(fontFamily: kFont, fontSize: 11, color: hc.text2, height: 1.4)),
    );
  }
}

/// تعبئة متغيّرات قالب مع معاينة حيّة. تُستخدم في الورقة وفي «محادثة جديدة».
class TemplateForm extends StatefulWidget {
  const TemplateForm({
    super.key,
    required this.template,
    required this.actionLabel,
    required this.onSubmit,
    this.onBack,
    this.prefill = const [],
    this.embedded = false,
    this.busy = false,
  });

  final MessageTemplate template;
  final String actionLabel;
  final ValueChanged<TemplateSelection> onSubmit;
  final VoidCallback? onBack;
  final List<String> prefill;

  /// داخل شاشة أخرى (لا ورقة): بلا زر رجوع ولا تمرير خاص.
  final bool embedded;
  final bool busy;

  @override
  State<TemplateForm> createState() => _TemplateFormState();
}

class _TemplateFormState extends State<TemplateForm> {
  late final List<TextEditingController> _vars = List.generate(
    widget.template.variables,
    (i) => TextEditingController(text: i < widget.prefill.length ? widget.prefill[i] : ''),
  );

  @override
  void initState() {
    super.initState();
    for (final c in _vars) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final c in _vars) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _complete => _vars.every((c) => c.text.trim().isNotEmpty);

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final t = widget.template;
    final values = _vars.map((c) => c.text).toList();

    final content = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (!widget.embedded)
          Row(
            children: [
              IconButton(
                tooltip: 'رجوع',
                onPressed: widget.onBack,
                icon: const Icon(Icons.arrow_back_rounded),
              ),
              Expanded(child: LtrText(t.name, style: tt.titleMedium)),
              const SizedBox(width: 12),
            ],
          ),
        if (t.variables > 0) ...[
          const SizedBox(height: 4),
          for (var i = 0; i < _vars.length; i++)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: TextField(
                key: Key('tpl.var.$i'),
                controller: _vars[i],
                enabled: !widget.busy,
                textInputAction: i == _vars.length - 1 ? TextInputAction.done : TextInputAction.next,
                maxLength: 200,
                decoration: InputDecoration(
                  labelText: 'المتغيّر ${arDigits(i + 1)}',
                  counterText: '',
                  prefixIcon: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: LtrText('{{${i + 1}}}', style: TextStyle(fontFamily: kFont, color: hc.live, fontWeight: FontWeight.w600)),
                  ),
                  prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
                ),
              ),
            ),
        ],
        const SizedBox(height: 6),
        Text('معاينة', style: tt.labelMedium),
        const SizedBox(height: 8),
        // المعاينة بنفس شكل فقاعة «أنت» — ما يراه المالك هنا هو ما سيصل.
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: Container(
            key: const Key('tpl.preview'),
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            decoration: BoxDecoration(
              color: hc.bubbleHuman,
              borderRadius: const BorderRadiusDirectional.only(
                topStart: Radius.circular(18),
                topEnd: Radius.circular(18),
                bottomStart: Radius.circular(18),
                bottomEnd: Radius.circular(5),
              ),
            ),
            child: Text.rich(
              _previewSpans(t.body, values, hc),
              style: TextStyle(fontFamily: kFont, fontSize: 15, color: hc.onBubbleHuman, height: 1.55, fontWeight: FontWeight.w500),
            ),
          ),
        ),
        const SizedBox(height: 18),
        FilledButton(
          key: const Key('tpl.submit'),
          onPressed: _complete && !widget.busy
              ? () => widget.onSubmit(TemplateSelection(template: t, variables: values.map((v) => v.trim()).toList()))
              : null,
          child: widget.busy
              ? SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: hc.text2))
              : Text(_complete ? widget.actionLabel : 'أكمل المتغيّرات'),
        ),
      ],
    );

    if (widget.embedded) return content;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      child: content,
    );
  }

  /// المتغيّرات الفارغة تظهر {{n}} مظلّلة كي يرى المالك ما ينقص.
  static TextSpan _previewSpans(String body, List<String> values, HaderColors hc) {
    final re = RegExp(r'\{\{\s*(\d+)\s*\}\}');
    final spans = <InlineSpan>[];
    var last = 0;
    for (final m in re.allMatches(body)) {
      spans.add(TextSpan(text: body.substring(last, m.start)));
      final i = int.parse(m.group(1)!) - 1;
      final v = i >= 0 && i < values.length ? values[i].trim() : '';
      spans.add(v.isEmpty
          ? TextSpan(
              text: ' {{${i + 1}}} ',
              style: TextStyle(backgroundColor: hc.onBubbleHuman.withValues(alpha: 0.14), fontWeight: FontWeight.w700),
            )
          : TextSpan(text: v, style: const TextStyle(fontWeight: FontWeight.w700)));
      last = m.end;
    }
    spans.add(TextSpan(text: body.substring(last)));
    return TextSpan(children: spans);
  }
}
