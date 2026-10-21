import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/errors.dart';
import '../../../core/format.dart';
import '../../../core/providers.dart';
import '../../../data/appointments.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets/common.dart';
import '../appointments_controller.dart';
import '../staff_avatar.dart';
import 'manage_providers.dart';

/// الفريق: الدوام لكل يوم، الخدمات التي يقدّمها كل واحد، العمولة، والصورة.
class TeamManageScreen extends ConsumerWidget {
  const TeamManageScreen({super.key});

  static Route<void> route() => MaterialPageRoute(builder: (_) => const TeamManageScreen());

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hc = context.hc;
    final async = ref.watch(manageStaffProvider);

    Future<void> open([StaffMember? s]) async {
      final saved = await Navigator.of(context).push<bool>(StaffEditorScreen.route(s));
      if (saved == true) refreshAfterManage(ref);
    }

    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: const Text('الفريق')),
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('team.add'),
        onPressed: open,
        icon: const Icon(Icons.person_add_alt_1_rounded),
        label: const Text('إضافة للفريق'),
      ),
      body: async.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => StateMessage(
          icon: Icons.cloud_off_rounded,
          title: 'تعذّر تحميل الفريق',
          body: e is ApiError ? e.message : null,
          actionLabel: 'إعادة المحاولة',
          onAction: () => ref.invalidate(manageStaffProvider),
        ),
        data: (list) => list.isEmpty
            ? const StateMessage(
                icon: Icons.groups_2_outlined,
                title: 'لا أحد في الفريق بعد',
                body: 'أضف من يقدّم الخدمات، ودوام كل واحد.',
              )
            : ListView(
                padding: EdgeInsets.only(top: 8, bottom: 96 + MediaQuery.paddingOf(context).bottom),
                children: [
                  for (final s in list)
                    ListTile(
                      key: Key('team.${s.id}'),
                      leading: StaffAvatar(staff: s, size: 44),
                      title: Text(s.name),
                      subtitle: Text(_hoursSummary(s)),
                      trailing: s.active
                          ? const Icon(Icons.chevron_left_rounded)
                          : Text('موقوف', style: TextStyle(fontFamily: kFont, color: hc.text3)),
                      onTap: () => open(s),
                    ),
                ],
              ),
      ),
    );
  }

  static String _hoursSummary(StaffMember s) {
    final days = _weekOrder.where((d) => (s.workingHours[d] ?? const []).isNotEmpty).length;
    return days == 0 ? 'بلا دوام محدّد' : 'يداوم ${arDays(days)} بالأسبوع';
  }
}

/// أسبوع يبدأ بالسبت كما يعدّه عملاؤنا؛ المفاتيح هي مفاتيح الخادم.
const _weekOrder = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
const _dayNames = {
  'sat': 'السبت',
  'sun': 'الأحد',
  'mon': 'الاثنين',
  'tue': 'الثلاثاء',
  'wed': 'الأربعاء',
  'thu': 'الخميس',
  'fri': 'الجمعة',
};

class StaffEditorScreen extends ConsumerStatefulWidget {
  const StaffEditorScreen({super.key, this.member});

  /// null ⇒ عضو جديد.
  final StaffMember? member;

  static Route<bool> route(StaffMember? s) => MaterialPageRoute(builder: (_) => StaffEditorScreen(member: s));

  @override
  ConsumerState<StaffEditorScreen> createState() => _StaffEditorState();
}

class _StaffEditorState extends ConsumerState<StaffEditorScreen> {
  late final _name = TextEditingController(text: widget.member?.name);
  late final _phone = TextEditingController(text: widget.member?.phone);
  late final _commission = TextEditingController(
    text: widget.member?.commissionPercent == null ? '' : _trim(widget.member!.commissionPercent!),
  );
  late bool _active = widget.member?.active ?? true;
  late final Map<String, List<DayRange>> _hours = {
    for (final d in _weekOrder)
      d: [
        ...?(widget.member == null
            // عضو جديد: دوام شائع يُعدَّل، أسهل من سبعة أيام فارغة
            ? (d == 'fri' ? null : [(start: 10 * 60, end: 18 * 60)])
            : widget.member!.workingHours[d]),
      ],
  };
  late final Set<String> _services = {...?widget.member?.serviceIds};

  /// صورة مختارة لم تُرفع بعد — تُرفع بعد الحفظ (العضو الجديد بلا معرّف قبله).
  Uint8List? _pendingPhoto;
  bool _removePhoto = false;
  bool _saving = false;
  String? _error;

  static String _trim(double v) => v == v.roundToDouble() ? v.toInt().toString() : v.toString();

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _commission.dispose();
    super.dispose();
  }

  /// الصورة تُصغَّر على الجهاز: حد الخادم ١٥٠ كيلوبايت، وصورة كاميرا تتجاوزه
  /// بعشرات الأضعاف. نحاول بجودة أقل قبل أن نطلب صورة أخرى.
  Future<void> _pickPhoto() async {
    final picker = ImagePicker();
    for (final (size, quality) in const [(512.0, 82), (384.0, 65), (256.0, 55)]) {
      final XFile? f;
      try {
        f = await picker.pickImage(source: ImageSource.gallery, maxWidth: size, maxHeight: size, imageQuality: quality);
      } on PlatformException {
        if (mounted) setState(() => _error = 'لا صلاحية للوصول للصور — اسمح بها من إعدادات الجهاز.');
        return;
      }
      if (f == null) return;
      final bytes = await f.readAsBytes();
      if (bytes.length <= 150 * 1024) {
        if (mounted) {
          setState(() {
            _pendingPhoto = bytes;
            _removePhoto = false;
          });
        }
        return;
      }
    }
    if (mounted) setState(() => _error = 'الصورة كبيرة جداً — اختر صورة أصغر.');
  }

  Future<void> _pickTime(String day, int index, {required bool start}) async {
    final r = _hours[day]![index];
    final current = start ? r.start : r.end;
    final t = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: (current ~/ 60) % 24, minute: current % 60),
      builder: (ctx, child) => MediaQuery(
        data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (t == null) return;
    final m = t.hour * 60 + t.minute;
    setState(() {
      _hours[day]![index] = start ? (start: m, end: r.end) : (start: r.start, end: m == 0 ? 24 * 60 : m);
    });
  }

  String? _validateHours() {
    for (final d in _weekOrder) {
      final rs = [..._hours[d]!]..sort((a, b) => a.start.compareTo(b.start));
      for (var i = 0; i < rs.length; i++) {
        if (rs[i].end <= rs[i].start) return 'دوام ${_dayNames[d]}: النهاية قبل البداية.';
        if (i > 0 && rs[i - 1].end > rs[i].start) return 'دوام ${_dayNames[d]}: فترتان متداخلتان.';
      }
    }
    return null;
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'الاسم مطلوب.');
      return;
    }
    final hoursError = _validateHours();
    if (hoursError != null) {
      setState(() => _error = hoursError);
      return;
    }
    final commissionText = arToAsciiDigits(_commission.text.trim()).replaceAll('٫', '.');
    final member = StaffMember(
      id: widget.member?.id ?? '',
      name: name,
      phone: _phone.text.trim().isEmpty ? null : arToAsciiDigits(_phone.text.trim()),
      workingHours: _hours,
      serviceIds: _services.toList(),
      active: _active,
      sortOrder: widget.member?.sortOrder ?? 0,
      commissionPercent: commissionText.isEmpty ? null : double.tryParse(commissionText),
    );
    setState(() {
      _saving = true;
      _error = null;
    });
    final api = ref.read(apiProvider);
    try {
      final saved = await api.saveStaff(member, id: widget.member?.id);
      if (_pendingPhoto != null) {
        await api.uploadStaffPhoto(saved.id, _pendingPhoto!);
      } else if (_removePhoto && widget.member != null) {
        await api.deleteStaffPhoto(saved.id);
      }
      // الصورة مخبّأة بلا حدّ في الذاكرة؛ بلا إبطال تبقى القديمة ظاهرة
      ref.invalidate(staffPhotoProvider(saved.id));
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
    final services = ref.watch(manageServicesProvider);
    final m = widget.member;

    Widget photo() {
      const size = 72.0;
      final Widget avatar;
      if (_pendingPhoto != null) {
        avatar = ClipOval(child: Image.memory(_pendingPhoto!, width: size, height: size, fit: BoxFit.cover));
      } else if (m != null && !_removePhoto) {
        avatar = StaffAvatar(staff: m, size: size);
      } else {
        avatar = InitialsAvatar(seed: m?.id ?? 'new', label: _name.text.isEmpty ? '؟' : _name.text, size: size);
      }
      final hasPhoto = _pendingPhoto != null || (m != null && m.hasPhoto && !_removePhoto);
      return Row(
        children: [
          avatar,
          const SizedBox(width: 16),
          Expanded(
            child: Wrap(
              spacing: 8,
              children: [
                OutlinedButton.icon(
                  key: const Key('staff.photo'),
                  onPressed: _pickPhoto,
                  icon: const Icon(Icons.photo_library_outlined, size: 18),
                  label: Text(hasPhoto ? 'تغيير الصورة' : 'إضافة صورة'),
                ),
                if (hasPhoto)
                  TextButton(
                    onPressed: () => setState(() {
                      _pendingPhoto = null;
                      _removePhoto = true;
                    }),
                    child: Text('إزالة', style: TextStyle(color: hc.danger)),
                  ),
              ],
            ),
          ),
        ],
      );
    }

    Widget dayRow(String d) {
      final ranges = _hours[d]!;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 74,
              child: Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(_dayNames[d]!, style: const TextStyle(fontFamily: kFont, fontWeight: FontWeight.w600)),
              ),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (ranges.isEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text('عطلة', style: TextStyle(fontFamily: kFont, color: hc.text3)),
                    ),
                  for (var i = 0; i < ranges.length; i++)
                    Row(
                      children: [
                        _TimeChip(label: StaffMember.clock(ranges[i].start), onTap: () => _pickTime(d, i, start: true)),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                          child: Text('–', style: TextStyle(color: hc.text3)),
                        ),
                        _TimeChip(label: StaffMember.clock(ranges[i].end), onTap: () => _pickTime(d, i, start: false)),
                        IconButton(
                          tooltip: 'حذف الفترة',
                          icon: Icon(Icons.close_rounded, size: 18, color: hc.text3),
                          onPressed: () => setState(() => ranges.removeAt(i)),
                        ),
                      ],
                    ),
                ],
              ),
            ),
            IconButton(
              key: Key('staff.addRange.$d'),
              tooltip: 'إضافة فترة',
              icon: Icon(Icons.add_circle_outline_rounded, color: hc.live),
              onPressed: () => setState(() {
                // فترة جديدة بعد آخر فترة، أو دوام صباحي إن كان اليوم عطلة
                final last = ranges.isEmpty ? null : ranges.last.end;
                final start = last ?? 10 * 60;
                ranges.add((start: start, end: (start + 4 * 60).clamp(start + 30, 24 * 60)));
              }),
            ),
          ],
        ),
      );
    }

    return Scaffold(
      backgroundColor: hc.bg,
      appBar: AppBar(title: Text(m == null ? 'عضو جديد' : 'تعديل ${m.name}')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, 12, 16, 32 + MediaQuery.paddingOf(context).bottom),
        children: [
          photo(),
          const SizedBox(height: 16),
          TextField(
            key: const Key('staff.name'),
            controller: _name,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(labelText: 'الاسم *'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  textDirection: TextDirection.ltr,
                  decoration: const InputDecoration(labelText: 'الهاتف'),
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 120,
                child: TextField(
                  controller: _commission,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(labelText: 'العمولة', suffixText: '٪'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          const SectionLabel('الخدمات التي يقدّمها'),
          services.when(
            loading: () => const Padding(padding: EdgeInsets.all(12), child: LinearProgressIndicator()),
            error: (_, _) => const Text('تعذّر تحميل الخدمات'),
            data: (list) => list.isEmpty
                ? Text('أضف الخدمات أولاً من شاشة «الخدمات».', style: TextStyle(fontFamily: kFont, color: hc.text3))
                : Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      for (final s in list.where((s) => s.active || _services.contains(s.id)))
                        FilterChip(
                          key: Key('staff.service.${s.id}'),
                          label: Text(s.name),
                          selected: _services.contains(s.id),
                          onSelected: (on) => setState(() => on ? _services.add(s.id) : _services.remove(s.id)),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: 20),
          const SectionLabel('الدوام'),
          for (final d in _weekOrder) dayRow(d),
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('متاح للحجز'),
            subtitle: const Text('الإيقاف يخفيه من الجدول والحجز ويُبقي سجلّه'),
            value: _active,
            onChanged: (v) => setState(() => _active = v),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(fontFamily: kFont, color: hc.danger)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('staff.save'),
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'جارٍ الحفظ…' : 'حفظ'),
          ),
        ],
      ),
    );
  }
}

class _TimeChip extends StatelessWidget {
  const _TimeChip({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Material(
      color: hc.surface2,
      borderRadius: BorderRadius.circular(R.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(R.md),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Text(
            arDigits(label),
            style: const TextStyle(fontFamily: kFont, fontFeatures: [FontFeature.tabularFigures()]),
          ),
        ),
      ),
    );
  }
}
