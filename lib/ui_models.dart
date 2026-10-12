/// UI view models shared by the widgets. These are presentation-only types,
/// independent of the API DTOs in `lib/api/models.dart`.
library;

enum Presence { online, busy, away, offline }

class Contact {
  final String name, subtitle;
  final Presence presence;
  final bool isBot;
  const Contact(this.name, this.subtitle, this.presence, {this.isBot = false});
}

class Channel {
  final String name, last;
  bool enabled;
  Channel(this.name, this.last, {this.enabled = true});
}
