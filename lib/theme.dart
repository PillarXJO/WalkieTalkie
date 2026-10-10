import 'package:flutter/material.dart';

/// Design tokens. Everything visual comes from here.
class Tk {
  static const bg = Color(0xFF080808);
  static const surface = Color(0xFF121416);
  static const card = Color(0xFF1B1E21);
  static const blue = Color(0xFF3B8BFF);
  static const green = Color(0xFF22D55E);
  static const orange = Color(0xFFFF7A1A);
  static const red = Color(0xFFFF4D4D);
  static const text = Colors.white;
  static const muted = Color(0xFF9AA0A6);
  static const r = 12.0;
}

ThemeData buildTheme() => ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: Tk.bg,
      colorScheme: const ColorScheme.dark(primary: Tk.blue, surface: Tk.surface),
      appBarTheme: const AppBarTheme(backgroundColor: Tk.surface),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: Tk.blue,
          minimumSize: const Size.fromHeight(52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
          textStyle: const TextStyle(fontWeight: FontWeight.w700, letterSpacing: .5),
        ),
      ),
      navigationBarTheme: const NavigationBarThemeData(backgroundColor: Tk.surface),
    );
