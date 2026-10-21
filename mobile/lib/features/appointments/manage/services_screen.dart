import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors.dart';
import '../../../core/format.dart';
import '../../../core/providers.dart';
import '../../../data/appointments.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets/common.dart';
import '../appointments_controller.dart';
import '../appt_style.dart';
import 'manage_providers.dart';

/// الخدمات: السعر من–إلى، المدة الافتراضية، وقت الانتظار، وتذكير العودة.
class ServicesManageScreen extends ConsumerWidget {
  const ServicesManageScreen({super.key});

  static Route<void> route() => MaterialPageRoute(builder: (_) => const ServicesManageScreen());

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final async = ref.watch(manageServicesProvider);
    final currency = ref.watch(currencyProvider);

    Future<void> open([ServiceOffering? s]) async {
      final saved = await Navigator.of(context).push<bool>(ServiceEditorScreen.route(s));
      if (saved == true) refreshAfterManage(ref);
    }

    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: const Text('الخدمات')),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('services.add'),
        onPressed: open,
        icon: const Icon(Icons.add_rounded),
        label: const Text('خدمة جديدة'),
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => StateMessage(
          icon: Icons.cloud_off_rounded,
          title: 'تعذّر تحميل الخدمات',
          body: e is ApiError ? e.message : null,
          actionLabel: 'إعادة المحاولة',
          onAction: () => ref.invalidate(manageServicesProvider),
        ),
        data: (list) => list.isEmpty
            ? const StateMessage(
                icon: Icons.design_services_outlined,
                title: 'لا خدمات بعد',
                body: 'أضف أول خدمة: اسمها وسعرها ومدتها.',
              )
            : ListView(
                padding: EdgeInsets.only(top: 8, bottom: 96 + MediaQuery.paddingOf(context).bottom),
                children: [
                  for (final s in list)
                    ListTile(
                      key: Key('services.${s.id}'),
                      title: Text(s.name),
                      subtitle: Text(
                        [
                          priceRange(s, currency),
                          arMinutes(s.defaultMinutes),
                          if (s.hasProcessing) 'فيه وقت انتظار',
                          if (s.rebookAfterDays != null) 'عودة بعد ${arDays(s.rebookAfterDays!)}',
                        ].join(' · '),
                      ),
                      trailing: s.active
                          ? const Icon(Icons.chevron_left_rounded)
                          : Text('موقوفة', style: TextStyle(fontFamily: kFont, color: hc.text3)),
                      onTap: () => open(s),
                    ),
                ],
              ),
      ),
    );
  }
}

class ServiceEditorScreen extends ConsumerStatefulWidget {
  const ServiceEditorScreen({super.key, this.service});

  /// null ⇒ خدمة جديدة.
  final ServiceOffering? service;

  static Route<bool> route(ServiceOffering? s) =>
      MaterialPageRoute(builder: (_) => ServiceEditorScreen(service: s));

  @override
  ConsumerState<ServiceEditorScreen> createState() => _ServiceEditorState();
}

class _ServiceEditorState extends ConsumerState<ServiceEditorScreen> {
  late final _name = TextEditingController(text: widget.service?.name);
  late final _category = TextEditingController(text: widget.service?.category);
  late final _priceMin = TextEditingController(text: _num(widget.service?.priceMin));
  late final _priceMax = TextEditingController(text: _num(widget.service?.priceMax));
  late final _minutes = TextEditingController(text: _num(widget.service?.defaultMinutes ?? 30));
  late final _procAfter = TextEditingController(text: _num(_orNull(widget.service?.processingAfterMinutes)));
  late final _procMinutes = TextEditingController(text: _num(_orNull(widget.service?.processingMinutes)));
  late final _rebook = TextEditingController(text: _num(widget.service?.rebookAfterDays));
  late bool _active = widget.service?.active ?? true;
  bool _saving = false;
  String? _error;

  static int? _orNull(int? v) => v == null || v == 0 ? null : v;

  static String _num(num? v) {
    if (v == null) return '';
    return v == v.roundToDouble() ? v.toInt().toString() : v.toString();
  }

  /// الأرقام كما تُكتب على لوحة عربية: «١٢٫٥» أو «12.5».
  static double? _parse(TextEditingController c) {
    final t = arToAsciiDigits(c.text.trim()).replaceAll('٫', '.').replaceAll(',', '.');
    return t.isEmpty ? null : double.tryParse(t);
  }

  @override
  void dispose() {
    for (final c in [_name, _category, _priceMin, _priceMax, _minutes, _procAfter, _procMinutes, _rebook]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final priceMin = _parse(_priceMin);
    final minutes = _parse(_minutes)?.round();
    if (name.isEmpty || priceMin == null || minutes == null) {
      setState(() => _error = 'الاسم والسعر والمدة مطلوبة.');
      return;
    }
    final procMinutes = _parse(_procMinutes)?.round() ?? 0;
    final s = ServiceOffering(
      id: widget.service?.id ?? '',
      name: name,
      category: _category.text.trim().isEmpty ? null : _category.text.trim(),
      priceMin: priceMin,
      priceMax: _parse(_priceMax),
      defaultMinutes: minutes,
      processingAfterMinutes: procMinutes == 0 ? 0 : (_parse(_procAfter)?.round() ?? 0),
      processingMinutes: procMinutes,
      rebookAfterDays: _parse(_rebook)?.round(),
      active: _active,
    );
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(apiProvider).saveService(s, id: widget.service?.id);
      unawaited(HapticFeedback.lightImpact());
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final currency = currencyLabel(ref.watch(currencyProvider));
    Widget field(TextEditingController c, String label, {String? suffix, String? hint, bool number = true, Key? key}) =>
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: TextField(
            key: key,
            controller: c,
            keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
            decoration: InputDecoration(labelText: label, suffixText: suffix, helperText: hint),
          ),
        );

    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: Text(widget.service == null ? 'خدمة جديدة' : 'تعديل الخدمة')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, 12, 16, 32 + MediaQuery.paddingOf(context).bottom),
        children: [
          field(_name, 'اسم الخدمة *', number: false, key: const Key('service.name')),
          field(_category, 'التصنيف', number: false, hint: 'اختياري — لتجميع الخدمات'),
          Row(
            children: [
              Expanded(child: field(_priceMin, 'السعر من *', suffix: currency, key: const Key('service.priceMin'))),
              const SizedBox(width: 12),
              Expanded(child: field(_priceMax, 'السعر إلى', suffix: currency, hint: 'فارغ = سعر ثابت')),
            ],
          ),
          field(_minutes, 'المدة الافتراضية *', suffix: 'دقيقة', hint: 'لعميل جديد؛ بعدها يتعلّم النظام مدة كل عميل', key: const Key('service.minutes')),
          const SectionLabel('وقت الانتظار داخل الخدمة'),
          Text(
            'مثل تثبيت مادة أو تشغيل جهاز: مقدّم الخدمة فاضٍ فيه لعميل آخر.',
            style: TextStyle(fontFamily: kFont, fontSize: 12.5, color: hc.text3),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: field(_procAfter, 'يبدأ بعد', suffix: 'دقيقة')),
              const SizedBox(width: 12),
              Expanded(child: field(_procMinutes, 'مدة الانتظار', suffix: 'دقيقة')),
            ],
          ),
          field(_rebook, 'تذكير العودة بعد', suffix: 'يوم', hint: 'فارغ = بلا تذكير'),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('الخدمة متاحة للحجز'),
            subtitle: const Text('الإيقاف يخفيها من الحجز ويُبقي سجلّها'),
            value: _active,
            onChanged: (v) => setState(() => _active = v),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(fontFamily: kFont, color: hc.danger)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('service.save'),
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'جارٍ الحفظ…' : 'حفظ'),
          ),
        ],
      ),
    );
  }
}
