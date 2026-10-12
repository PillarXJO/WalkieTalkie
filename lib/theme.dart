import 'package:flutter/material.dart';

/// Design tokens. Everything visual comes from here.
///
/// Registered as a [ThemeExtension] so the active palette follows the app's
/// [ThemeMode] (light/dark). Read it from a widget with `Tk.of(context)`.
@immutable
class Tk extends ThemeExtension<Tk> {
  const Tk({
    required this.bg,
    required this.surface,
    required this.card,
    required this.blue,
    required this.green,
    required this.orange,
    required this.red,
    required this.text,
    required this.muted,
  });

  final Color bg;
  final Color surface;
  final Color card;
  final Color blue;
  final Color green;
  final Color orange;
  final Color red;
  final Color text;
  final Color muted;

  static const double r = 12.0;

  /// Dark palette (default).
  static const Tk dark = Tk(
    bg: Color(0xFF080808),
    surface: Color(0xFF121416),
    card: Color(0xFF1B1E21),
    blue: Color(0xFF3B8BFF),
    green: Color(0xFF22D55E),
    orange: Color(0xFFFF7A1A),
    red: Color(0xFFFF4D4D),
    text: Colors.white,
    muted: Color(0xFF9AA0A6),
  );

  /// Light palette.
  static const Tk light = Tk(
    bg: Color(0xFFF3F5F7),
    surface: Color(0xFFFFFFFF),
    card: Color(0xFFE7EAEE),
    blue: Color(0xFF1F6FEB),
    green: Color(0xFF14A44D),
    orange: Color(0xFFE8590C),
    red: Color(0xFFD32F2F),
    text: Color(0xFF14171A),
    muted: Color(0xFF5F6368),
  );

  /// The palette for the current [Theme]. Falls back to [dark].
  static Tk of(BuildContext context) => Theme.of(context).extension<Tk>() ?? dark;

  @override
  Tk copyWith({
    Color? bg,
    Color? surface,
    Color? card,
    Color? blue,
    Color? green,
    Color? orange,
    Color? red,
    Color? text,
    Color? muted,
  }) =>
      Tk(
        bg: bg ?? this.bg,
        surface: surface ?? this.surface,
        card: card ?? this.card,
        blue: blue ?? this.blue,
        green: green ?? this.green,
        orange: orange ?? this.orange,
        red: red ?? this.red,
        text: text ?? this.text,
        muted: muted ?? this.muted,
      );

  @override
  Tk lerp(ThemeExtension<Tk>? other, double t) {
    if (other is! Tk) return this;
    return Tk(
      bg: Color.lerp(bg, other.bg, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      card: Color.lerp(card, other.card, t)!,
      blue: Color.lerp(blue, other.blue, t)!,
      green: Color.lerp(green, other.green, t)!,
      orange: Color.lerp(orange, other.orange, t)!,
      red: Color.lerp(red, other.red, t)!,
      text: Color.lerp(text, other.text, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
    );
  }

  /// Convenience accessor for the palette in scope.
  static Tk of_(BuildContext context) => of(context);
}

ThemeData buildTheme(Brightness brightness) {
  final tk = brightness == Brightness.dark ? Tk.dark : Tk.light;
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: tk.bg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: tk.blue,
      brightness: brightness,
      surface: tk.surface,
    ),
    appBarTheme: AppBarTheme(backgroundColor: tk.surface, foregroundColor: tk.text),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: tk.blue,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, letterSpacing: .5),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(backgroundColor: tk.surface),
    extensions: [tk],
  );
}
