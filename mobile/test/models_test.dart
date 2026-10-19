import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:hader/data/local/session_store.dart';
import 'package:hader/data/models.dart';
import 'package:hader/data/outbox/outbox_entry.dart';
import 'package:hader/features/conversations/rail_badge.dart';

Map<String, dynamic> j(String s) => jsonDecode(s) as Map<String, dynamic>;

void main() {
  group('ConversationItem', () {
    const full = '''{
      "id": "c1", "channel": "WHATSAPP", "customerName": "أحمد", "externalUserId": "962770466649",
      "displayId": "+962770466649", "status": "HUMAN", "handoffReason": "طلب موظف",
      "lastMessage": {"text": "مرحبا", "role": "USER", "at": "2026-10-16T10:00:00Z"},
      "unreadCount": 2, "window": {"open": true, "closesAt": "2026-10-17T10:00:00Z"}
    }''';

    test('كامل', () {
      final c = ConversationItem.fromJson(j(full))!;
      expect(c.channel, Channel.whatsapp);
      expect(c.status, ConversationStatus.human);
      expect(c.isHuman, isTrue);
      expect(c.lastMessage!.role, Role.user);
      expect(c.unreadCount, 2);
      expect(c.window.open, isTrue);
      expect(c.window.closesAt, DateTime.utc(2026, 10, 17, 10));
    });

    test('ذهاب وإياب عبر toJson (شكل الذاكرة المحلية = شكل السلك)', () {
      final c = ConversationItem.fromJson(j(full))!;
      final back = ConversationItem.fromJson(jsonDecode(jsonEncode(c.toJson())) as Map<String, dynamic>)!;
      expect(back.toJson(), c.toJson());
    });

    test('حقول ناقصة أو بأنواع خاطئة لا تنهار', () {
      final c = ConversationItem.fromJson(j('{"id": "c2", "unreadCount": "3", "window": null, "lastMessage": {"text": 5}}'))!;
      expect(c.channel, Channel.unknown);
      expect(c.status, ConversationStatus.unknown);
      expect(c.customerName, isNull);
      expect(c.displayId, '');
      expect(c.unreadCount, 3);
      expect(c.window.open, isFalse);
      expect(c.lastMessage, isNull, reason: 'رسالة بلا تاريخ لا تُعرض كآخر رسالة');
    });

    test('اسم فارغ = null، وdisplayId يرجع لـexternalUserId', () {
      final c = ConversationItem.fromJson(j('{"id": "c3", "customerName": "  ", "externalUserId": "123"}'))!;
      expect(c.customerName, isNull);
      expect(c.displayId, '123');
    });

    test('بلا id ⇒ null', () {
      expect(ConversationItem.fromJson(j('{"channel": "WHATSAPP"}')), isNull);
      expect(ConversationItem.fromJson(const {}), isNull);
    });

    test('عدد سالب يُقصّ إلى صفر', () {
      expect(ConversationItem.fromJson(j('{"id": "x", "unreadCount": -4}'))!.unreadCount, 0);
    });
  });

  group('الصفحات', () {
    test('ConversationPage تتجاوز العنصر الفاسد وحده', () {
      final p = ConversationPage.fromJson(j('''{
        "pinned": [{"id": "a", "status": "HUMAN"}, 7, {"noid": 1}],
        "items": [{"id": "b"}], "nextCursor": "abc"
      }'''));
      expect(p.pinned.map((c) => c.id), ['a']);
      expect(p.items.map((c) => c.id), ['b']);
      expect(p.nextCursor, 'abc');
    });

    test('ConversationPage فارغة تماماً', () {
      final p = ConversationPage.fromJson(const {});
      expect(p.pinned, isEmpty);
      expect(p.items, isEmpty);
      expect(p.nextCursor, isNull);
    });

    test('MessagePage', () {
      final p = MessagePage.fromJson(j('''{"items": [
        {"id": "m1", "role": "AGENT", "text": "أهلاً", "at": "2026-10-16T10:00:00Z", "clientId": null},
        {"id": "m2", "role": "HUMAN", "text": "تم", "at": "2026-10-16T10:01:00Z", "clientId": "u-1"},
        {"role": "USER"}
      ], "hasMore": true}'''));
      expect(p.items.length, 2);
      expect(p.items[0].clientId, isNull);
      expect(p.items[1].clientId, 'u-1');
      expect(p.items[1].role.isOutgoing, isTrue);
      expect(p.hasMore, isTrue);
    });

    test('Message بلا تاريخ تبقى (لا نُسقط رسالة حقيقية)', () {
      final m = Message.fromJson(j('{"id": "m", "text": "x"}'))!;
      expect(m.role, Role.unknown);
      expect(m.at, isNotNull);
    });

    test('SendResult ناقص', () {
      final r = SendResult.fromJson(j('{"message": {"id": "m"}}'));
      expect(r.message!.id, 'm');
      expect(r.conversation, isNull);
    });

    test('LeadPage', () {
      final p = LeadPage.fromJson(j('{"items": [{"id": "l", "channel": "INSTAGRAM"}], "nextCursor": null}'));
      expect(p.items.single.channel, Channel.instagram);
      expect(p.items.single.name, isNull);
      expect(p.nextCursor, isNull);
    });
  });

  group('القوالب', () {
    test('عدد المتغيّرات من الحقل أو من النص', () {
      expect(MessageTemplate.fromJson(j('{"name": "a", "body": "{{1}} و {{2}}", "variables": 2}'))!.variables, 2);
      expect(MessageTemplate.fromJson(j('{"name": "b", "body": "مرحبا {{1}} طلب {{ 3 }}"}'))!.variables, 3);
      expect(MessageTemplate.fromJson(j('{"body": "x"}')), isNull);
    });

    test('render يملأ ويترك الناقص ظاهراً', () {
      final t = MessageTemplate.fromJson(j('{"name": "a", "body": "مرحبا {{1}}، طلبك {{2}}"}'))!;
      expect(t.render(['أحمد', '٥٥']), 'مرحبا أحمد، طلبك ٥٥');
      expect(t.render(['أحمد', ' ']), 'مرحبا أحمد، طلبك {{2}}');
      expect(t.language, 'ar');
    });

    test('TemplateSelection يقصّ المتغيّرات في الجسم', () {
      final t = MessageTemplate.fromJson(j('{"name": "a", "language": "ar", "body": "{{1}}"}'))!;
      expect(TemplateSelection(template: t, variables: [' س ']).toJson(), {
        'name': 'a',
        'language': 'ar',
        'variables': ['س'],
      });
    });
  });

  group('الحساب والأجهزة والملخّص', () {
    test('LoginResult', () {
      final r = LoginResult.fromJson(j('''{"token": "t", "expiresAt": "2026-11-15T00:00:00Z",
        "user": {"id": "u", "email": "a@b.c", "name": null},
        "tenant": {"id": "t1", "slug": "s", "name": "Shifra"}}'''));
      expect(r.token, 't');
      expect(r.user.displayName, 'a@b.c');
      expect(r.tenant.agentName, isNull);
    });

    test('MeInfo بلا device ولا قنوات', () {
      final me = MeInfo.fromJson(j('{"user": {}, "tenant": {}}'));
      expect(me.notify, NotifyMode.all);
      expect(me.deviceId, isNull);
      expect(me.channels, isEmpty);
      expect(me.isConnected(Channel.whatsapp), isFalse);
    });

    test('MeInfo كامل مع قناة مجهولة تُتجاهل', () {
      final me = MeInfo.fromJson(j('''{"user": {"id": "u"}, "tenant": {"id": "t"},
        "channels": [{"channel": "WHATSAPP", "connected": true}, {"channel": "VOICE", "connected": true}],
        "device": {"id": "d", "notify": "handoff"}}'''));
      expect(me.channels.length, 1);
      expect(me.isConnected(Channel.whatsapp), isTrue);
      expect(me.notify, NotifyMode.handoff);
    });

    test('DeviceInfo', () {
      final d = DeviceInfo.fromJson(j('{"id": "d", "platform": "ios", "current": true}'))!;
      expect(d.name, 'جهاز');
      expect(d.current, isTrue);
      expect(d.lastSeenAt, isNull);
      expect(DeviceInfo.fromJson(const {}), isNull);
    });

    test('InboxSummary مع قيم ناقصة', () {
      final s = InboxSummary.fromJson(j('''{"channels": [
        {"channel": "WHATSAPP", "unread": 3, "handoff": 1},
        {"channel": "INSTAGRAM"}, {"channel": "WEB", "unread": 9}
      ], "version": 1760622400000}'''));
      expect(s.version, '1760622400000');
      expect(s.of(Channel.whatsapp).handoff, 1);
      expect(s.of(Channel.instagram).unread, 0);
      expect(s.of(Channel.messenger).unread, 0, reason: 'قناة غائبة = أصفار');
      expect(s.channels.length, 2);
    });

    test('Session لا تطبع الرمز', () {
      final s = Session.fromJson(j('{"token": "SECRET", "user": {"id": "u"}, "tenant": {"slug": "x"}}'))!;
      expect(s.toString(), isNot(contains('SECRET')));
      expect(Session.fromJson(j('{"user": {}}')), isNull);
    });

    test('OutboxEntry ذهاباً وإياباً', () {
      final e = OutboxEntry(
        clientId: 'c',
        conversationId: 'v',
        kind: OutboxKind.template,
        text: 'نص',
        createdAt: DateTime.utc(2026),
        state: OutboxState.uncertain,
        templateName: 'tpl',
        variables: const ['أ'],
      );
      final back = OutboxEntry.fromJson(jsonDecode(jsonEncode(e.toJson())) as Map<String, dynamic>)!;
      expect(back.state, OutboxState.uncertain);
      expect(back.templateSelection!.template.name, 'tpl');
      expect(OutboxEntry.fromJson(const {}), isNull);
    });
  });

  group('أولوية شارة الشريط', () {
    ChannelSummary s(int unread, int handoff) =>
        ChannelSummary(channel: Channel.whatsapp, unread: unread, handoff: handoff);

    test('لا شيء', () => expect(RailBadge.of(s(0, 0)).kind, RailBadgeKind.none));

    test('غير مقروء فقط ⇒ رمادي بالعدد', () {
      expect(RailBadge.of(s(4, 0)), const RailBadge(RailBadgeKind.unread, 4));
    });

    test('تحويل فقط ⇒ أحمر بلا نقطة', () {
      expect(RailBadge.of(s(0, 2)), const RailBadge(RailBadgeKind.handoff, 2));
    });

    test('الاثنان ⇒ أحمر بعدد التحويلات + نقطة رمادية', () {
      final b = RailBadge.of(s(5, 1));
      expect(b.kind, RailBadgeKind.handoff);
      expect(b.count, 1);
      expect(b.unreadDot, isTrue);
      expect(b.semantics(Channel.whatsapp), contains('تنتظرك'));
    });
  });
}
