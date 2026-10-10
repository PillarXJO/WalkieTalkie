import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'mock_data.dart';
import 'theme.dart';

Color presenceColor(Presence p) => switch (p) {
      Presence.online => Tk.green,
      Presence.busy => Tk.red,
      Presence.away => Tk.orange,
      Presence.offline => Tk.muted,
    };

/// Avatar with a presence dot. Pass [icon] for channels/bots.
class StatusAvatar extends StatelessWidget {
  final String label;
  final IconData? icon;
  final Presence presence;
  final double size;
  const StatusAvatar(this.label, {super.key, this.icon, this.presence = Presence.online, this.size = 60});

  @override
  Widget build(BuildContext context) {
    final initials = label.trim().split(' ').take(2).map((w) => w.isEmpty ? '' : w[0]).join().toUpperCase();
    return Hero(
      tag: 'avatar-$label',
      child: Stack(children: [
        CircleAvatar(
          radius: size / 2,
          backgroundColor: Tk.card,
          child: icon != null
              ? Icon(icon, color: Tk.muted, size: size * .5)
              : Text(initials, style: const TextStyle(color: Tk.muted, fontWeight: FontWeight.w600, fontSize: 20)),
        ),
        Positioned(
          right: 0,
          bottom: 0,
          child: Container(
            width: size * .3,
            height: size * .3,
            decoration: BoxDecoration(
              color: presenceColor(presence),
              shape: BoxShape.circle,
              border: Border.all(color: Tk.bg, width: 2),
            ),
          ),
        ),
      ]),
    );
  }
}

/// Large press-and-hold PTT button. Orange idle, green while transmitting.
class PttButton extends StatefulWidget {
  final double size;
  final ValueChanged<bool>? onTransmit;
  const PttButton({super.key, this.size = 300, this.onTransmit});
  @override
  State<PttButton> createState() => _PttButtonState();
}

class _PttButtonState extends State<PttButton> {
  bool _tx = false;

  void _set(bool v) {
    if (_tx == v) return;
    HapticFeedback.mediumImpact();
    setState(() => _tx = v);
    widget.onTransmit?.call(v);
  }

  @override
  Widget build(BuildContext context) {
    final c = _tx ? Tk.green : Tk.orange;
    return GestureDetector(
      onTapDown: (_) => _set(true),
      onTapUp: (_) => _set(false),
      onTapCancel: () => _set(false),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        width: widget.size,
        height: widget.size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Tk.surface,
          border: Border.all(color: c, width: 4),
          boxShadow: _tx ? [BoxShadow(color: c.withOpacity(.4), blurRadius: 40, spreadRadius: 8)] : null,
        ),
        child: Icon(_tx ? Icons.graphic_eq : Icons.mic, size: 56, color: Colors.white),
      ),
    );
  }
}

class ContactTile extends StatelessWidget {
  final Contact c;
  final VoidCallback onTap;
  const ContactTile(this.c, {super.key, required this.onTap});
  @override
  Widget build(BuildContext context) => ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: StatusAvatar(c.name, icon: c.isBot ? Icons.mic_external_on : null, presence: c.presence),
        title: Text.rich(TextSpan(children: [
          TextSpan(text: c.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
          if (c.isBot) const TextSpan(text: '  Robot', style: TextStyle(color: Tk.muted, fontSize: 18)),
        ])),
        subtitle: Text(c.subtitle, style: const TextStyle(color: Tk.muted, fontSize: 16)),
      );
}

class ChannelTile extends StatelessWidget {
  final Channel ch;
  final ValueChanged<bool> onToggle;
  final VoidCallback onTap;
  const ChannelTile(this.ch, {super.key, required this.onToggle, required this.onTap});
  @override
  Widget build(BuildContext context) => ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        leading: StatusAvatar(ch.name, icon: Icons.groups, presence: ch.enabled ? Presence.online : Presence.offline),
        title: Text(ch.name, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
        subtitle: Text(ch.last, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Tk.muted)),
        trailing: Switch(value: ch.enabled, onChanged: onToggle),
      );
}

/// Bottom bar showing the last/ongoing transmission.
class MiniPlayer extends StatelessWidget {
  final String who, when;
  const MiniPlayer({super.key, required this.who, required this.when});
  @override
  Widget build(BuildContext context) => Container(
        color: Tk.surface,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(children: [
          StatusAvatar(who, size: 44),
          const SizedBox(width: 14),
          Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(who, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18)),
            Text('↙ $when', style: const TextStyle(color: Tk.muted)),
          ]),
        ]),
      );
}
