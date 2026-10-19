import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors.dart';
import '../../core/providers.dart';
import '../../data/api/fake_api.dart';
import '../../ui/theme.dart';
import '../../ui/widgets/glyphs.dart';
import 'session_controller.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _passwordFocus = FocusNode();
  bool _obscure = true;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final email = _email.text.trim();
    final password = _password.text;
    // تحقق محلي خفيف فقط — القرار للخادم، ورسالته العربية هي ما يُعرض.
    if (email.isEmpty || !email.contains('@')) {
      setState(() => _error = 'أدخل بريداً إلكترونياً صحيحاً.');
      return;
    }
    if (password.isEmpty) {
      setState(() => _error = 'أدخل كلمة السر.');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).login(email, password);
      unawaited(HapticFeedback.lightImpact());
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() => _error = e.message);
      unawaited(HapticFeedback.heavyImpact());
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = ApiError.defaultMessage(ApiErrorCode.unknown));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _fillDemo() {
    _email.text = FakeHaderApi.demoEmail;
    _password.text = FakeHaderApi.demoPassword;
    setState(() => _error = null);
  }

  @override
  Widget build(BuildContext context) {
    final hc = context.hc;
    final tt = Theme.of(context).textTheme;
    final fake = ref.watch(configProvider).useFakeApi;

    return Scaffold(
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: const AlignmentDirectional(-0.6, -1.1).resolve(Directionality.of(context)),
            radius: 1.2,
            colors: [hc.live.withValues(alpha: 0.07), hc.bg],
          ),
        ),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, box) => SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: ConstrainedBox(
                constraints: BoxConstraints(minHeight: box.maxHeight),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: AutofillGroup(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const SizedBox(height: 32),
                          Row(
                            children: [
                              const BrandMark(size: 52),
                              const SizedBox(width: 12),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'حاضر',
                                    style: tt.headlineSmall?.copyWith(height: 1.2),
                                  ),
                                  Text(
                                    'HADER',
                                    style: TextStyle(
                                      fontFamily: kFont,
                                      fontSize: 12,
                                      letterSpacing: 2.4,
                                      fontWeight: FontWeight.w700,
                                      color: hc.text3,
                                      height: 1.2,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          const SizedBox(height: 36),
                          Text('أهلاً بعودتك', style: tt.headlineMedium),
                          const SizedBox(height: 6),
                          Text(
                            'ادخل بحساب متجرك لتصلك محادثات عملائك على واتساب وإنستغرام وماسنجر.',
                            style: tt.bodyMedium?.copyWith(color: hc.text2),
                          ),
                          const SizedBox(height: 28),
                          TextField(
                            key: const Key('login.email'),
                            controller: _email,
                            enabled: !_busy,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            autofillHints: const [AutofillHints.email, AutofillHints.username],
                            autocorrect: false,
                            enableSuggestions: false,
                            decoration: const InputDecoration(
                              labelText: 'البريد الإلكتروني',
                              prefixIcon: Icon(Icons.alternate_email_rounded),
                            ),
                            onSubmitted: (_) => _passwordFocus.requestFocus(),
                          ),
                          const SizedBox(height: 14),
                          TextField(
                            key: const Key('login.password'),
                            controller: _password,
                            focusNode: _passwordFocus,
                            enabled: !_busy,
                            obscureText: _obscure,
                            autofillHints: const [AutofillHints.password],
                            textInputAction: TextInputAction.done,
                            autocorrect: false,
                            enableSuggestions: false,
                            decoration: InputDecoration(
                              labelText: 'كلمة السر',
                              prefixIcon: const Icon(Icons.lock_outline_rounded),
                              suffixIcon: IconButton(
                                tooltip: _obscure ? 'إظهار كلمة السر' : 'إخفاء كلمة السر',
                                icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                                onPressed: () => setState(() => _obscure = !_obscure),
                              ),
                            ),
                            onSubmitted: (_) => _submit(),
                          ),
                          AnimatedSize(
                            duration: const Duration(milliseconds: 220),
                            curve: Curves.easeOutCubic,
                            child: _error == null
                                ? const SizedBox(width: double.infinity)
                                : Padding(
                                    padding: const EdgeInsets.only(top: 14),
                                    child: Container(
                                      key: const Key('login.error'),
                                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                                      decoration: BoxDecoration(
                                        color: hc.dangerDim,
                                        borderRadius: BorderRadius.circular(R.md),
                                        border: Border.all(color: hc.danger.withValues(alpha: 0.35)),
                                      ),
                                      child: Row(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Padding(
                                            padding: const EdgeInsets.only(top: 2),
                                            child: Icon(Icons.error_outline_rounded, color: hc.danger, size: 18),
                                          ),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            child: Text(
                                              _error!,
                                              style: tt.bodyMedium?.copyWith(color: hc.danger, height: 1.45),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                          ),
                          const SizedBox(height: 22),
                          FilledButton(
                            key: const Key('login.submit'),
                            onPressed: _busy ? null : _submit,
                            child: _busy
                                ? SizedBox.square(
                                    dimension: 22,
                                    child: CircularProgressIndicator(strokeWidth: 2.4, color: hc.text2),
                                  )
                                : const Text('دخول'),
                          ),
                          const SizedBox(height: 18),
                          Text(
                            'نسيت كلمة السر؟ غيّرها من لوحة الويب — تغييرها يُخرج كل الأجهزة.',
                            textAlign: TextAlign.center,
                            style: tt.bodySmall?.copyWith(color: hc.text3),
                          ),
                          if (fake) ...[
                            const SizedBox(height: 24),
                            Center(
                              child: ActionChip(
                                key: const Key('login.demo'),
                                avatar: Icon(Icons.science_outlined, size: 18, color: hc.warn),
                                label: const Text('وضع تجريبي — املأ حساب العرض'),
                                labelStyle: tt.labelMedium?.copyWith(color: hc.warn),
                                backgroundColor: hc.warnDim,
                                side: BorderSide(color: hc.warn.withValues(alpha: 0.3)),
                                onPressed: _fillDemo,
                              ),
                            ),
                          ],
                          const SizedBox(height: 32),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
