import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// App copy for the supported locales (English + Arabic).
///
/// Read from a widget with `AppStrings.of(context)`. Arabic also flips the
/// layout direction to RTL automatically because it is registered in
/// `MaterialApp.supportedLocales`.
class AppStrings {
  const AppStrings(this.locale);

  final Locale locale;

  static const LocalizationsDelegate<AppStrings> delegate = _AppStringsDelegate();

  static AppStrings of(BuildContext context) =>
      Localizations.of<AppStrings>(context, AppStrings) ?? const AppStrings(Locale('en'));

  bool get isArabic => locale.languageCode == 'ar';

  String _s(String en, String ar) => isArabic ? ar : en;

  // Auth ----------------------------------------------------------------------
  String get welcomeBack => _s('Welcome back', 'مرحبًا بعودتك');
  String get signInSubtitle => _s('Sign in to your PTT account.', 'سجّل الدخول إلى حساب PTT الخاص بك.');
  String get email => _s('Email', 'البريد الإلكتروني');
  String get password => _s('Password', 'كلمة المرور');
  String get mfaCodeLabel => _s('6-digit code or backup code', 'رمز مكوّن من 6 أرقام أو رمز احتياطي');
  String get pleaseWait => _s('PLEASE WAIT', 'الرجاء الانتظار');
  String get verify => _s('VERIFY', 'تحقّق');
  String get signIn => _s('SIGN IN', 'تسجيل الدخول');
  String get createAnAccount => _s('Create an account', 'إنشاء حساب');
  String get createYourWorkspace => _s('Create your workspace', 'أنشئ مساحة عملك');
  String get fullName => _s('Full name', 'الاسم الكامل');
  String get passwordMinChars => _s('Password (min 8 chars)', 'كلمة المرور (8 أحرف على الأقل)');
  String get createAccount => _s('CREATE ACCOUNT', 'إنشاء الحساب');
  String get enterValidEmail => _s('Enter a valid email address', 'أدخل بريدًا إلكترونيًا صالحًا');
  String get enterPassword => _s('Enter your password', 'أدخل كلمة المرور');
  String get enterName => _s('Enter your name', 'أدخل اسمك');
  String get passwordTooShort => _s('Password must be at least 8 characters', 'يجب أن تتكوّن كلمة المرور من 8 أحرف على الأقل');
  String get validationFailed => _s('Please check your details and try again.', 'يرجى التحقّق من بياناتك والمحاولة مرة أخرى.');

  // Invite --------------------------------------------------------------------
  String get inviteYourTeam => _s('Invite your team', 'ادعُ فريقك');
  String get codeLabel => _s('CODE', 'الرمز');
  String get inviteToWorkspace => _s('Invite your team to your private workspace.', 'ادعُ فريقك إلى مساحة عملك الخاصة.');
  String get copyInviteLink => _s('COPY INVITE LINK', 'نسخ رابط الدعوة');
  String get linkCopied => _s('Invite link copied — send it to your team.', 'تم نسخ رابط الدعوة — أرسله إلى فريقك.');
  String get createNewCode => _s('CREATE A NEW CODE', 'إنشاء رمز جديد');
  String get retry => _s('RETRY', 'إعادة المحاولة');
  String get notInWorkspace =>
      _s('You are not in a workspace yet. Have your admin invite you, or create one first.',
          'لست في مساحة عمل بعد. اطلب من المسؤول دعوتك، أو أنشئ واحدة أولًا.');

  String inviteRole(String role, int maxUses) {
    if (role == 'dispatcher') {
      return isArabic
          ? 'الانضمام يمنح دور الموزّع. يعمل كل رمز $maxUses مرة — يكفي مسح رمز QR أو فتح الرابط.'
          : 'Joining grants the dispatcher role. Each code works $maxUses time${maxUses == 1 ? '' : 's'} — they simply scan the QR or open the link.';
    }
    return isArabic
        ? 'الانضمام يمنح صلاحية العضو. يعمل كل رمز $maxUses مرة — كل ما عليهم فعله مسح رمز QR أو فتح الرابط.'
        : 'Joining grants the member role. Each code works $maxUses time${maxUses == 1 ? '' : 's'} — they simply scan the QR or open the link.';
  }

  String get inviteLinkCopied => _s('Invite link copied — send it to your team.', 'تم نسخ رابط الدعوة — أرسله إلى فريقك.');
  String get notInWorkspaceYet => _s(
      'You are not in a workspace yet. Have your admin invite you, or create one first.',
      'لست في مساحة عمل بعد. اطلب من المدير أن يدعوك، أو أنشئ واحدة أولًا.');
  String get couldNotCreateInvite => _s('Could not create an invite', 'تعذّر إنشاء دعوة');
  String get retryUpper => _s('RETRY', 'إعادة المحاولة');

  // Join ----------------------------------------------------------------------
  String get joinAWorkspace => _s('Join a workspace', 'الانضمام إلى مساحة عمل');
  String get enterInviteCode => _s('Enter the invite code', 'أدخل رمز الدعوة');
  String get joinIntro => _s(
        'Scan the QR code with your camera, or paste a code or link your team shared with you. Joining gives you member access to their private workspace.',
        'امسح رمز QR بالكاميرا، أو الصق رمزًا أو رابطًا شاركه فريقك معك. الانضمام يمنحك صلاحية عضو في مساحة عملهم الخاصة.',
      );
  String get inviteCodeOrLink => _s('Invite code or link', 'رمز الدعوة أو الرابط');
  String get inviteCodeHint => 'ptt://invite/abcdefgh';
  String get pasteFromClipboard => _s('Paste from clipboard', 'لصق من الحافظة');
  String get scanQrCode => _s('SCAN QR CODE', 'مسح رمز QR');
  String get checkTheCode => _s('CHECK THE CODE', 'تحقّق من الرمز');
  String joinAs(String name, String role) =>
      _s('Join $name as $role', 'الانضمام إلى $name بصفة $role');
  String get joining => _s('JOINING…', 'جارٍ الانضمام…');
  String get joinWorkspace => _s('JOIN WORKSPACE', 'الانضمام إلى مساحة العمل');
  String get enterInviteHint =>
      _s('Enter an invite code or link (e.g. ptt://invite/xxxxxxxx).', 'أدخل رمز دعوة أو رابطًا (مثال ptt://invite/xxxxxxxx).');
  String couldNotJoin(Object e) => _s('Could not join: $e', 'تعذّر الانضمام: $e');
  String youJoined(String name) => _s('You joined $name.', 'لقد انضممت إلى $name.');

  // Scanner -------------------------------------------------------------------
  String get scanInviteCode => _s('Scan invite code', 'امسح رمز الدعوة');
  String get pointCamera => _s('Point the camera at an invite QR code', 'وجّه الكاميرا نحو رمز QR للدعوة');

  // Permissions ---------------------------------------------------------------
  String get appPermissions => _s('App Permissions', 'أذونات التطبيق');
  String get permissionsSubtitle =>
      _s('Tap a permission to grant it in your device settings.', 'اضغط على إذن لمنحه من إعدادات جهازك.');
  String get permRecordAudio => _s('Record Audio', 'تسجيل الصوت');
  String get permRecordAudioSub => _s('Talk to people via push-to-talk', 'تحدّث مع الآخرين عبر الضغط للتحدث');
  String get permNotifications => _s('Send Notifications', 'إرسال الإشعارات');
  String get permNotificationsSub => _s('Be notified when you receive messages', 'يتم تنبيهك عند استلام الرسائل');
  String get permBluetooth => _s('Connect via Bluetooth', 'الاتصال عبر البلوتوث');
  String get permBluetoothSub => _s('Connect headsets and microphones', 'توصيل السماعات والميكروفونات');
  String get permBackground => _s('Run in Background', 'العمل في الخلفية');
  String get permBackgroundSub => _s('Receive messages when the screen is off', 'استلام الرسائل عندما تكون الشاشة مطفأة');
  String get permPhone => _s('Make & Manage Phone Calls', 'إجراء وإدارة المكالمات');
  String get permPhoneSub => _s('Prevents voice messages interfering with calls', 'يمنع تعارض الرسائل الصوتية مع المكالمات');
  String get permLocation => _s('Location Sharing', 'مشاركة الموقع');
  String get permLocationSub => _s('Live location, emergency alerts, location messages', 'الموقع المباشر والتنبيهات الطارئة ورسائل الموقع');
  String get permOverlay => _s('Display Over Other Apps', 'العرض فوق التطبيقات الأخرى');
  String get permOverlaySub => _s('Floating PTT overlay and lock-screen response', 'واجهة PTT العائمة والرد من شاشة القفل');
  String get continueBtn => _s('CONTINUE', 'متابعة');

  // Tutorial ------------------------------------------------------------------
  String get skip => _s('SKIP', 'تخطٍ');
  String get pressAndHoldToSpeak => _s('Press and hold to speak', 'اضغط مع الاستمرار للتحدث');
  String get pressAndHoldToSpeakBody =>
      _s("Hold the button while you talk. Let go when you're finished.", 'استمر بالضغط على الزر أثناء حديثك، ثم ارفع إصبعك عند الانتهاء.');
  String get speaker => _s('Speaker', 'مكبّر الصوت');

  // Home ----------------------------------------------------------------------
  String get tabRecents => _s('Recents', 'الأخيرة');
  String get tabContacts => _s('Contacts', 'جهات الاتصال');
  String get tabChannels => _s('Channels', 'القنوات');
  String get comingNext => _s('(coming next)', '(قريبًا)');
  String get joinWithInviteCode => _s('Join with invite code', 'الانضمام برمز دعوة');
  String get redeemQrSubtitle => _s('Redeem a QR code or link a teammate shared', 'استبدل رمز QR أو رابطًا شاركه زميلك');
  String get nobody => _s('Nobody', 'لا أحد');
  String get idle => _s('idle', 'خامل');
  String get someone => _s('Someone', 'شخص ما');
  String get speaking => _s('speaking', 'يتحدّث');
  String get emergencyLower => _s('emergency', 'طارئ');
  String get emergency => _s('Emergency', 'طارئ');
  String get available => _s('Available', 'متاح');
  String get you => _s('You', 'أنت');
  String get noWorkspace => _s('No workspace', 'لا توجد مساحة عمل');
  String get echoBot => _s('Echo bot', 'بوت الصدى');
  String connected(int n) => _s('$n connected', '$n متصل');

  // Contacts ------------------------------------------------------------------
  String get addContact => _s('Add contact', 'إضافة جهة اتصال');
  String get addContactTitle => _s('Add a contact', 'إضافة جهة اتصال');
  String get scanContactQr => _s('SCAN CONTACT QR', 'مسح رمز جهة الاتصال');
  String get yourContactCode => _s('Your contact code', 'رمز جهة الاتصال الخاص بك');
  String get contactQrHint => _s('Show this code so a teammate can add you', 'اعرض هذا الرمز ليضيفك أحد الزملاء');
  String get contactCodeOrId => _s('Contact code or ID', 'رمز جهة الاتصال أو المعرّف');
  String get addByCode => _s('ADD BY CODE', 'إضافة بالرمز');
  String get copyCode => _s('Copy code', 'نسخ الرمز');
  String get codeCopied => _s('Contact code copied.', 'تم نسخ رمز جهة الاتصال.');
  String get scanContactTitle => _s('Scan contact code', 'مسح رمز جهة الاتصال');
  String get pointCameraAtContact => _s('Point the camera at a contact QR code', 'وجّه الكاميرا نحو رمز QR لجهة الاتصال');
  String get invalidContactCode => _s('That is not a valid contact code', 'هذا ليس رمز جهة اتصال صالحًا');
  String addContactConfirm(String name) => _s('Add $name to your contacts?', 'إضافة $name إلى جهات اتصالك؟');
  String get add => _s('ADD', 'إضافة');
  String addContactSuccess(String name) => _s('$name added to your contacts.', 'تمت إضافة $name إلى جهات اتصالك.');
  String get alreadyAContact => _s('Already a contact', 'موجود مسبقًا في جهات اتصالك');
  String couldNotAddContact(Object e) => _s('Could not add contact: $e', 'تعذّر إضافة جهة الاتصال: $e');

  // Channels ------------------------------------------------------------------
  String get newChannel => _s('New channel', 'قناة جديدة');
  String get createChannelTitle => _s('Create a channel', 'إنشاء قناة');
  String get channelName => _s('Channel name', 'اسم القناة');
  String get selectMembers => _s('Add members', 'إضافة أعضاء');
  String get youWillBeAdmin => _s('You will be the admin of this channel.', 'ستكون أنت مدير هذه القناة.');
  String get createChannelBtn => _s('CREATE CHANNEL', 'إنشاء القناة');
  String get channelNameRequired => _s('Enter a channel name', 'أدخل اسم القناة');
  String get noMembersToAdd => _s('No other workspace members to add.', 'لا يوجد أعضاء آخرون في مساحة العمل.');
  String channelCreated(String name) => _s('Channel $name created.', 'تم إنشاء القناة $name.');
  String couldNotCreateChannel(Object e) => _s('Could not create channel: $e', 'تعذّر إنشاء القناة: $e');
  String get admin => _s('Admin', 'مدير');
  String membersSelected(int n) => _s('$n selected', 'تم اختيار $n');

  // Talk ----------------------------------------------------------------------
  String get emergencyTraffic => _s('EMERGENCY traffic', 'حركة طارئة');
  String get floorHeld => _s('Floor held', 'القناة محجوزة');
  String get pressAndHoldToTalk => _s('Press and hold to talk', 'اضغط مع الاستمرار للتحدث');

  // Settings ------------------------------------------------------------------
  String get settings => _s('Settings', 'الإعدادات');
  String get profile => _s('Profile', 'الملف الشخصي');
  String get permissions => _s('Permissions', 'الأذونات');
  String get permissionsSubtitleShort => _s('Microphone, location, notifications…', 'الميكروفون، الموقع، الإشعارات…');
  String get theme => _s('Theme', 'المظهر');
  String get light => _s('Light', 'فاتح');
  String get dark => _s('Dark', 'داكن');
  String get language => _s('Language', 'اللغة');
  String get english => _s('English', 'الإنجليزية');
  String get arabic => _s('Arabic', 'العربية');
  String get signOut => _s('Sign out', 'تسجيل الخروج');
  String get signOutConfirmTitle => _s('Sign out?', 'تسجيل الخروج؟');
  String get signOutConfirmBody => _s('You will need to sign in again to use the app.', 'ستحتاج إلى تسجيل الدخول مرة أخرى لاستخدام التطبيق.');
  String get cancel => _s('Cancel', 'إلغاء');
}

class _AppStringsDelegate extends LocalizationsDelegate<AppStrings> {
  const _AppStringsDelegate();

  @override
  bool isSupported(Locale locale) => const ['en', 'ar'].contains(locale.languageCode);

  @override
  Future<AppStrings> load(Locale locale) => SynchronousFuture<AppStrings>(AppStrings(locale));

  @override
  bool shouldReload(covariant LocalizationsDelegate<AppStrings> old) => false;
}
