import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../data/appointments.dart';
import '../../data/schedule.dart';
import '../../ui/theme.dart';
import 'appointments_controller.dart';
import 'appt_style.dart';
import 'staff_avatar.dart';
import 'timeline_layout.dart';

/// خط اليوم: عمود لكل مقدّم خدمة، الوقت عمودياً.
///
/// عمود الساعات ثابت على **بداية** السطر (يمين في RTL) والأعمدة تمرّ أفقياً
/// خلفه؛ رؤوس الأعمدة (الصورة والاسم) ثابتة أعلى ومتزامنة مع التمرير الأفقي،
/// كي لا يضيع المالك «عمود من هذا؟» بعد التمرير لأسفل اليوم.
class DayTimeline extends StatefulWidget {
  const DayTimeline({
    super.key,
    required this.state,
    required this.now,
    required this.onTapAppointment,
    required this.onTapFree,
    this.bottomInset = 0,
  });

  final DayState state;
  final DateTime now;
  final ValueChanged<Appointment> onTapAppointment;
  final void Function(StaffMember staff, DateTime start) onTapFree;
  final double bottomInset;

  static const pxPerMinute = 1.6;
  static const gutterWidth = 58.0;
  static const headerHeight = 78.0;
  static const minColumnWidth = 148.0;

  @override
  State<DayTimeline> createState() => _DayTimelineState();
}

class _DayTimelineState extends State<DayTimeline> {
  final _vertical = ScrollController();
  final _bodyH = ScrollController();
  final _headerH = ScrollController();
  DateTime? _scrolledFor;

  @override
  void initState() {
    super.initState();
    _bodyH.addListener(() {
      if (_headerH.hasClients && _headerH.offset != _bodyH.offset) _headerH.jumpTo(_bodyH.offset);
    });
  }

  @override
  void dispose() {
    _vertical.dispose();
    _bodyH.dispose();
    _headerH.dispose();
    super.dispose();
  }

  /// أول عرض لليوم: نمرّر إلى «الآن» (أو أول موعد) — المالك يفتح التطبيق
  /// ليرى ما يحدث الآن لا الساعة التاسعة صباحاً.
  void _autoScroll(DayWindow window) {
    if (_scrolledFor == widget.state.date || widget.state.loading) return;
    _scrolledFor = widget.state.date;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_vertical.hasClients) return;
      final items = widget.state.items.where((a) => !a.status.releasesTime).toList();
      DateTime? focus;
      if (window.contains(widget.now)) {
        focus = widget.now;
      } else if (items.isNotEmpty) {
        focus = items.map((a) => a.startAt).reduce((a, b) => a.isBefore(b) ? a : b);
      }
      if (focus == null) return;
      final target = window.offsetMinutes(focus) * DayTimeline.pxPerMinute - 90;
      _vertical.jumpTo(target.clamp(0, _vertical.position.maxScrollExtent));
    });
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final s = widget.state;
    final now = widget.now;
    final spans = [for (final a in s.items) displaySpan(a, now)];
    final window = DayWindow.forDay(day: s.date, staff: s.staff, spans: spans);
    final height = window.minutes * DayTimeline.pxPerMinute;
    final isToday = dayOf(now) == s.date;
    _autoScroll(window);

    return LayoutBuilder(builder: (context, box) {
      final available = box.maxWidth - DayTimeline.gutterWidth;
      final count = s.staff.isEmpty ? 1 : s.staff.length;
      final colW = (available / count).clamp(DayTimeline.minColumnWidth, 420.0);
      final contentW = colW * count;

      return Column(
        children: [
          // رؤوس الأعمدة
          SizedBox(
            height: DayTimeline.headerHeight,
            child: Row(
              children: [
                const SizedBox(width: DayTimeline.gutterWidth),
                Expanded(
                  child: SingleChildScrollView(
                    controller: _headerH,
                    scrollDirection: Axis.horizontal,
                    physics: const NeverScrollableScrollPhysics(),
                    child: Row(
                      children: [
                        for (final st in s.staff)
                          SizedBox(
                            width: colW,
                            child: _StaffHeader(
                              staff: st,
                              count: s.items.where((a) => a.staffId == st.id && !a.status.releasesTime).length,
                              busyNow: isToday &&
                                  s.items.any((a) => a.staffId == st.id && a.status == AppointmentStatus.inProgress),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          Divider(height: 1, color: hc.border),
          Expanded(
            child: SingleChildScrollView(
              controller: _vertical,
              padding: EdgeInsets.only(bottom: widget.bottomInset + 24),
              child: SizedBox(
                height: height + 16,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: DayTimeline.gutterWidth,
                      height: height + 16,
                      child: _HourGutter(window: window, now: isToday ? now : null),
                    ),
                    Expanded(
                      child: SingleChildScrollView(
                        controller: _bodyH,
                        scrollDirection: Axis.horizontal,
                        child: SizedBox(
                          width: contentW,
                          height: height + 16,
                          child: Stack(
                            clipBehavior: Clip.none,
                            children: [
                              Positioned.fill(
                                top: 8,
                                child: CustomPaint(
                                  painter: _GridPainter(
                                    window: window,
                                    columns: count,
                                    columnWidth: colW,
                                    rtl: Directionality.of(context) == TextDirection.rtl,
                                    line: hc.border,
                                    halfLine: hc.border.withValues(alpha: 0.45),
                                  ),
                                ),
                              ),
                              for (var i = 0; i < s.staff.length; i++)
                                PositionedDirectional(
                                  start: i * colW,
                                  top: 8,
                                  width: colW,
                                  height: height,
                                  child: _StaffColumn(
                                    staff: s.staff[i],
                                    state: s,
                                    window: window,
                                    now: now,
                                    onTapAppointment: widget.onTapAppointment,
                                    onTapFree: widget.onTapFree,
                                  ),
                                ),
                              if (isToday && window.contains(now))
                                PositionedDirectional(
                                  start: 0,
                                  end: 0,
                                  top: 8 + window.offsetMinutes(now) * DayTimeline.pxPerMinute - 1,
                                  child: IgnorePointer(child: Container(height: 2, color: hc.handoff)),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      );
    });
  }
}

class _StaffHeader extends StatelessWidget {
  const _StaffHeader({required this.staff, required this.count, required this.busyNow});

  final StaffMember staff;
  final int count;
  final bool busyNow;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      child: Row(
        children: [
          StaffAvatar(staff: staff, size: 38, ring: busyNow ? hc.warn : null),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  staff.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontFamily: kFont, fontSize: 14, fontWeight: FontWeight.w700, color: hc.text, height: 1.3),
                ),
                Text(
                  count == 0 ? 'لا مواعيد' : arCount(count, one: 'موعد', two: 'موعدان', few: 'مواعيد'),
                  style: TextStyle(fontFamily: kFont, fontSize: 11.5, color: busyNow ? hc.warn : hc.text3, height: 1.3),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HourGutter extends StatelessWidget {
  const _HourGutter({required this.window, required this.now});

  final DayWindow window;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final hours = window.minutes ~/ 60;
    return Stack(
      clipBehavior: Clip.none,
      children: [
        for (var h = 0; h <= hours; h++)
          PositionedDirectional(
            top: 8 + h * 60 * DayTimeline.pxPerMinute - 8,
            start: 0,
            end: 6,
            child: Text(
              _hourLabel(window.start.add(Duration(hours: h))),
              textAlign: TextAlign.center,
              style: TextStyle(fontFamily: kFont, fontSize: 11, color: hc.text3, height: 1.3),
            ),
          ),
        if (now != null && window.contains(now!))
          PositionedDirectional(
            top: 8 + window.offsetMinutes(now!) * DayTimeline.pxPerMinute - 10,
            start: 4,
            end: 4,
            child: Container(
              key: const Key('timeline.now'),
              height: 20,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: hc.handoff, borderRadius: BorderRadius.circular(10)),
              child: const Text(
                'الآن',
                style: TextStyle(fontFamily: kFont, fontSize: 11, fontWeight: FontWeight.w700, color: Colors.white, height: 1.2),
              ),
            ),
          ),
      ],
    );
  }

  static String _hourLabel(DateTime t) {
    final h12 = t.hour % 12 == 0 ? 12 : t.hour % 12;
    return '${arDigits(h12)} ${t.hour < 12 ? 'ص' : 'م'}';
  }
}

class _GridPainter extends CustomPainter {
  _GridPainter({
    required this.window,
    required this.columns,
    required this.columnWidth,
    required this.rtl,
    required this.line,
    required this.halfLine,
  });

  final DayWindow window;
  final int columns;
  final double columnWidth;
  final bool rtl;
  final Color line;
  final Color halfLine;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()..strokeWidth = 1;
    final hours = window.minutes ~/ 60;
    for (var h = 0; h <= hours; h++) {
      final y = h * 60 * DayTimeline.pxPerMinute;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), p..color = line);
      if (h < hours) {
        final half = y + 30 * DayTimeline.pxPerMinute;
        for (var x = 0.0; x < size.width; x += 8) {
          canvas.drawLine(Offset(x, half), Offset(x + 3, half), p..color = halfLine);
        }
      }
    }
    for (var c = 1; c < columns; c++) {
      final x = rtl ? size.width - c * columnWidth : c * columnWidth;
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), p..color = line);
    }
  }

  @override
  bool shouldRepaint(_GridPainter o) =>
      o.window.start != window.start || o.window.end != window.end || o.columns != columns || o.columnWidth != columnWidth || o.line != line || o.rtl != rtl;
}

class _StaffColumn extends StatelessWidget {
  const _StaffColumn({
    required this.staff,
    required this.state,
    required this.window,
    required this.now,
    required this.onTapAppointment,
    required this.onTapFree,
  });

  final StaffMember staff;
  final DayState state;
  final DayWindow window;
  final DateTime now;
  final ValueChanged<Appointment> onTapAppointment;
  final void Function(StaffMember, DateTime) onTapFree;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final items = state.items.where((a) => a.staffId == staff.id).toList();
    final hours = staff.hoursOn(state.date);
    final midnight = state.date;
    const ppm = DayTimeline.pxPerMinute;
    final blocks = layoutColumn(items: items, window: window, now: now, pxPerMinute: ppm, serviceOf: state.serviceOf);
    final gaps = freeGaps(day: state.date, hours: hours, items: items, now: now, serviceOf: state.serviceOf, minMinutes: 30);

    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth;
      return Stack(
        clipBehavior: Clip.hardEdge,
        children: [
          // خارج الدوام باهت: الوقت الحرّ داخل الدوام فقط هو ما يُحجز.
          Positioned.fill(child: ColoredBox(color: hc.bg.withValues(alpha: 0.55))),
          for (final r in hours)
            if (_rangeSpan(midnight, r) case final sp? when _clip(sp) != null)
              PositionedDirectional(
                start: 0,
                end: 0,
                top: window.offsetMinutes(_clip(sp)!.start) * ppm,
                height: _clip(sp)!.minutes * ppm,
                child: ColoredBox(color: hc.surface.withValues(alpha: 0.55)),
              ),
          for (final g in gaps)
            if (_clip(g) case final cg?)
              PositionedDirectional(
                start: 4,
                end: 4,
                top: window.offsetMinutes(cg.start) * ppm + 2,
                height: cg.minutes * ppm - 4,
                child: _FreeSlot(onTap: () => onTapFree(staff, cg.start.toLocal())),
              ),
          for (final b in blocks)
            PositionedDirectional(
              key: ValueKey('block.${b.appointment.id}'),
              start: b.startFraction * w + 3,
              width: b.widthFraction * w - 6,
              top: b.top + 1,
              height: b.height - 2,
              child: AppointmentBlock(
                layout: b,
                state: state,
                now: now,
                onTap: () => onTapAppointment(b.appointment),
              ),
            ),
        ],
      );
    });
  }

  TimeSpan? _rangeSpan(DateTime midnight, DayRange r) =>
      TimeSpan(midnight.add(Duration(minutes: r.start)), midnight.add(Duration(minutes: r.end)));

  TimeSpan? _clip(TimeSpan s) {
    final a = s.start.isBefore(window.start) ? window.start : s.start;
    final b = s.end.isAfter(window.end) ? window.end : s.end;
    return a.isBefore(b) ? TimeSpan(a, b) : null;
  }
}

class _FreeSlot extends StatelessWidget {
  const _FreeSlot({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    return Semantics(
      button: true,
      label: 'وقت متاح — احجز',
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: CustomPaint(
          painter: _DashedBorderPainter(color: hc.live.withValues(alpha: 0.28)),
          child: Align(
            alignment: AlignmentDirectional.topStart,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.add_rounded, size: 14, color: hc.live.withValues(alpha: 0.7)),
                  const SizedBox(width: 3),
                  Text(
                    'متاح',
                    style: TextStyle(fontFamily: kFont, fontSize: 11, fontWeight: FontWeight.w600, color: hc.live.withValues(alpha: 0.7), height: 1.2),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DashedBorderPainter extends CustomPainter {
  _DashedBorderPainter({required this.color});
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final rrect = RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(10));
    final path = Path()..addRRect(rrect);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    for (final m in path.computeMetrics()) {
      for (var d = 0.0; d < m.length; d += 9) {
        canvas.drawPath(m.extractPath(d, d + 5), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBorderPainter o) => o.color != color;
}

/// كتلة موعد: لون الحالة، اسم العميل، الخدمة، الوقت — يتقلّص المحتوى مع
/// الارتفاع بدل أن يُقصّ في منتصف سطر.
class AppointmentBlock extends StatelessWidget {
  const AppointmentBlock({super.key, required this.layout, required this.state, required this.now, required this.onTap});

  final BlockLayout layout;
  final DayState state;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final a = layout.appointment;
    final color = statusColor(hc, a.status);
    final faded = layout.faded;
    final service = state.serviceOf(a);
    final span = displaySpan(a, now);
    final pending = state.pending.contains(a.id);
    final nested = layout.nestedIn != null;

    final body = LayoutBuilder(builder: (context, box) {
      final h = box.maxHeight;
      // تمرير معطّل بدل Column عارٍ: كتلة قصيرة (موعد ١٠ د) تقصّ السطر الأخير
      // بهدوء بدل شريط «overflow» أصفر مع خط عريض أو تكبير نص النظام.
      return SingleChildScrollView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsetsDirectional.fromSTEB(8, 4, 6, 4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                if (a.status == AppointmentStatus.inProgress) ...[
                  Container(width: 6, height: 6, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                  const SizedBox(width: 4),
                ],
                Expanded(
                  child: Text(
                    customerLabel(a.customer),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: kFont,
                      fontSize: 12.5,
                      fontWeight: FontWeight.w700,
                      color: faded ? hc.text3 : hc.text,
                      decoration: a.status == AppointmentStatus.cancelled ? TextDecoration.lineThrough : null,
                      height: 1.25,
                    ),
                  ),
                ),
                if (a.status == AppointmentStatus.done) Icon(Icons.check_rounded, size: 13, color: hc.text3),
                if (pending)
                  SizedBox.square(dimension: 11, child: CircularProgressIndicator(strokeWidth: 1.6, color: color)),
              ],
            ),
            if (h > 40)
              Text(
                service?.name ?? '',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontFamily: kFont, fontSize: 11.5, color: hc.text2, height: 1.3),
              ),
            if (h > 58)
              Text(
                a.status.isFinal && a.status != AppointmentStatus.done ? a.status.label : timeRange(span.start, span.end),
                maxLines: 1,
                style: TextStyle(fontFamily: kFont, fontSize: 10.5, color: faded ? hc.text3 : color, height: 1.3),
              ),
          ],
        ),
      );
    });

    return Semantics(
      button: true,
      label: '${customerLabel(a.customer)}، ${service?.name ?? ''}، ${a.status.label}',
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        child: Opacity(
          opacity: faded ? 0.5 : 1,
          child: Container(
            decoration: BoxDecoration(
              color: Color.alphaBlend(color.withValues(alpha: faded ? 0.06 : 0.17), hc.surface),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: color.withValues(alpha: nested ? 0.8 : 0.32), width: nested ? 1.2 : 0.8),
              boxShadow: nested
                  ? [BoxShadow(color: Colors.black.withValues(alpha: 0.35), blurRadius: 8, offset: const Offset(0, 2))]
                  : null,
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              children: [
                if (layout.processingTop != null && layout.processingHeight != null)
                  PositionedDirectional(
                    key: const Key('block.processing'),
                    start: 0,
                    end: 0,
                    top: layout.processingTop,
                    height: layout.processingHeight,
                    child: CustomPaint(
                      painter: _StripesPainter(color: color.withValues(alpha: 0.22)),
                      child: Align(
                        alignment: AlignmentDirectional.bottomEnd,
                        child: layout.processingHeight! > 22
                            ? Padding(
                                padding: const EdgeInsets.all(4),
                                child: Text(
                                  'انتظار',
                                  style: TextStyle(fontFamily: kFont, fontSize: 10, fontWeight: FontWeight.w600, color: color, height: 1.1),
                                ),
                              )
                            : const SizedBox.shrink(),
                      ),
                    ),
                  ),
                // شريط الحالة على بداية الكتلة
                PositionedDirectional(start: 0, top: 0, bottom: 0, width: 3, child: ColoredBox(color: color)),
                Positioned.fill(child: body),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// خطوط مائلة لوقت الانتظار: «مشغول بخدمة لكن مقدّمها حرّ».
class _StripesPainter extends CustomPainter {
  _StripesPainter({required this.color});
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.clipRect(Offset.zero & size);
    final p = Paint()
      ..color = color
      ..strokeWidth = 4;
    for (var x = -size.height; x < size.width; x += 10) {
      canvas.drawLine(Offset(x, size.height), Offset(x + size.height, 0), p);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_StripesPainter o) => o.color != color;
}
