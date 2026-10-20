import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/format.dart';
import '../../ui/theme.dart';
import 'appointments_controller.dart';

/// شريط الأيام: أسبوع للخلف وستة أسابيع للأمام، اليوم مُعلَّم دائماً.
///
/// يُمرَّر بالإصبع، والمختار يبقى في الوسط تقريباً — الأيام المجاورة هي ما
/// يُسأل عنه غالباً («بكرا عندك وقت؟»).
class DateStrip extends StatefulWidget {
  const DateStrip({super.key, required this.selected, required this.today, required this.onSelect, this.daysBack = 7, this.daysForward = 42});

  final DateTime selected;
  final DateTime today;
  final ValueChanged<DateTime> onSelect;
  final int daysBack;
  final int daysForward;

  static const itemWidth = 52.0;

  @override
  State<DateStrip> createState() => _DateStripState();
}

class _DateStripState extends State<DateStrip> {
  late final ScrollController _c;

  int _indexOf(DateTime d) => dayOf(d).difference(dayOf(widget.today).subtract(Duration(days: widget.daysBack))).inHours ~/ 24;

  @override
  void initState() {
    super.initState();
    _c = ScrollController(initialScrollOffset: ((_indexOf(widget.selected) - 2) * (DateStrip.itemWidth + 6)).clamp(0, double.infinity));
  }

  @override
  void didUpdateWidget(DateStrip old) {
    super.didUpdateWidget(old);
    if (old.selected != widget.selected && _c.hasClients) {
      final target = ((_indexOf(widget.selected) - 2) * (DateStrip.itemWidth + 6)).clamp(0.0, _c.position.maxScrollExtent);
      _c.animateTo(target, duration: const Duration(milliseconds: 280), curve: Curves.easeOutCubic);
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final start = dayOf(widget.today).subtract(Duration(days: widget.daysBack));
    final count = widget.daysBack + widget.daysForward + 1;
    return SizedBox(
      height: 66,
      child: ListView.separated(
        controller: _c,
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: count,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (context, i) {
          final d = DateTime(start.year, start.month, start.day + i);
          final selected = d == dayOf(widget.selected);
          final isToday = d == dayOf(widget.today);
          final fg = selected ? hc.onLive : (isToday ? hc.live : hc.text);
          return Semantics(
            button: true,
            selected: selected,
            label: '${arWeekday(d)} ${d.day}',
            excludeSemantics: true,
            child: GestureDetector(
              key: Key('day.${d.month}-${d.day}'),
              onTap: () {
                HapticFeedback.selectionClick();
                widget.onSelect(d);
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                curve: Curves.easeOutCubic,
                width: DateStrip.itemWidth,
                decoration: BoxDecoration(
                  color: selected ? hc.live : hc.surface,
                  borderRadius: BorderRadius.circular(R.md),
                  border: Border.all(color: selected ? hc.live : (isToday ? hc.live.withValues(alpha: 0.5) : hc.border)),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      _short(d),
                      style: TextStyle(fontFamily: kFont, fontSize: 11, color: selected ? hc.onLive : hc.text3, height: 1.2),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      arDigits(d.day),
                      style: TextStyle(fontFamily: kFont, fontSize: 18, fontWeight: FontWeight.w700, color: fg, height: 1.2),
                    ),
                    if (isToday)
                      Container(
                        margin: const EdgeInsets.only(top: 2),
                        width: 4,
                        height: 4,
                        decoration: BoxDecoration(color: selected ? hc.onLive : hc.live, shape: BoxShape.circle),
                      ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  /// «الثلاثاء» ⇒ «ثلاثاء»: الاسم الكامل لا يتّسع في خانة ٥٢ بكسل.
  static String _short(DateTime d) {
    final w = arWeekday(d);
    return w.startsWith('ال') ? w.substring(2) : w;
  }
}
