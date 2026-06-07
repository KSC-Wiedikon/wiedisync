export default {
  // Login
  signIn: 'Sign in',
  email: 'Email',
  password: 'Password',
  emailPlaceholder: 'name@example.com',
  passwordPlaceholder: 'Enter password',
  signingIn: 'Signing in...',
  invalidCredentials: 'Invalid email or password',
  turnstileError: 'Security check failed — please try again.',
  networkError: 'Could not reach the server — please check your internet connection.',
  tooManyRequests: 'Too many attempts — please wait a moment and try again.',
  rememberMe: 'Remember me',
  forgotPassword: 'Forgot password?',
  sendingResetLink: 'Sending link...',
  enterEmailFirst: 'Please enter your email first.',
  accountAlreadyExists: 'An account with this email already exists. Please sign in.',
  noAccountYet: 'Don\'t have an account?',
  orContinueWith: 'or continue with',
  signInWithGoogle: 'Sign in with Google',
  oauthError: 'Sign in failed. Please try again.',

  // Profile
  editProfile: 'Edit Profile',
  contact: 'Contact',
  phone: 'Phone',
  licenseNr: 'License Nr.',
  licenceCategory: 'Licence Category',
  licenceActivated: 'Licence Activated',
  licenceValidated: 'Licence Validated',
  licence: 'Licence',
  type: 'Type',
  activated: 'Activated',
  validated: 'Validated',
  svSyncInfo: 'Automatically synced from Swiss Volley',
  svLas: 'LFP',
  svForeigner: 'Foreign',
  svAssociation: 'Association',
  licences: 'Licences',
  upcomingActivities: 'Upcoming Activities',
  activeAbsences: 'Active Absences',
  showAll: 'Show all',
  noUpcomingActivities: 'No activities in the next 4 weeks.',
  noActiveAbsences: 'No active absences.',
  teams: 'Teams',
  roles: 'Roles',

  contactPrivacyNotice: 'Your email and phone number are only visible to the coach and team responsible of teams where you have an official duty (e.g. scorekeeper).',

  // Profile Edit
  firstName: 'First Name',
  lastName: 'Last Name',
  changePhoto: 'Change Photo',
  managedByCoach: 'Managed by coach/admin',
  position: 'Position',
  number: 'Number',
  changePassword: 'Change Password',
  sendResetLink: 'Send reset link',
  numberTaken: 'This number is already used by {{name}}',
  errorSaving: 'Error saving',
  fileTooLarge: 'File is too large (max 5 MB)',
  invalidImageType: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF',

  // Training label
  training: 'Training',

  // Sign Up
  signUp: 'Sign up',
  createAccount: 'Create Account',
  confirmPassword: 'Confirm Password',
  passwordMismatch: 'Passwords do not match',
  registrationFailed: 'Registration failed. Please try again.',
  creatingAccount: 'Creating account...',
  continue: 'Continue',
  checkingEmail: 'Checking email...',
  captchaLoading: 'Security check loading — please disable content blockers if this persists.',
  alreadyHaveAccount: 'Already have an account?',
  change: 'Change',

  // Account claim
  accountExists: 'Account found',
  accountExistsDescription: 'An account with this email already exists. We\'ve sent you a password reset link.',
  resetLinkSent: 'Link sent! Check your inbox.',
  tryDifferentEmail: 'Try a different email',

  // Team selection
  selectTeam: 'Select team',
  selectTeamPlaceholder: 'Choose a team...',
  teamRequired: 'Please select a team.',

  // Pending page
  pendingApproval: 'Pending Approval',
  pendingDescription: 'Your account is waiting for approval from your team\'s coach or an admin.',
  requestedTeam: 'Requested Team',
  refreshStatus: 'Refresh Status',
  checking: 'Checking...',
  logout: 'Log out',

  // Onboarding
  onboardingTitle: 'Welcome to KSC Wiedikon',
  onboardingSubtitle: 'Please complete your profile to continue.',
  language: 'Language',
  languageGerman: 'Deutsch',
  languageEnglish: 'English',
  completeProfile: 'Confirm Profile',
  skipForNow: 'Skip for now',
  birthdate: 'Birthdate',

  // Privacy
  privacySection: 'Privacy',
  hidePhone: 'Hide phone number',
  hidePhoneHint: 'Your phone number will not be shown to other members.',
  hideEmail: 'Hide email address',
  hideEmailHint: 'Your email address will not be shown to other members.',
  birthdateVisibility: 'Birthdate visibility',
  birthdateVisibilityFull: 'Show full date',
  birthdateVisibilityYearOnly: 'Year only',
  birthdateVisibilityHidden: 'Hide',
  hidden: 'Hidden',
  yearOnly: 'Year only',
  websiteVisible: 'Website visibility',
  websiteVisibleInfo: 'When enabled, your photo will be shown on the club website team roster.',

  // Privacy consent
  privacyConsent: 'By registering you accept our',
  privacyPolicy: 'Privacy Policy',

  // Password reset
  resetPasswordTitle: 'Reset Password',
  newPassword: 'New password',
  resetPasswordButton: 'Save password',
  resettingPassword: 'Saving...',
  resetSuccess: 'Your password has been changed successfully. You can now sign in.',
  resetError: 'This link is invalid or expired. Please request a new reset link.',
  noAccountFound: 'No account found with this email. Create an account first.',

  // OTP verification
  otpSentTo: 'Code sent to {{email}}',
  otpResendIn: 'Resend in {{seconds}}s',
  otpResend: 'Resend code',
  otpInvalid: 'Invalid code. Please try again.',
  otpExpired: 'Code expired. Please request a new one.',
  otpError: 'Failed to send code. Please try again.',
  codeSentTo: 'We sent an 8-digit code to',

  // Context-aware OTP titles
  activateAccount: 'Activate Account',
  activateAccountDescription: 'Your account has been prepared. Enter the code to get started.',
  verifyEmail: 'Verify Email',
  verifyEmailDescription: 'Verify your email address to continue registration.',
  resetPasswordOtp: 'Reset Password',
  resetPasswordOtpDescription: 'Enter the code to reset your password.',
  resetPasswordOtpEmailDescription: 'Enter your email address to receive a reset code.',
  resetPasswordOtpSetDescription: 'Choose a new password for your account.',
  setPasswordTitle: 'Set Password',
  setPasswordDescription: 'Welcome! Set your password to complete setup.',

  // Password setting form
  setPasswordButton: 'Set Password',
  settingPassword: 'Setting password...',
  passwordSetSuccess: 'Password set successfully!',
  passwordTooShort: 'Password must be at least 8 characters.',
  passwordResetSent: 'Check your email to set your password.',
  passwordResetSuccess: 'Your password has been changed successfully. You can now sign in.',

  // OTP forgot-password flow
  sendingOtp: 'Sending code...',
  sendOtp: 'Send code',
  backToLogin: 'Back to sign in',
  otpRequestFailed: 'Could not send code. Please try again.',

  // Multi-team onboarding
  yourTeams: 'Your teams',
  joinAdditionalTeams: 'Join additional teams',
  noTeamsForSport: 'No teams available for this sport',
  additionalTeamsNote: 'Additional teams require coach approval',

  // Team requests
  addTeam: 'Add Team',
  addTeamTitle: 'Join a Team',
  manageTeamsTitle: 'Manage teams',
  addTeamDescription: 'Select a team you\'d like to join. The coach needs to approve your request.',
  noTeamsAvailable: 'No more teams available.',
  sendRequest: 'Send Request',
  teamRequestError: 'Error sending request',
  leaveTeam: 'Leave team',
  leaveTeamTitle: 'Leave team',
  leaveTeamConfirm: 'Are you sure you want to leave {{team}}? You\'ll be removed from the roster and will need approval to rejoin.',
  teamRequestSent: 'Request sent',

  // Fines
  outstandingFines: 'Outstanding fines: {{amount}}',
  outstandingFinesCount_one: '{{count}} open fine',
  outstandingFinesCount_other: '{{count}} open fines',

  // Danger Zone
  dangerZone: 'Danger Zone',
  deleteAccount: 'Delete Account',
  deleteAccountDescription: 'Your account and all associated data will be permanently deleted. This action cannot be undone.',
  deleteAccountConfirm: 'Permanently delete account',
  deleteAccountEmailPrompt: 'Type your email address to confirm:',
  deleteAccountEmailPlaceholder: 'Email to confirm',
  deleteAccountError: 'Could not delete account. Please try again.',

  // Member status
  status: 'Status',
  active: 'Active member',
  passive: 'Passive member',

  // ClubDesk data sync
  personalDataClubdesk: 'Personal Data (ClubDesk)',
  anrede: 'Salutation',
  adresse: 'Address',
  plz: 'Postal Code',
  ort: 'City',
  nationalitaet: 'Nationality',
  sex: 'Sex',
  ahvNummer: 'AHV Number',
  beitragskategorie: 'Fee Category',
  managedByAdmin: 'Managed by admin',
  male: 'Male',
  female: 'Female',
  mr: 'Mr',
  mrs: 'Mrs',
  clubdeskUpdateSent: 'Data update sent to admin',
  invalidAhvFormat: 'AHV number must follow format 756.XXXX.XXXX.XX',
  invalidPlz: 'PLZ must be a 4-digit Swiss postal code',
  requiredProfileFields: 'First name, last name and email are required',
  invalidEmail: 'Please enter a valid email address',
} as const
