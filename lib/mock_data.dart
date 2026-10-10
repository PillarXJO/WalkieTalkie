import 'dart:async';

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

/// TODO(backend): replace with a repository backed by the real API.
class MockService {
  static const contacts = <Contact>[
    Contact('echo', 'Talk to me to test your audio', Presence.online, isBot: true),
    Contact('Mohammad Emran', 'Available', Presence.online),
    Contact('Sara Haddad', 'In a meeting', Presence.busy),
    Contact('Omar Khalil', 'Driving', Presence.away),
    Contact('Lina Nasser', 'Available', Presence.online),
    Contact('Yousef Ali', 'Offline', Presence.offline),
    Contact('Dana Saleh', 'Available', Presence.online),
    Contact('Khaled Majed', 'On site', Presence.away),
  ];

  static final channels = <Channel>[
    Channel('Everyone', 'You and Mohammad Emran are connected'),
    Channel('pillarx', 'You and Mohammad Emran are connected'),
    Channel('Dispatch', '3 people online'),
    Channel('Night Shift', 'Quiet', enabled: false),
  ];

  /// Simulates an incoming transmission every [every] so the receive UI can be demoed.
  static Stream<String> incoming({Duration every = const Duration(seconds: 20)}) =>
      Stream.periodic(every, (i) => contacts[1 + i % (contacts.length - 1)].name);
}
