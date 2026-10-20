import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../data/appointments.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/common.dart';
import 'customer_profile_screen.dart';

/// قائمة العملاء بالبحث — وتُستخدم نفس [CustomerSearch] لاختيار عميل عند
/// الحجز، كي يكون «ابحث بالاسم أو الرقم» سلوكاً واحداً في كل مكان.
class CustomersScreen extends StatelessWidget {
  const CustomersScreen({super.key});

  static Route<void> route() => MaterialPageRoute(builder: (_) => const CustomersScreen());

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: const Text('العملاء')),
      body: CustomerSearch(
        onPick: (c) => Navigator.of(context).push(CustomerProfileScreen.route(c.id)),
      ),
    );
  }
}

/// بحث مع تأخير قصير: كل حرف لا يستحق طلباً، وردّ قديم لا يكتب فوق أحدث.
class CustomerSearch extends ConsumerStatefulWidget {
  const CustomerSearch({super.key, required this.onPick, this.compact = false});

  final ValueChanged<Customer> onPick;

  /// داخل شاشة الحجز: قائمة قصيرة بلا تمرير مستقل.
  final bool compact;

  @override
  ConsumerState<CustomerSearch> createState() => _CustomerSearchState();
}

class _CustomerSearchState extends ConsumerState<CustomerSearch> {
  final _q = TextEditingController();
  Timer? _debounce;
  int _seq = 0;
  List<Customer> _results = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_search(''));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => unawaited(_search(v)));
  }

  Future<void> _search(String q) async {
    final seq = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await ref.read(apiProvider).customers(arToAsciiDigits(q));
      if (!mounted || seq != _seq) return;
      setState(() {
        _results = r;
        _loading = false;
      });
    } on ApiError catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    }
  }

  /// يبدو رقماً؟ نعرض «إضافة عميل بهذا الرقم» — العميل الحضوري أو الهاتفي
  /// لا يوجد بعد، ويجب ألّا يحتاج المالك شاشة أخرى لإضافته.
  bool get _looksLikePhone => RegExp(r'^[+\d\s٠-٩]{8,}$').hasMatch(_q.text.trim());

  Future<void> _createFromQuery() async {
    final phone = arToAsciiDigits(_q.text.trim());
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final c = TextEditingController();
        return AlertDialog(
          title: const Text('عميل جديد'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              LtrText(phone),
              const SizedBox(height: 12),
              TextField(
                key: const Key('customer.newName'),
                controller: c,
                autofocus: true,
                decoration: const InputDecoration(labelText: 'الاسم (اختياري)'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
            TextButton(key: const Key('customer.create'), onPressed: () => Navigator.pop(ctx, c.text), child: const Text('إضافة')),
          ],
        );
      },
    );
    if (name == null || !mounted) return;
    try {
      final c = await ref.read(apiProvider).createCustomer(phone: phone, name: name);
      unawaited(HapticFeedback.lightImpact());
      widget.onPick(c);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final list = widget.compact ? _results.take(5).toList() : _results;
    final field = Padding(
      padding: EdgeInsets.fromLTRB(widget.compact ? 0 : 16, 8, widget.compact ? 0 : 16, 8),
      child: TextField(
        key: const Key('customer.search'),
        controller: _q,
        onChanged: _onChanged,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: 'ابحث بالاسم أو الرقم',
          prefixIcon: const Icon(Icons.search_rounded),
          suffixIcon: _loading
              ? const Padding(
                  padding: EdgeInsets.all(14),
                  child: SizedBox.square(dimension: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                )
              : null,
        ),
      ),
    );

    final rows = <Widget>[
      if (_looksLikePhone && !_results.any((c) => (c.phone ?? '').endsWith(arToAsciiDigits(_q.text.trim()).replaceAll(RegExp(r'^0'), ''))))
        ListTile(
          key: const Key('customer.addByPhone'),
          leading: CircleAvatar(backgroundColor: hc.liveDim, child: Icon(Icons.person_add_alt_1_rounded, color: hc.live)),
          title: const Text('إضافة عميل بهذا الرقم'),
          subtitle: LtrText(_q.text.trim()),
          onTap: _createFromQuery,
        ),
      for (final c in list)
        ListTile(
          key: Key('customer.${c.id}'),
          leading: InitialsAvatar(seed: c.id, label: c.name ?? c.phone ?? '؟', size: 40),
          title: Text(c.name ?? (c.phone == null ? 'عميل' : formatPhone(c.phone!)),
              textDirection: c.name == null ? TextDirection.ltr : null, textAlign: TextAlign.start),
          subtitle: c.name != null && c.phone != null ? LtrText(formatPhone(c.phone!)) : null,
          trailing: c.noShowCount > 0
              ? Text('غياب ${arDigits(c.noShowCount)}', style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.danger))
              : (c.visitCount > 0
                  ? Text(arCount(c.visitCount, one: 'زيارة', two: 'زيارتان', few: 'زيارات'),
                      style: TextStyle(fontFamily: kFont, fontSize: 12, color: hc.text3))
                  : null),
          onTap: () => widget.onPick(c),
        ),
      if (_error != null)
        Padding(
          padding: const EdgeInsets.all(12),
          child: Text(_error!, style: TextStyle(fontFamily: kFont, color: hc.danger)),
        ),
      if (!_loading && _error == null && list.isEmpty && !_looksLikePhone)
        const Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: Text('لا نتائج. اكتب رقم الهاتف لإضافة عميل جديد.')),
        ),
    ];

    if (widget.compact) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [field, ...rows]);
    }
    return Column(
      children: [
        field,
        Expanded(
          child: ListView(
            padding: EdgeInsets.only(bottom: 24 + MediaQuery.paddingOf(context).bottom),
            children: rows,
          ),
        ),
      ],
    );
  }
}
